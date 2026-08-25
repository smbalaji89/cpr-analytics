import type { ISODate } from "@/lib/utils/date";

/**
 * Futures contract symbol generation.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Yahoo's continuous `=F` aliases (`GC=F`, `SI=F`) serve DEFECTIVE daily bars.
 * Measured over 63 real sessions against the identical contract fetched by its
 * explicit exchange symbol:
 *
 *   SI=F      Silver Sep 26   9 zero-range bars   median volume     73   median range 1.11
 *   SIU26.CMX Silver Sep 26   0 zero-range bars   median volume 32,765   median range 2.65
 *   GC=F      Gold Dec 26     1 zero-range bar    median volume    770   median range 67.30
 *   GCZ26.CMX Gold Dec 26     0 zero-range bars   median volume 20,767   median range 95.20
 *
 * Same contract, but the alias understates the median daily range by 58 % for
 * silver and 29 % for gold. CPR width IS the daily range's central band, so the
 * alias corrupts width, width % and therefore the classification. On 21 Aug 2026
 * `GC=F` reported H 4624.1 / L 4560.0 (range 64.1) where the real contract
 * traded H 4690.4 / L 4565.5 (range 124.9) — and the alias matched neither the
 * front NOR the prior contract, so it is not merely a roll offset.
 *
 * The fix is to address contracts explicitly. That introduces expiry, which is
 * solved by generating the next several contract months and letting the provider
 * pick the most liquid one — so the series rolls itself with no maintenance.
 */

/** CME month codes. */
const MONTH_CODES: Record<string, number> = {
  F: 1, G: 2, H: 3, J: 4, K: 5, M: 6,
  N: 7, Q: 8, U: 9, V: 10, X: 11, Z: 12,
};

export interface FuturesContractConfig {
  /** Contract root, e.g. "GC". */
  root: string;
  /** Yahoo exchange suffix, e.g. "CMX" for COMEX, "NYM" for NYMEX. */
  exchangeSuffix: string;
  /**
   * Month codes the exchange actually lists for this product, in calendar order.
   * Gold lists Feb/Apr/Jun/Aug/Oct/Dec; silver Mar/May/Jul/Sep/Dec; crude all 12.
   */
  monthCodes: string[];
  /** Human label used in provenance and error messages. */
  label: string;
}

export const CONTRACT_SPECS = {
  GOLD: {
    root: "GC",
    exchangeSuffix: "CMX",
    monthCodes: ["G", "J", "M", "Q", "V", "Z"],
    label: "COMEX Gold",
  },
  SILVER: {
    root: "SI",
    exchangeSuffix: "CMX",
    monthCodes: ["H", "K", "N", "U", "Z"],
    label: "COMEX Silver",
  },
  CRUDE: {
    root: "CL",
    exchangeSuffix: "NYM",
    monthCodes: ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"],
    label: "NYMEX WTI Crude Oil",
  },
} as const satisfies Record<string, FuturesContractConfig>;

/**
 * The next `count` listed contract months at or after `from`.
 *
 * Starts at the current month so a contract still trading its expiry month stays
 * a candidate; the liquidity check then decides whether it is still the front
 * month or has already rolled.
 */
export function generateContractSymbols(
  config: FuturesContractConfig,
  from: ISODate,
  count = 4,
): string[] {
  const codesByMonth = new Map<number, string>();
  for (const code of config.monthCodes) {
    const month = MONTH_CODES[code];
    if (month === undefined) {
      throw new Error(`Unknown futures month code "${code}"`);
    }
    codesByMonth.set(month, code);
  }

  const startYear = Number(from.slice(0, 4));
  const startMonth = Number(from.slice(5, 7));

  const symbols: string[] = [];
  // 12 * 4 caps the scan at four years, far beyond any listed cycle.
  for (let step = 0; step < 48 && symbols.length < count; step++) {
    const absolute = startMonth - 1 + step;
    const year = startYear + Math.floor(absolute / 12);
    const month = (absolute % 12) + 1;
    const code = codesByMonth.get(month);
    if (!code) continue;
    const yy = String(year % 100).padStart(2, "0");
    symbols.push(`${config.root}${code}${yy}.${config.exchangeSuffix}`);
  }

  return symbols;
}

/** Median of a numeric list. Returns 0 for an empty list. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
