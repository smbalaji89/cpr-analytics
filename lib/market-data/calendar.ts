import {
  addDays,
  assertISODate,
  isWeekend,
  todayInTimeZone,
  type ISODate,
} from "@/lib/utils/date";
import {
  EXTRA_HOLIDAYS,
  indianRuleHolidays,
  usRuleHolidays,
} from "./holidays";

/**
 * Trading calendar service (PRD §24).
 *
 * Instruments do NOT share a calendar: NSE indices close at weekends and on
 * Indian holidays, COMEX/NYMEX follow the US schedule, and crypto never closes.
 * Assuming the NIFTY calendar for everything would put a Gold CPR on Diwali and
 * omit a BTC CPR on a Sunday.
 */

export type MarketId = "NSE" | "BSE" | "MCX" | "COMEX" | "NYMEX" | "CRYPTO";

/**
 * How trustworthy the forward-projected holiday list is.
 *
 * Surfaced through the API so the UI can be honest about a projected date
 * instead of presenting a guess as a fact.
 */
export type HolidayCoverage =
  /** Every closure is derivable by rule; the projection is reliable. */
  | "COMPLETE"
  /** Rule-derived closures only; lunar-calendar festivals may be missing. */
  | "PARTIAL";

export interface MarketDefinition {
  id: MarketId;
  label: string;
  /** IANA timezone the exchange's calendar day is measured in. */
  timeZone: string;
  /** Crypto trades every day, including weekends. */
  tradesWeekends: boolean;
  holidayRule: ((year: number) => ISODate[]) | null;
  holidayCoverage: HolidayCoverage;
  /**
   * Regular session close, `HH:MM` in the market's own timezone.
   *
   * Only needed by providers that do not return session metadata of their own.
   * Yahoo supplies `currentTradingPeriod`, so it ignores this; Kite's historical
   * API returns bare candles, so it needs to be told when a session has ended
   * before it can judge a same-day candle complete.
   *
   * `null` for markets that never close.
   */
  sessionClose: string | null;
}

export const MARKETS: Record<MarketId, MarketDefinition> = {
  NSE: {
    id: "NSE",
    label: "National Stock Exchange of India",
    timeZone: "Asia/Kolkata",
    tradesWeekends: false,
    holidayRule: indianRuleHolidays,
    // Festival holidays follow lunar calendars and are not rule-derivable.
    holidayCoverage: "PARTIAL",
    sessionClose: "15:30",
  },
  BSE: {
    id: "BSE",
    label: "BSE (Bombay Stock Exchange)",
    timeZone: "Asia/Kolkata",
    tradesWeekends: false,
    holidayRule: indianRuleHolidays,
    holidayCoverage: "PARTIAL",
    sessionClose: "15:30",
  },
  COMEX: {
    id: "COMEX",
    label: "COMEX (CME Group)",
    timeZone: "America/New_York",
    tradesWeekends: false,
    holidayRule: usRuleHolidays,
    holidayCoverage: "COMPLETE",
    sessionClose: "17:00",
  },
  NYMEX: {
    id: "NYMEX",
    label: "NYMEX (CME Group)",
    timeZone: "America/New_York",
    tradesWeekends: false,
    holidayRule: usRuleHolidays,
    holidayCoverage: "COMPLETE",
    sessionClose: "17:00",
  },
  MCX: {
    id: "MCX",
    label: "MCX (Multi Commodity Exchange of India)",
    timeZone: "Asia/Kolkata",
    tradesWeekends: false,
    holidayRule: indianRuleHolidays,
    holidayCoverage: "PARTIAL",
    // MCX evening session runs to 23:30 IST (23:55 under US daylight saving).
    sessionClose: "23:30",
  },
  CRYPTO: {
    id: "CRYPTO",
    label: "Crypto (24/7)",
    timeZone: "UTC",
    tradesWeekends: true,
    holidayRule: null,
    holidayCoverage: "COMPLETE",
    sessionClose: null,
  },
};

/** Guard against runaway scans when a calendar is misconfigured. */
const MAX_SCAN_DAYS = 30;

export class TradingCalendar {
  readonly market: MarketDefinition;
  private readonly holidayCache = new Map<number, Set<ISODate>>();

  constructor(market: MarketDefinition) {
    this.market = market;
  }

  get timeZone(): string {
    return this.market.timeZone;
  }

  get holidayCoverage(): HolidayCoverage {
    return this.market.holidayCoverage;
  }

  /** Today's calendar date in the exchange's own timezone. */
  today(now: Date = new Date()): ISODate {
    return todayInTimeZone(this.market.timeZone, now);
  }

  private holidaysForYear(year: number): Set<ISODate> {
    const cached = this.holidayCache.get(year);
    if (cached) return cached;

    const set = new Set<ISODate>([
      ...(this.market.holidayRule?.(year) ?? []),
      ...(EXTRA_HOLIDAYS[this.market.id] ?? []).filter((d) =>
        d.startsWith(String(year)),
      ),
    ]);
    this.holidayCache.set(year, set);
    return set;
  }

  isHoliday(date: ISODate): boolean {
    return this.holidaysForYear(Number(date.slice(0, 4))).has(date);
  }

  isTradingDay(date: ISODate): boolean {
    assertISODate(date);
    if (!this.market.tradesWeekends && isWeekend(date)) return false;
    return !this.isHoliday(date);
  }

  /** Why a given date is closed, or null when it is a trading day. */
  closureReason(date: ISODate): "WEEKEND" | "HOLIDAY" | null {
    if (this.isTradingDay(date)) return null;
    if (!this.market.tradesWeekends && isWeekend(date)) return "WEEKEND";
    return "HOLIDAY";
  }

  /**
   * First trading day strictly after `date` (or on it when `inclusive`).
   *
   * Friday -> Monday falls out of this naturally, as does skipping a holiday
   * that abuts a weekend.
   */
  nextTradingDay(date: ISODate, inclusive = false): ISODate {
    let cursor = inclusive ? assertISODate(date) : addDays(date, 1);
    for (let i = 0; i < MAX_SCAN_DAYS; i++) {
      if (this.isTradingDay(cursor)) return cursor;
      cursor = addDays(cursor, 1);
    }
    throw new Error(
      `No trading day found within ${MAX_SCAN_DAYS} days after ${date} for ${this.market.id}`,
    );
  }

  /** Last trading day strictly before `date` (or on it when `inclusive`). */
  previousTradingDay(date: ISODate, inclusive = false): ISODate {
    let cursor = inclusive ? assertISODate(date) : addDays(date, -1);
    for (let i = 0; i < MAX_SCAN_DAYS; i++) {
      if (this.isTradingDay(cursor)) return cursor;
      cursor = addDays(cursor, -1);
    }
    throw new Error(
      `No trading day found within ${MAX_SCAN_DAYS} days before ${date} for ${this.market.id}`,
    );
  }

  /** Every trading day in an inclusive range, oldest first. */
  tradingDaysBetween(start: ISODate, end: ISODate): ISODate[] {
    const out: ISODate[] = [];
    for (let d = assertISODate(start); d <= end; d = addDays(d, 1)) {
      if (this.isTradingDay(d)) out.push(d);
    }
    return out;
  }

  /** The `n` most recent trading days up to and including `end`, newest first. */
  lastNTradingDays(end: ISODate, n: number): ISODate[] {
    const out: ISODate[] = [];
    let cursor = this.isTradingDay(end) ? end : this.previousTradingDay(end);
    // n trading days can never span more than n*7 calendar days + holiday slack.
    const limit = n * 7 + MAX_SCAN_DAYS;
    for (let i = 0; i < limit && out.length < n; i++) {
      if (this.isTradingDay(cursor)) out.push(cursor);
      cursor = addDays(cursor, -1);
    }
    return out;
  }

  /**
   * Snap a user-selected date onto a valid trading day.
   *
   * PRD §6 allows either behaviour — move to the nearest valid date, or say the
   * market was closed. This returns both facts so the UI can do the snap AND
   * tell the user it happened.
   */
  resolveSelectedDate(date: ISODate): {
    date: ISODate;
    adjusted: boolean;
    reason: "WEEKEND" | "HOLIDAY" | null;
  } {
    const reason = this.closureReason(date);
    if (!reason) return { date, adjusted: false, reason: null };
    return { date: this.previousTradingDay(date), adjusted: true, reason };
  }
}

const calendarCache = new Map<MarketId, TradingCalendar>();

export function getCalendar(marketId: MarketId): TradingCalendar {
  let cal = calendarCache.get(marketId);
  if (!cal) {
    const def = MARKETS[marketId];
    if (!def) throw new Error(`Unknown market: ${marketId}`);
    cal = new TradingCalendar(def);
    calendarCache.set(marketId, cal);
  }
  return cal;
}
