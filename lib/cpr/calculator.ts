import { PERCENT_DECIMALS, PRICE_DECIMALS, roundTo } from "@/lib/utils/number";
import { classify } from "./classification";
import { calculatePivotLevels } from "./pivots";
import {
  CPRValidationError,
  type ClassificationMethod,
  type CPRLevels,
  type CPRResult,
  type OHLC,
} from "./types";

/**
 * CPR calculation engine (PRD §8, §9, §10, §34).
 *
 * Pure and deterministic: same input bar in, same numbers out, no clock reads,
 * no I/O, no UI imports. Everything downstream (API, database, charts) consumes
 * this module rather than re-deriving levels.
 *
 * ── Rounding policy ────────────────────────────────────────────────────────
 * The SOURCE H/L/C is rounded to 2dp first, then the levels are derived from
 * those rounded inputs, then width from the rounded levels, then width % from
 * the rounded width.
 *
 * Rounding the inputs matters for two reasons:
 *
 *  1. **Verifiability.** Everything shown reconciles. A user who takes the
 *     printed H/L/C and works out the pivot by hand gets the printed pivot;
 *     subtracting the printed BC from the printed TC gives the printed width.
 *     Computing from full precision while displaying 2dp breaks that quietly.
 *
 *  2. **Vendor float noise.** Yahoo returns `24378.599609375` for a session
 *     NSE publishes as `24378.60`. Exchange prices ARE 2dp; the extra digits
 *     are IEEE-754 representation artefacts, and rounding them away moves the
 *     input closer to the exchange's own figure, not further from it.
 */

/** Validate a source bar before any arithmetic (PRD §30). */
export function validateOHLC(bar: Pick<OHLC, "high" | "low" | "close">): void {
  const { high, low, close } = bar;

  for (const [name, value] of Object.entries({ high, low, close })) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new CPRValidationError(`${name} is not a finite number`);
    }
  }

  if (high <= low) {
    throw new CPRValidationError(
      `high (${high}) must be greater than low (${low})`,
    );
  }
  if (close < low) {
    throw new CPRValidationError(
      `close (${close}) must be greater than or equal to low (${low})`,
    );
  }
  if (close > high) {
    throw new CPRValidationError(
      `close (${close}) must be less than or equal to high (${high})`,
    );
  }
}

/**
 * Core CPR levels.
 *
 *   P  = (H + L + C) / 3
 *   BC = (H + L) / 2
 *   TC = 2P − BC
 *
 * When the raw arithmetic yields BC > TC the range is "inverted"; the values are
 * swapped so the TC >= BC invariant always holds (PRD §8). The swap is reported
 * back to the caller rather than being silently absorbed, because an inverted
 * CPR is itself a signal traders act on.
 */
export function calculateCPR(bar: Pick<OHLC, "high" | "low" | "close">): CPRLevels & {
  inverted: boolean;
} {
  validateOHLC(bar);

  // Round the inputs to displayed precision before deriving anything, so the
  // levels reconcile with the H/L/C shown alongside them.
  const high = roundTo(bar.high, PRICE_DECIMALS);
  const low = roundTo(bar.low, PRICE_DECIMALS);
  const close = roundTo(bar.close, PRICE_DECIMALS);

  // Rounding can collapse a hair-thin range; that is a degenerate bar at the
  // precision anyone actually trades on.
  validateOHLC({ high, low, close });

  const pivotRaw = (high + low + close) / 3;
  const bcRaw = (high + low) / 2;
  const tcRaw = 2 * pivotRaw - bcRaw;

  const inverted = tcRaw < bcRaw;
  const tcNormalised = Math.max(tcRaw, bcRaw);
  const bcNormalised = Math.min(tcRaw, bcRaw);

  return {
    pivot: roundTo(pivotRaw, PRICE_DECIMALS),
    bc: roundTo(bcNormalised, PRICE_DECIMALS),
    tc: roundTo(tcNormalised, PRICE_DECIMALS),
    inverted,
  };
}

/** CPR width in price points (PRD §9). Never negative — TC >= BC is enforced upstream. */
export function calculateCPRWidth(tc: number, bc: number): number {
  const width = roundTo(tc - bc, PRICE_DECIMALS);
  if (width < 0) {
    throw new CPRValidationError(
      `CPR width must be >= 0 (tc=${tc}, bc=${bc}) — TC/BC were not normalised`,
    );
  }
  return width;
}

/** CPR width as a percentage of the pivot (PRD §10), to 4dp. */
export function calculateCPRWidthPercentage(
  width: number,
  pivot: number,
): number {
  if (!Number.isFinite(pivot) || pivot === 0) {
    throw new CPRValidationError(
      `cannot compute width % against a pivot of ${pivot}`,
    );
  }
  return roundTo((width / Math.abs(pivot)) * 100, PERCENT_DECIMALS);
}

/**
 * Full pipeline for one instrument: source bar -> levels -> width -> width % ->
 * both classifications -> overall verdict -> R1–R5/S1–S5.
 *
 * @param sourceBar   the COMPLETED session supplying H/L/C
 * @param tradingDate the session the resulting levels apply to (must be after sourceBar.date)
 * @param method      which method decides the category for this instrument
 */
export function buildCPRResult(
  sourceBar: OHLC,
  tradingDate: string,
  method: ClassificationMethod,
): CPRResult {
  if (tradingDate <= sourceBar.date) {
    throw new CPRValidationError(
      `tradingDate (${tradingDate}) must be after sourceDate (${sourceBar.date}) — ` +
        `CPR is always projected forward from a completed session`,
    );
  }

  // Everything derives from the SAME rounded inputs that get displayed.
  const high = roundTo(sourceBar.high, PRICE_DECIMALS);
  const low = roundTo(sourceBar.low, PRICE_DECIMALS);
  const close = roundTo(sourceBar.close, PRICE_DECIMALS);

  const { pivot, bc, tc, inverted } = calculateCPR({ high, low, close });
  const cprWidth = calculateCPRWidth(tc, bc);
  const cprWidthPercent = calculateCPRWidthPercentage(cprWidth, pivot);
  const classification = classify(cprWidth, cprWidthPercent, method);

  return {
    tradingDate,
    sourceDate: sourceBar.date,
    high,
    low,
    close,
    pivot,
    bc,
    tc,
    cprWidth,
    cprWidthPercent,
    inverted,
    pivotLevels: calculatePivotLevels(high, low, pivot),
    ...classification,
  };
}
