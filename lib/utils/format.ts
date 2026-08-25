import { PERCENT_DECIMALS, PRICE_DECIMALS } from "./number";

/**
 * Display formatting.
 *
 * Grouping is `en-US` for every instrument. The PRD's worked examples use that
 * convention ("24,222.25"), and mixing Indian lakh grouping into some rows and
 * not others would make a comparison table harder to scan, not easier.
 */

const priceFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: PRICE_DECIMALS,
  maximumFractionDigits: PRICE_DECIMALS,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: PERCENT_DECIMALS,
  maximumFractionDigits: PERCENT_DECIMALS,
});

const compactFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

/** "24225.450" -> "24,225.45". Returns an em dash for missing values. */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return priceFormatter.format(value);
}

/** 0.0264 -> "0.0264%" (4dp, PRD §10). */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${percentFormatter.format(value)}%`;
}

/** 6.4 -> "6.40 points". */
export function formatWidth(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${priceFormatter.format(value)} ${value === 1 ? "point" : "points"}`;
}

/** Axis labels, where four decimals would be unreadable. */
export function formatCompact(value: number): string {
  return compactFormatter.format(value);
}
