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
   * Disclosure shown in the UI where the tradeable contract differs from what a
   * user might assume from the name. Never leave a mismatch implicit.
   */
  note?: string;
}

export const CATEGORY_LABELS: Record<InstrumentCategory, string> = {
  INDIAN_INDICES: "Indian Indices",
  COMMODITIES: "Commodities · Global (USD)",
  COMMODITIES_IN: "Commodities · India (INR)",
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
    providerSymbols: { yahoo: "^NSEI", kite: "NSE:NIFTY 50" },
    classificationMethod: "POINTS",
  },
  {
    symbol: "BANKNIFTY",
    name: "BANK NIFTY",
    shortName: "BANKNIFTY",
    category: "INDIAN_INDICES",
    market: "NSE",
    currency: "INR",
    providerSymbols: { yahoo: "^NSEBANK", kite: "NSE:NIFTY BANK" },
    classificationMethod: "PERCENTAGE",
  },
  {
    symbol: "SENSEX",
    name: "SENSEX",
    shortName: "SENSEX",
    category: "INDIAN_INDICES",
    market: "BSE",
    currency: "INR",
    providerSymbols: { yahoo: "^BSESN", kite: "BSE:SENSEX" },
    classificationMethod: "PERCENTAGE",
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
  // ── Commodities · India (INR) ─────────────────────────────────────────────
  //
  // Yahoo has NO MCX coverage — every MCX symbol format returns 404 — so these
  // are the most liquid NSE-listed INR commodity ETFs instead. They are real,
  // exchange-traded instruments on the NSE calendar, but they are NOT the MCX
  // futures contracts, and their price scale is completely different (a
  // GOLDBEES unit is ~INR 133 against MCX gold at ~INR 1,00,000 per 10g).
  //
  // Width % remains comparable to MCX because it divides by the pivot; the
  // BC/P/TC levels do not transfer. Both facts are stated on every card.
  {
    symbol: "GOLD_IN",
    name: "Gold (India)",
    shortName: "Gold IN",
    category: "COMMODITIES_IN",
    market: "NSE",
    currency: "INR",
    providerSymbols: { yahoo: "GOLDBEES.NS", kite: "NSE:GOLDBEES" },
    classificationMethod: "PERCENTAGE",
    note: "Nippon India Gold BeES — an NSE-listed gold ETF in INR, tracking domestic gold prices (import duty and GST included). This is NOT the MCX GOLD futures contract: levels here are ETF unit prices (~INR 133), not MCX contract prices. CPR width % is comparable to MCX; BC/P/TC are not.",
  },
  {
    symbol: "SILVER_IN",
    name: "Silver (India)",
    shortName: "Silver IN",
    category: "COMMODITIES_IN",
    market: "NSE",
    currency: "INR",
    providerSymbols: { yahoo: "SILVERBEES.NS", kite: "NSE:SILVERBEES" },
    classificationMethod: "PERCENTAGE",
    note: "Nippon India Silver ETF — an NSE-listed silver ETF in INR, tracking domestic silver prices. This is NOT the MCX SILVER futures contract: levels here are ETF unit prices, not MCX contract prices. CPR width % is comparable to MCX; BC/P/TC are not.",
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

export function getDefaultInstrument(): Instrument {
  return requireInstrument(DEFAULT_INSTRUMENT_SYMBOL);
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
