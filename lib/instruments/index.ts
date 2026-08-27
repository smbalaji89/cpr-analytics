import type { ClassificationMethod } from "@/lib/cpr/types";
import type { MarketId } from "@/lib/market-data/calendar";
import {
  CONTRACT_SPECS,
  type FuturesContractConfig,
} from "@/lib/market-data/contracts";

/**
 * Instrument registry (PRD §2).
 *
 * Adding an instrument means adding one entry here plus a provider symbol
 * mapping — nothing in the CPR engine, API, or UI is instrument-aware.
 *
 * ── Scope: derivatives only ────────────────────────────────────────────────
 * CPR here is used to trade F&O, so every instrument is either a futures
 * contract or an index with a listed derivatives market.
 *
 * The NSE gold and silver ETFs (GOLDBEES, SILVERBEES) were carried for a while
 * as INR commodity stand-ins, from when Yahoo was the only provider and it has
 * no MCX coverage at all. They are deliberately gone: they are cash-segment
 * instruments with NO derivatives — checked against Upstox's NSE master, both
 * appear only as NSE_EQ/EQ rows with zero FUT/CE/PE against them — and their
 * levels are ETF unit prices (~INR 133) that do not transfer to an MCX
 * contract. Upstox reaches the real MCX contracts, so the stand-ins have no
 * remaining purpose. Do not re-add them without a cash-market use case.
 */

export type InstrumentCategory =
  | "INDIAN_INDICES"
  | "COMMODITIES"
  | "COMMODITIES_IN"
  | "CRYPTO";

export interface Instrument {
  /** Stable canonical id, used in URLs, the API and the database. */
  symbol: string;
  name: string;
  /** Compact label for narrow layouts. */
  shortName: string;
  category: InstrumentCategory;
  market: MarketId;
  /** ISO 4217 code of the quoted price. */
  currency: string;
  /** Symbol per provider, keyed by provider id. */
  providerSymbols: Record<string, string>;
  /**
   * Which method decides this instrument's CPR category.
   *
   * POINTS only for NIFTY 50 — the 1–40 / 41–70 / 71–200 bands were calibrated
   * against that index. Every other instrument uses the scale-invariant
   * PERCENTAGE, because a fixed point threshold is meaningless on Crude at ~85
   * or BTC at ~79,000.
   */
  classificationMethod: ClassificationMethod;
  /**
   * Set for exchange-traded futures. The provider generates the next several
   * listed contract months from this and picks the most liquid, so the series
   * rolls itself.
   *
   * Required because Yahoo's continuous `=F` aliases serve defective daily bars
   * — see `lib/market-data/contracts.ts` for the measurements.
   */
  futuresContract?: FuturesContractConfig;
  /**
   * Set for Upstox-reachable exchange futures whose contract rolls.
   *
   * The provider resolves the nearest sufficiently-distant expiry from Upstox's
   * public instrument master, so there is no hardcoded expiry to maintain.
   */
  upstoxContract?: { exchange: "MCX"; root: string };
  /**
   * Provider to use for this instrument when it is usable.
   *
   * Indian instruments prefer Upstox: it is exchange-sourced, settles at the
   * close rather than hours later, and is the only route to MCX. Falls back to
   * the configured default when no Upstox token is present, so the migration is
   * literally just setting `UPSTOX_ACCESS_TOKEN`.
   */
  preferredProvider?: "upstox" | "kite" | "yahoo";
  /**
   * Disclosure shown in the UI where the tradeable contract differs from what a
   * user might assume from the name. Never leave a mismatch implicit.
   */
  note?: string;
}

export const CATEGORY_LABELS: Record<InstrumentCategory, string> = {
  INDIAN_INDICES: "Indian Indices",
  COMMODITIES: "Commodities · Global (USD)",
  COMMODITIES_IN: "Commodities · MCX (INR)",
  CRYPTO: "Cryptocurrency",
};

export const CATEGORY_ORDER: InstrumentCategory[] = [
  "INDIAN_INDICES",
  "COMMODITIES_IN",
  "COMMODITIES",
  "CRYPTO",
];

export const INSTRUMENTS: Instrument[] = [
  {
    symbol: "NIFTY50",
    name: "NIFTY 50",
    shortName: "NIFTY",
    category: "INDIAN_INDICES",
    market: "NSE",
    currency: "INR",
    providerSymbols: {
      yahoo: "^NSEI",
      kite: "NSE:NIFTY 50",
      upstox: "NSE_INDEX|Nifty 50",
    },
    classificationMethod: "POINTS",
    preferredProvider: "upstox",
  },
  {
    symbol: "BANKNIFTY",
    name: "BANK NIFTY",
    shortName: "BANKNIFTY",
    category: "INDIAN_INDICES",
    market: "NSE",
    currency: "INR",
    providerSymbols: {
      yahoo: "^NSEBANK",
      kite: "NSE:NIFTY BANK",
      upstox: "NSE_INDEX|Nifty Bank",
    },
    classificationMethod: "PERCENTAGE",
    preferredProvider: "upstox",
  },
  {
    symbol: "SENSEX",
    name: "SENSEX",
    shortName: "SENSEX",
    category: "INDIAN_INDICES",
    market: "BSE",
    currency: "INR",
    providerSymbols: {
      yahoo: "^BSESN",
      kite: "BSE:SENSEX",
      upstox: "BSE_INDEX|SENSEX",
    },
    classificationMethod: "PERCENTAGE",
    preferredProvider: "upstox",
  },
  {
    symbol: "GOLD",
    name: "Gold",
    shortName: "Gold",
    category: "COMMODITIES",
    market: "COMEX",
    currency: "USD",
    providerSymbols: { yahoo: "GC=F" },
    classificationMethod: "PERCENTAGE",
    futuresContract: CONTRACT_SPECS.GOLD,
    note: "COMEX gold futures in USD per troy ounce — not the MCX INR contract. The most liquid listed contract month is selected automatically and shown with each figure.",
  },
  {
    symbol: "SILVER",
    name: "Silver",
    shortName: "Silver",
    category: "COMMODITIES",
    market: "COMEX",
    currency: "USD",
    providerSymbols: { yahoo: "SI=F" },
    classificationMethod: "PERCENTAGE",
    futuresContract: CONTRACT_SPECS.SILVER,
    note: "COMEX silver futures in USD per troy ounce — not the MCX INR contract. The most liquid listed contract month is selected automatically and shown with each figure.",
  },
  {
    symbol: "CRUDEOIL",
    name: "Crude Oil",
    shortName: "Crude",
    category: "COMMODITIES",
    market: "NYMEX",
    currency: "USD",
    providerSymbols: { yahoo: "CL=F" },
    classificationMethod: "PERCENTAGE",
    futuresContract: CONTRACT_SPECS.CRUDE,
    note: "NYMEX WTI futures in USD per barrel — not the MCX INR contract. The most liquid listed contract month is selected automatically and shown with each figure.",
  },
  // ── MCX futures ───────────────────────────────────────────────────────────
  //
  // The contracts Indian commodity traders actually trade, in INR. Reachable
  // ONLY through Upstox: Yahoo has no MCX coverage (every symbol 404s), so
  // these report unavailable under the default provider. That is deliberate —
  // showing a COMEX proxy under an MCX name would be worse than showing nothing.
  //
  // The contract month rolls; the provider resolves the nearest sufficiently
  // distant expiry from the public instrument master, so no expiry is hardcoded.
  {
    symbol: "GOLD_MCX",
    name: "Gold (MCX)",
    shortName: "Gold MCX",
    category: "COMMODITIES_IN",
    market: "MCX",
    currency: "INR",
    providerSymbols: {},
    upstoxContract: { exchange: "MCX", root: "GOLD" },
    classificationMethod: "PERCENTAGE",
    preferredProvider: "upstox",
    note: "MCX GOLD futures in INR per 10 grams — the contract Indian traders actually trade. Served through Upstox, which is the only source with MCX coverage; without an Upstox token this instrument is unavailable rather than substituted with a COMEX proxy. The contract month rolls automatically.",
  },
  {
    symbol: "SILVER_MCX",
    name: "Silver (MCX)",
    shortName: "Silver MCX",
    category: "COMMODITIES_IN",
    market: "MCX",
    currency: "INR",
    providerSymbols: {},
    upstoxContract: { exchange: "MCX", root: "SILVER" },
    classificationMethod: "PERCENTAGE",
    preferredProvider: "upstox",
    note: "MCX SILVER futures in INR per kilogram. Served through Upstox, the only source with MCX coverage. The contract month rolls automatically.",
  },
  {
    symbol: "CRUDEOIL_MCX",
    name: "Crude Oil (MCX)",
    shortName: "Crude MCX",
    category: "COMMODITIES_IN",
    market: "MCX",
    currency: "INR",
    providerSymbols: {},
    upstoxContract: { exchange: "MCX", root: "CRUDEOIL" },
    classificationMethod: "PERCENTAGE",
    preferredProvider: "upstox",
    note: "MCX CRUDEOIL futures in INR per barrel. Served through Upstox, the only source with MCX coverage. Trades until 23:30 IST, so the next session's CPR appears later in the evening than for the equity markets.",
  },
  {
    symbol: "BTC",
    name: "Bitcoin",
    shortName: "BTC",
    category: "CRYPTO",
    market: "CRYPTO",
    currency: "USD",
    providerSymbols: { yahoo: "BTC-USD" },
    classificationMethod: "PERCENTAGE",
    note: "Trades 24/7 — every calendar day is a trading day, so the CPR rolls over at 00:00 UTC.",
  },
];

export const DEFAULT_INSTRUMENT_SYMBOL = "NIFTY50";

const bySymbol = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));

export function getInstrument(symbol: string): Instrument | undefined {
  return bySymbol.get(symbol.toUpperCase());
}

/** Throwing lookup for code paths where an unknown symbol is a programming error. */
export function requireInstrument(symbol: string): Instrument {
  const instrument = getInstrument(symbol);
  if (!instrument) throw new Error(`Unknown instrument: ${symbol}`);
  return instrument;
}


/** Instruments grouped for the selector, in display order. */
export function instrumentsByCategory(): {
  category: InstrumentCategory;
  label: string;
  instruments: Instrument[];
}[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    instruments: INSTRUMENTS.filter((i) => i.category === category),
  })).filter((group) => group.instruments.length > 0);
}
