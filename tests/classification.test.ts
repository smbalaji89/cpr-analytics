import { describe, expect, it } from "vitest";
import {
  calculateOverallClassification,
  classificationLabel,
  classify,
  classifyByPercentage,
  classifyByPoints,
} from "@/lib/cpr/classification";
import { INSTRUMENTS } from "@/lib/instruments";

describe("classifyByPoints — PRD §40 boundary table", () => {
  it.each([
    [1, "NARROW"],
    [40, "NARROW"],
    [41, "MIXED"],
    [70, "MIXED"],
    [71, "WIDER"],
    [200, "WIDER"],
  ])("%d points -> %s", (width, expected) => {
    expect(classifyByPoints(width)).toBe(expected);
  });
});

describe("classifyByPoints — out-of-range handling (PRD §35)", () => {
  it("flags widths below the 1 point floor rather than defaulting to NARROW", () => {
    expect(classifyByPoints(0)).toBe("BELOW_RANGE");
    expect(classifyByPoints(0.99)).toBe("BELOW_RANGE");
  });

  it("flags widths above the 200 point ceiling rather than defaulting to WIDER", () => {
    expect(classifyByPoints(200.01)).toBe("ABOVE_RANGE");
    expect(classifyByPoints(1250)).toBe("ABOVE_RANGE");
  });

  it("leaves no gap between the published integer bands", () => {
    // The PRD tables read 1–40 / 41–70 / 71–200, which literally skips 40.5.
    expect(classifyByPoints(40.5)).toBe("MIXED");
    expect(classifyByPoints(70.5)).toBe("WIDER");
  });

  it("treats non-finite input as unclassifiable instead of throwing", () => {
    expect(classifyByPoints(Number.NaN)).toBe("BELOW_RANGE");
  });
});

describe("classifyByPercentage — PRD §40 boundary table", () => {
  it.each([
    [0.01, "NARROW"],
    [0.25, "NARROW"],
    [0.26, "MIXED"],
    [0.49, "MIXED"],
    [0.5, "WIDER"],
    [3.75, "WIDER"],
  ])("%s%% -> %s", (percent, expected) => {
    expect(classifyByPercentage(percent)).toBe(expected);
  });

  it("flags percentages below the 0.01% floor", () => {
    expect(classifyByPercentage(0)).toBe("BELOW_RANGE");
    expect(classifyByPercentage(0.0099)).toBe("BELOW_RANGE");
  });

  it("leaves no gap between the published bands", () => {
    expect(classifyByPercentage(0.255)).toBe("MIXED");
    expect(classifyByPercentage(0.495)).toBe("WIDER");
  });

  it("is not tripped up by binary floating point at a boundary", () => {
    // 0.1 + 0.15 === 0.25000000000000006 in IEEE-754; rounding to the displayed
    // 4dp precision before comparing keeps the badge consistent with the number.
    expect(classifyByPercentage(0.1 + 0.15)).toBe("NARROW");
    expect(classifyByPercentage(0.48 + 0.01)).toBe("MIXED");
  });
});


describe("calculateOverallClassification — per-instrument method", () => {
  it("uses the points band when POINTS is configured", () => {
    expect(
      calculateOverallClassification("MIXED", "NARROW", "POINTS"),
    ).toEqual({
      overallClassification: "MIXED",
      basis: "PRIMARY",
      resolvedMethod: "POINTS",
    });
  });

  it("uses the percentage band when PERCENTAGE is configured", () => {
    // Same inputs as above, opposite configured method -> opposite answer.
    expect(
      calculateOverallClassification("MIXED", "NARROW", "PERCENTAGE"),
    ).toEqual({
      overallClassification: "NARROW",
      basis: "PRIMARY",
      resolvedMethod: "PERCENTAGE",
    });
  });

  it("never returns CONFLICTING — the configured method decides", () => {
    const bands = ["NARROW", "MIXED", "WIDER"] as const;
    for (const points of bands) {
      for (const percentage of bands) {
        expect(
          calculateOverallClassification(points, percentage, "POINTS")
            .overallClassification,
        ).toBe(points);
        expect(
          calculateOverallClassification(points, percentage, "PERCENTAGE")
            .overallClassification,
        ).toBe(percentage);
      }
    }
  });

  it("falls back when the configured POINTS method is out of range", () => {
    // A NIFTY width above the 200-point ceiling still needs a category.
    expect(
      calculateOverallClassification("ABOVE_RANGE", "WIDER", "POINTS"),
    ).toEqual({
      overallClassification: "WIDER",
      basis: "FALLBACK",
      resolvedMethod: "PERCENTAGE",
    });
    expect(
      calculateOverallClassification("BELOW_RANGE", "NARROW", "POINTS"),
    ).toEqual({
      overallClassification: "NARROW",
      basis: "FALLBACK",
      resolvedMethod: "PERCENTAGE",
    });
  });

  it("falls back when the configured PERCENTAGE method is out of range", () => {
    expect(
      calculateOverallClassification("MIXED", "BELOW_RANGE", "PERCENTAGE"),
    ).toEqual({
      overallClassification: "MIXED",
      basis: "FALLBACK",
      resolvedMethod: "POINTS",
    });
  });

  it("reports UNCLASSIFIED when neither method applies", () => {
    for (const method of ["POINTS", "PERCENTAGE"] as const) {
      expect(
        calculateOverallClassification("BELOW_RANGE", "BELOW_RANGE", method),
      ).toEqual({
        overallClassification: "UNCLASSIFIED",
        basis: "NONE",
        resolvedMethod: null,
      });
    }
  });
});

describe("classify — real instrument scenarios", () => {
  it("NIFTY 50 is decided by points", () => {
    // The PRD reference session: 6.40 points, 0.0264%.
    const result = classify(6.4, 0.0264, "POINTS");
    expect(result.overallClassification).toBe("NARROW");
    expect(result.classificationMethod).toBe("POINTS");
    expect(result.resolvedMethod).toBe("POINTS");
    expect(result.basis).toBe("PRIMARY");
  });

  it("a NIFTY width that disagrees still follows points", () => {
    // 42.50 points (MIXED) at 0.18% (NARROW). Under the per-instrument rule
    // this is MIXED, not a conflict.
    const result = classify(42.5, 0.18, "POINTS");
    expect(result.pointsClassification).toBe("MIXED");
    expect(result.percentageClassification).toBe("NARROW");
    expect(result.overallClassification).toBe("MIXED");
    expect(result.methodsAgree).toBe(false);
  });

  it("SENSEX-scale values follow percentage, not points", () => {
    // Real session: 84.28 points (WIDER) at 0.1088% (NARROW).
    const result = classify(84.28, 0.1088, "PERCENTAGE");
    expect(result.pointsClassification).toBe("WIDER");
    expect(result.percentageClassification).toBe("NARROW");
    expect(result.overallClassification).toBe("NARROW");
    expect(result.resolvedMethod).toBe("PERCENTAGE");
    expect(result.basis).toBe("PRIMARY");
  });

  it("Crude Oil stays classified despite falling below the points scale", () => {
    // Real session: 0.26 points is below the 1-point floor; 0.2996% is MIXED.
    const result = classify(0.26, 0.2996, "PERCENTAGE");
    expect(result.pointsClassification).toBe("BELOW_RANGE");
    expect(result.overallClassification).toBe("MIXED");
    expect(result.basis).toBe("PRIMARY");
  });

  it("BTC stays classified despite exceeding the points scale", () => {
    // Real session: 616.24 points is above the 200 ceiling; 0.7989% is WIDER.
    const result = classify(616.24, 0.7989, "PERCENTAGE");
    expect(result.pointsClassification).toBe("ABOVE_RANGE");
    expect(result.overallClassification).toBe("WIDER");
    expect(result.basis).toBe("PRIMARY");
  });

  it("always reports both methods, not just the deciding one", () => {
    const result = classify(6.4, 0.0264, "PERCENTAGE");
    expect(result).toHaveProperty("pointsClassification");
    expect(result).toHaveProperty("percentageClassification");
    expect(result).toHaveProperty("classificationMethod");
    expect(result).toHaveProperty("resolvedMethod");
    expect(result).toHaveProperty("methodsAgree");
  });

  it("sets methodsAgree only when both land on the same band", () => {
    expect(classify(6.4, 0.0264, "POINTS").methodsAgree).toBe(true);
    expect(classify(42.5, 0.18, "POINTS").methodsAgree).toBe(false);
    // An out-of-range method cannot "agree" with anything.
    expect(classify(616.24, 0.7989, "PERCENTAGE").methodsAgree).toBe(false);
  });
});

describe("instrument registry wiring", () => {
  it("classifies NIFTY 50 by points and everything else by percentage", () => {
    for (const instrument of INSTRUMENTS) {
      expect(instrument.classificationMethod).toBe(
        instrument.symbol === "NIFTY50" ? "POINTS" : "PERCENTAGE",
      );
    }
  });
});

describe("classificationLabel", () => {
  it.each([
    ["NARROW", "NARROW"],
    ["MIXED", "MIXED"],
    ["WIDER", "WIDER"],
    ["BELOW_RANGE", "BELOW RANGE"],
    ["ABOVE_RANGE", "ABOVE RANGE"],
    ["UNCLASSIFIED", "UNCLASSIFIED"],
  ] as const)("%s -> %s", (value, expected) => {
    expect(classificationLabel(value)).toBe(expected);
  });
});
