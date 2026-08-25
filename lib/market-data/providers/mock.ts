import type { Instrument } from "@/lib/instruments";
import { getCalendar } from "../calendar";
import {
  todayInTimeZone,
  type ISODate,
} from "@/lib/utils/date";
import type {
  HistoricalOHLCRequest,
  MarketDataProvider,
  SessionBar,
} from "../provider";

/**
 * DEVELOPMENT-ONLY fixture provider.
 *
 * ⚠ This produces SYNTHETIC prices. It exists so the app can be run and demoed
 * without network access, and it is deliberately kept in its own file behind the
 * same interface so it can never be partially mixed into a real data path
 * (PRD §44). `getMarketDataProvider` refuses to return it under
 * NODE_ENV=production unless explicitly overridden, and `isMock` is propagated
 * all the way to the API response and a UI banner.
 *
 * Output is deterministic: the same instrument and date always yield the same
 * bar, so snapshots and tests are stable.
 */

/** Plausible starting levels, purely so charts look sane in development. */
const BASE_PRICES: Record<string, number> = {
  NIFTY50: 24_200,
  BANKNIFTY: 57_500,
  SENSEX: 77_300,
  GOLD: 4_730,
  SILVER: 69.7,
  CRUDEOIL: 85.5,
  BTC: 79_000,
};

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, fully deterministic. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synthesiseBar(instrument: Instrument, date: ISODate): SessionBar {
  const base = BASE_PRICES[instrument.symbol] ?? 1000;
  const rand = seededRandom(hashString(`${instrument.symbol}:${date}`));

  // Slow drift plus a daily range, both scaled to the instrument's own price.
  const drift = (rand() - 0.5) * base * 0.012;
  const open = base + drift;
  const rangePct = 0.002 + rand() * 0.012;
  const range = open * rangePct;

  const high = open + range * (0.35 + rand() * 0.4);
  const low = open - range * (0.35 + rand() * 0.4);
  const close = low + (high - low) * rand();

  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    date,
    open: round(open),
    high: round(high),
    low: round(low),
    close: round(close),
    volume: Math.round(rand() * 1_000_000),
    complete: true,
  };
}

export class MockMarketDataProvider implements MarketDataProvider {
  readonly id = "mock";
  readonly label = "Mock provider (synthetic development data)";
  readonly isMock = true;

  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async getHistoricalOHLC({
    instrument,
    start,
    end,
  }: HistoricalOHLCRequest): Promise<SessionBar[]> {
    const calendar = getCalendar(instrument.market);
    const today = todayInTimeZone(calendar.timeZone, this.now());

    return calendar.tradingDaysBetween(start, end).map((date) => ({
      ...synthesiseBar(instrument, date),
      // Mirror the real provider's semantics: today's session is not finished.
      complete: date < today,
    }));
  }

  async getLatestOHLC(instrument: Instrument): Promise<SessionBar | null> {
    const calendar = getCalendar(instrument.market);
    const today = todayInTimeZone(calendar.timeZone, this.now());
    const date = calendar.isTradingDay(today)
      ? today
      : calendar.previousTradingDay(today);
    return { ...synthesiseBar(instrument, date), complete: date < today };
  }

  async getTradingCalendar({
    instrument,
    start,
    end,
  }: HistoricalOHLCRequest): Promise<ISODate[]> {
    return getCalendar(instrument.market).tradingDaysBetween(start, end);
  }

  async getResolvedSymbol(instrument: Instrument): Promise<string> {
    return `mock:${instrument.symbol}`;
  }
}
