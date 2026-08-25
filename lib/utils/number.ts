/** Numeric helpers shared by the CPR engine and the UI formatters. */

/**
 * Round to `decimals` places without the artefacts of naive `Math.round(x * 10**d)`.
 *
 * Uses exponential-notation shifting, which re-parses the decimal literal and so
 * avoids the binary representation error that makes e.g.
 * `Math.round(1.005 * 100) / 100` return 1 instead of 1.01.
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const shifted = Number(`${value}e${decimals}`);
  if (!Number.isFinite(shifted)) {
    // Extremely large/small magnitudes fall back to the direct approach.
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }
  return Number(`${Math.round(shifted)}e${-decimals}`);
}

/** Decimal places used when displaying and persisting price levels. */
export const PRICE_DECIMALS = 2;
/** Decimal places used for CPR width %, per PRD §10. */
export const PERCENT_DECIMALS = 4;

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
