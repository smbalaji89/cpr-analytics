import { PERCENT_DECIMALS, PRICE_DECIMALS, roundTo } from "@/lib/utils/number";
import type {
  Classification,
  ClassificationBasis,
  ClassificationMethod,
  ClassificationResult,
  OverallClassification,
} from "./types";

/**
 * CPR classification.
 *
 * Two independent methods run over every bar and BOTH are always reported. The
 * one that DECIDES the category is configured per instrument:
 *
 *   NIFTY 50            -> POINTS
 *   everything else     -> PERCENTAGE
 *
 * ── Why it is per instrument ───────────────────────────────────────────────
 * The points bands (1–40 / 41–70 / 71–200) were calibrated against a
 * NIFTY-scale index. They are meaningless anywhere else: measured on real
 * sessions, Crude Oil at ~85 produces a CPR width of 0.26 points — below the
 * 1-point floor entirely — while BTC at ~79,000 produces 616 points, far above
 * the 200 ceiling. Width %, which divides by the pivot, stays meaningful at any
 * price scale, so it governs everywhere the points scale does not fit.
 *
 * Both classifications remain visible in the API and the UI. The unused method
 * is reported, not discarded, and `methodsAgree` flags when it disagrees.
 */

/**
 * Band edges for the POINTS method (PRD §11A).
 *
 * The PRD tables are written as integer ranges (1–40, 41–70, 71–200), which
 * leaves gaps for fractional widths such as 40.5. The bands below are treated as
 * continuous half-open intervals closed at the upper edge, so no real width can
 * fall through a gap while every boundary in the PRD's own test list
 * (40→Narrow, 41→Mixed, 70→Mixed, 71→Wider) still holds.
 */
export const POINTS_BANDS = {
  min: 1,
  narrowMax: 40,
  mixedMax: 70,
  widerMax: 200,
} as const;

/** Band edges for the PERCENTAGE method (PRD §11B). Same closed-upper-edge treatment. */
export const PERCENT_BANDS = {
  min: 0.01,
  narrowMax: 0.25,
  mixedMax: 0.49,
} as const;

/**
 * Classify by absolute CPR width in points.
 *
 * The value is rounded to the displayed precision first so the badge a user
 * sees can never contradict the number printed next to it.
 */
export function classifyByPoints(width: number): Classification {
  if (!Number.isFinite(width)) return "BELOW_RANGE";
  const w = roundTo(width, PRICE_DECIMALS);

  if (w < POINTS_BANDS.min) return "BELOW_RANGE";
  if (w <= POINTS_BANDS.narrowMax) return "NARROW";
  if (w <= POINTS_BANDS.mixedMax) return "MIXED";
  if (w <= POINTS_BANDS.widerMax) return "WIDER";
  return "ABOVE_RANGE";
}

/**
 * Classify by CPR width as a percentage of the pivot.
 *
 * Scale-invariant, so this is the method that remains meaningful across
 * instruments of wildly different price magnitudes. It has no upper bound —
 * anything at or above 0.50% is WIDER.
 */
export function classifyByPercentage(widthPercent: number): Classification {
  if (!Number.isFinite(widthPercent)) return "BELOW_RANGE";
  const p = roundTo(widthPercent, PERCENT_DECIMALS);

  if (p < PERCENT_BANDS.min) return "BELOW_RANGE";
  if (p <= PERCENT_BANDS.narrowMax) return "NARROW";
  if (p <= PERCENT_BANDS.mixedMax) return "MIXED";
  return "WIDER";
}

/** True when a method produced an actual band rather than an out-of-range marker. */
function isBanded(
  c: Classification,
): c is Extract<Classification, "NARROW" | "MIXED" | "WIDER"> {
  return c === "NARROW" || c === "MIXED" || c === "WIDER";
}

/** The method the instrument is NOT configured to use. */
function otherMethod(method: ClassificationMethod): ClassificationMethod {
  return method === "POINTS" ? "PERCENTAGE" : "POINTS";
}

/**
 * Decide the category using the instrument's configured method.
 *
 * Rules:
 *   - configured method produced a band  -> that band              (basis PRIMARY)
 *   - it was out of range, other was not -> the other method's band (basis FALLBACK)
 *   - neither produced a band            -> UNCLASSIFIED            (basis NONE)
 *
 * The FALLBACK case is what keeps a category available when a width escapes its
 * configured scale — NIFTY is points-based, but a 250-point width is past the
 * 200-point ceiling, so percentage steps in. It is reported as a fallback rather
 * than presented as the configured method's answer.
 */
export function calculateOverallClassification(
  pointsClassification: Classification,
  percentageClassification: Classification,
  method: ClassificationMethod,
): {
  overallClassification: OverallClassification;
  basis: ClassificationBasis;
  resolvedMethod: ClassificationMethod | null;
} {
  const byMethod: Record<ClassificationMethod, Classification> = {
    POINTS: pointsClassification,
    PERCENTAGE: percentageClassification,
  };

  const primary = byMethod[method];
  if (isBanded(primary)) {
    return {
      overallClassification: primary,
      basis: "PRIMARY",
      resolvedMethod: method,
    };
  }

  const fallbackMethod = otherMethod(method);
  const secondary = byMethod[fallbackMethod];
  if (isBanded(secondary)) {
    return {
      overallClassification: secondary,
      basis: "FALLBACK",
      resolvedMethod: fallbackMethod,
    };
  }

  return {
    overallClassification: "UNCLASSIFIED",
    basis: "NONE",
    resolvedMethod: null,
  };
}

/** Run both methods, then decide with the instrument's configured one. */
export function classify(
  width: number,
  widthPercent: number,
  method: ClassificationMethod,
): ClassificationResult {
  const pointsClassification = classifyByPoints(width);
  const percentageClassification = classifyByPercentage(widthPercent);
  const { overallClassification, basis, resolvedMethod } =
    calculateOverallClassification(
      pointsClassification,
      percentageClassification,
      method,
    );

  return {
    pointsClassification,
    percentageClassification,
    overallClassification,
    basis,
    classificationMethod: method,
    resolvedMethod,
    methodsAgree:
      isBanded(pointsClassification) &&
      isBanded(percentageClassification) &&
      pointsClassification === percentageClassification,
  };
}

/** Human-readable label. */
export function classificationLabel(
  value: Classification | OverallClassification,
): string {
  switch (value) {
    case "BELOW_RANGE":
      return "BELOW RANGE";
    case "ABOVE_RANGE":
      return "ABOVE RANGE";
    case "UNCLASSIFIED":
      return "UNCLASSIFIED";
    default:
      return value;
  }
}

export function methodLabel(method: ClassificationMethod): string {
  return method === "POINTS" ? "width in points" : "width %";
}

/** Short explanation of how the verdict was reached, for tooltips/UI. */
export function basisExplanation(
  basis: ClassificationBasis,
  method: ClassificationMethod,
  resolvedMethod: ClassificationMethod | null,
): string {
  switch (basis) {
    case "PRIMARY":
      return `Category set by ${methodLabel(method)}, the method configured for this instrument.`;
    case "FALLBACK":
      return (
        `This instrument is classified by ${methodLabel(method)}, but the value fell outside that scale ` +
        `(${method === "POINTS" ? `${POINTS_BANDS.min}–${POINTS_BANDS.widerMax} points` : `from ${PERCENT_BANDS.min}%`}), ` +
        `so ${methodLabel(resolvedMethod ?? otherMethod(method))} was used instead.`
      );
    case "NONE":
      return "Neither method produced a classification for this width.";
  }
}
