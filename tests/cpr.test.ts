import { describe, expect, it } from "vitest";
import {
  buildCPRResult,
  calculateCPR,
  calculateCPRWidth,
  calculateCPRWidthPercentage,
  validateOHLC,
} from "@/lib/cpr/calculator";
import { calculatePivotLevels } from "@/lib/cpr/pivots";
import { CPRValidationError, type OHLC } from "@/lib/cpr/types";

/**
 * The reference bar is the REAL NIFTY 50 session of 2026-08-24 as returned by the
 * market-data provider (unrounded doubles, exactly as they arrive over the wire).
 * PRD §7/§13 publishes the expected CPR for this bar, so it doubles as an
 * end-to-end check that the engine reproduces the specification's own figures.
 */
const NIFTY_2026_08_24: OHLC = {
  date: "2026-08-24",
  open: 24222.05,
  high: 24313.0,
  low: 24144.30078125,
  close: 24219.05078125,
};

describe("calculateCPR — PRD reference example (NIFTY 50, 24 Aug 2026)", () => {
  const cpr = calculateCPR(NIFTY_2026_08_24);

  it("computes the pivot as (H + L + C) / 3", () => {
    expect(cpr.pivot).toBe(24225.45);
  });

  it("produces the published BC and TC", () => {
    expect(cpr.bc).toBe(24222.25);
    expect(cpr.tc).toBe(24228.65);
  });

  it("flags this bar as an inverted CPR", () => {
    // (H+L)/2 = 24228.65 exceeds 2P − (H+L)/2 = 24222.25, so the raw BC/TC were
    // swapped to honour the TC >= BC invariant. The PRD's published BC/TC are
    // the post-swap values, which is what makes this a useful regression guard.
    expect(cpr.inverted).toBe(true);
  });

  it("always satisfies TC >= BC", () => {
    expect(cpr.tc).toBeGreaterThanOrEqual(cpr.bc);
  });

  it("computes the published width and width %", () => {
    const width = calculateCPRWidth(cpr.tc, cpr.bc);
    expect(width).toBe(6.4);
    expect(calculateCPRWidthPercentage(width, cpr.pivot)).toBe(0.0264);
  });

  it("classifies as NARROW, decided by points (NIFTY's configured method)", () => {
    const result = buildCPRResult(NIFTY_2026_08_24, "2026-08-25", "POINTS");
    expect(result.pointsClassification).toBe("NARROW");
    expect(result.percentageClassification).toBe("NARROW");
    expect(result.overallClassification).toBe("NARROW");
    expect(result.basis).toBe("PRIMARY");
    expect(result.classificationMethod).toBe("POINTS");
    expect(result.resolvedMethod).toBe("POINTS");
    expect(result.methodsAgree).toBe(true);
  });
});

describe("calculateCPR — invariants", () => {
  it("keeps TC >= BC for a non-inverted bar", () => {
    // Close well below the midpoint pushes the pivot down, giving TC < (H+L)/2.
    const cpr = calculateCPR({ high: 110, low: 90, close: 92 });
    expect(cpr.tc).toBeGreaterThanOrEqual(cpr.bc);
    expect(cpr.inverted).toBe(true);
  });

  it("reports inverted=false when the raw TC already exceeds the raw BC", () => {
    const cpr = calculateCPR({ high: 110, low: 90, close: 108 });
    expect(cpr.inverted).toBe(false);
    expect(cpr.tc).toBeGreaterThan(cpr.bc);
  });

  it("never yields a negative width", () => {
    const bars = [
      { high: 110, low: 90, close: 90 },
      { high: 110, low: 90, close: 110 },
      { high: 110, low: 90, close: 100 },
      { high: 79500.12, low: 78201.44, close: 79025.52 },
    ];
    for (const bar of bars) {
      const { tc, bc } = calculateCPR(bar);
      expect(calculateCPRWidth(tc, bc)).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the displayed width consistent with the displayed TC and BC", () => {
    // Users check the arithmetic by eye; printed TC − printed BC must equal the
    // printed width exactly.
    const bar = { high: 24313.0, low: 24144.30078125, close: 24219.05078125 };
    const { tc, bc } = calculateCPR(bar);
    const width = calculateCPRWidth(tc, bc);
    expect(Number((tc - bc).toFixed(2))).toBe(width);
  });
});

describe("validateOHLC (PRD §30)", () => {
  it("rejects high <= low", () => {
    expect(() => validateOHLC({ high: 100, low: 100, close: 100 })).toThrow(
      CPRValidationError,
    );
    expect(() => validateOHLC({ high: 90, low: 100, close: 95 })).toThrow(
      CPRValidationError,
    );
  });

  it("rejects a close outside the high/low band", () => {
    expect(() => validateOHLC({ high: 110, low: 90, close: 89 })).toThrow(
      /close/,
    );
    expect(() => validateOHLC({ high: 110, low: 90, close: 111 })).toThrow(
      /close/,
    );
  });

  it("accepts a close exactly on the high or the low", () => {
    expect(() => validateOHLC({ high: 110, low: 90, close: 90 })).not.toThrow();
    expect(() => validateOHLC({ high: 110, low: 90, close: 110 })).not.toThrow();
  });

  it("rejects non-finite values rather than emitting NaN levels", () => {
    expect(() =>
      validateOHLC({ high: Number.NaN, low: 90, close: 95 }),
    ).toThrow(CPRValidationError);
    expect(() =>
      validateOHLC({ high: Number.POSITIVE_INFINITY, low: 90, close: 95 }),
    ).toThrow(CPRValidationError);
  });
});

describe("calculateCPRWidthPercentage", () => {
  it("returns 4 decimal places", () => {
    expect(calculateCPRWidthPercentage(6.4, 24225.45)).toBe(0.0264);
  });

  it("scales correctly for a low-priced instrument", () => {
    // Crude around 85: a 0.34 point width is a far larger % than on NIFTY.
    expect(calculateCPRWidthPercentage(0.34, 85.53)).toBe(0.3975);
  });

  it("refuses to divide by a zero pivot", () => {
    expect(() => calculateCPRWidthPercentage(6.4, 0)).toThrow(
      CPRValidationError,
    );
  });
});

describe("buildCPRResult", () => {
  it("refuses to project a CPR onto the source session itself", () => {
    expect(() => buildCPRResult(NIFTY_2026_08_24, "2026-08-24", "POINTS")).toThrow(
      /must be after/,
    );
  });

  it("refuses to project a CPR backwards in time", () => {
    expect(() => buildCPRResult(NIFTY_2026_08_24, "2026-08-21", "POINTS")).toThrow(
      /must be after/,
    );
  });

  it("records the source session separately from the target session", () => {
    const result = buildCPRResult(NIFTY_2026_08_24, "2026-08-25", "POINTS");
    expect(result.sourceDate).toBe("2026-08-24");
    expect(result.tradingDate).toBe("2026-08-25");
  });

  it("includes the full R1–R5 / S1–S5 ladder", () => {
    const result = buildCPRResult(NIFTY_2026_08_24, "2026-08-25", "POINTS");
    expect(Object.keys(result.pivotLevels).sort()).toEqual(
      ["r1", "r2", "r3", "r4", "r5", "s1", "s2", "s3", "s4", "s5"].sort(),
    );
  });
});

describe("calculatePivotLevels", () => {
  // Round numbers so the expected values are checkable by hand.
  const high = 110;
  const low = 90;
  const close = 100;
  const pivot = (high + low + close) / 3; // 100
  const levels = calculatePivotLevels(high, low, pivot);

  it("computes R1/S1 as the reflection of the low/high about the pivot", () => {
    expect(levels.r1).toBe(110); // 2(100) − 90
    expect(levels.s1).toBe(90); // 2(100) − 110
  });

  it("computes R2/S2 as the pivot plus/minus the range", () => {
    expect(levels.r2).toBe(120); // 100 + 20
    expect(levels.s2).toBe(80); // 100 − 20
  });

  it("computes the R3–R5 / S3–S5 linear extensions", () => {
    expect(levels.r3).toBe(130); // 110 + 2(10)
    expect(levels.r4).toBe(140); // 110 + 3(10)
    expect(levels.r5).toBe(150); // 110 + 4(10)
    expect(levels.s3).toBe(70); // 90 − 2(10)
    expect(levels.s4).toBe(60); // 90 − 3(10)
    expect(levels.s5).toBe(50); // 90 − 4(10)
  });

  it("orders the ladder monotonically around the pivot", () => {
    const ordered = [
      levels.s5,
      levels.s4,
      levels.s3,
      levels.s2,
      levels.s1,
      levels.r1,
      levels.r2,
      levels.r3,
      levels.r4,
      levels.r5,
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]).toBeGreaterThanOrEqual(ordered[i - 1]);
    }
  });
});
