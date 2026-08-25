/**
 * Shared types for the CPR calculation engine.
 *
 * This module has NO dependency on React, the database, or any market-data
 * provider — the engine is deterministic and independently testable (PRD §34).
 */

/** A completed trading session's price bar. */
export interface OHLC {
  /** Session date, ISO `YYYY-MM-DD` in the instrument's exchange timezone. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

/** Classification produced by a single method (points OR percentage). */
export type Classification =
  | "NARROW"
  | "MIXED"
  | "WIDER"
  /** Value sits below the lowest defined band (PRD §35). */
  | "BELOW_RANGE"
  /** Value sits above the highest defined band (PRD §35). */
  | "ABOVE_RANGE";

/**
 * Which method decides an instrument's category.
 *
 * Configured per instrument (see `lib/instruments`). The points bands were
 * calibrated for NIFTY-scale prices, so NIFTY 50 uses POINTS and every other
 * instrument uses the scale-invariant PERCENTAGE.
 */
export type ClassificationMethod = "POINTS" | "PERCENTAGE";

/** The instrument's category. */
export type OverallClassification =
  | "NARROW"
  | "MIXED"
  | "WIDER"
  /** Neither method could produce a classification. */
  | "UNCLASSIFIED";

/**
 * How the verdict was reached. Always surfaced alongside it, so a fallback is
 * never mistaken for the instrument's configured method.
 */
export type ClassificationBasis =
  /** The instrument's configured method produced the verdict. */
  | "PRIMARY"
  /** The configured method was out of range; the other method governed. */
  | "FALLBACK"
  /** Neither method applied. */
  | "NONE";

export interface ClassificationResult {
  pointsClassification: Classification;
  percentageClassification: Classification;
  overallClassification: OverallClassification;
  basis: ClassificationBasis;
  /** The method configured for this instrument. */
  classificationMethod: ClassificationMethod;
  /** The method that actually produced the verdict. Differs on FALLBACK. */
  resolvedMethod: ClassificationMethod | null;
  /**
   * True when both methods independently produced the SAME band.
   *
   * Not used to decide the verdict — it is reported so the UI can note when the
   * unused method disagrees, which is the transparency the two-method design
   * exists for.
   */
  methodsAgree: boolean;
}

/** The Central Pivot Range itself. */
export interface CPRLevels {
  pivot: number;
  bc: number;
  tc: number;
}

/** Standard pivot support/resistance levels (PRD §14). */
export interface PivotLevels {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  r5: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  s5: number;
}

/** Everything the engine derives from one source bar. */
export interface CPRResult extends CPRLevels, ClassificationResult {
  /** Session the CPR levels APPLY to. */
  tradingDate: string;
  /** Session whose H/L/C produced the levels. Always strictly before tradingDate. */
  sourceDate: string;
  high: number;
  low: number;
  close: number;
  /** TC - BC, in the instrument's price points. */
  cprWidth: number;
  /** (width / pivot) * 100. */
  cprWidthPercent: number;
  pivotLevels: PivotLevels;
  /**
   * True when the raw formula produced BC > TC and the values were swapped to
   * satisfy the TC >= BC invariant (PRD §8). Traders read this as an
   * "inverted CPR"; it does not change the width.
   */
  inverted: boolean;
}

export class CPRValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CPRValidationError";
  }
}
