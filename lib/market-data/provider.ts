import type { OHLC } from "@/lib/cpr/types";
import type { Instrument } from "@/lib/instruments";
import type { ISODate } from "@/lib/utils/date";

/**
 * Market-data provider abstraction (PRD §22).
 *
 * The CPR engine, the sync service, the API and the UI all depend on this
 * interface and never on a concrete vendor. Swapping Yahoo for a paid feed means
 * writing one new class and changing `MARKET_DATA_PROVIDER` — no calculation,
 * schema or component code moves.
 */

export interface SessionBar extends OHLC {
  /**
   * Whether the exchange session for this bar has FINISHED.
   *
   * Critical (PRD §23): the current day's bar is live and mutating while the
   * market is open. Projecting tomorrow's CPR from a partial H/L/C produces
   * numbers that silently change under the user.
   */
  complete: boolean;
}

export interface HistoricalOHLCRequest {
  instrument: Instrument;
  /** Inclusive ISO start date. */
  start: ISODate;
  /** Inclusive ISO end date. */
  end: ISODate;
}

export interface MarketDataProvider {
  /** Stable id, matched against `MARKET_DATA_PROVIDER`. */
  readonly id: string;
  /** Human-readable source, shown in the UI for provenance. */
  readonly label: string;
  /** True only for development fixtures. Guarded against in production. */
  readonly isMock: boolean;

  /**
   * Daily bars for a date range, oldest first.
   *
   * Implementations must return ONLY days the exchange actually produced a
   * session for, and must mark an in-progress session `complete: false`.
   */
  getHistoricalOHLC(request: HistoricalOHLCRequest): Promise<SessionBar[]>;

  /** Most recent bar, complete or not. `null` when the provider has no data. */
  getLatestOHLC(instrument: Instrument): Promise<SessionBar | null>;

  /**
   * Dates the exchange actually traded within a range, as OBSERVED by the
   * provider. Authoritative for the past — it reflects real closures including
   * festival holidays that no rule can derive.
   */
  getTradingCalendar(request: HistoricalOHLCRequest): Promise<ISODate[]>;

  /**
   * The vendor symbol actually queried for this instrument.
   *
   * For futures this is the contract month the provider selected, which changes
   * as contracts roll. Recorded alongside every stored CPR so a figure can
   * always be traced to the exact series it came from.
   */
  getResolvedSymbol(instrument: Instrument): Promise<string>;

  /**
   * Can this provider serve this instrument at all?
   *
   * Distinguishes "cannot ever" from "failed just now". MCX instruments are
   * unreachable through Yahoo permanently — it has no MCX coverage — so telling
   * a user to try again later would be false. The UI needs to say which
   * provider is required instead.
   */
  supports(instrument: Instrument): boolean;
}

/** Raised when a provider cannot supply data. Surfaced as PRD §27 messaging. */
export class MarketDataError extends Error {
  readonly instrumentSymbol?: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    options: { instrumentSymbol?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "MarketDataError";
    this.instrumentSymbol = options.instrumentSymbol;
    this.cause = options.cause;
  }
}

/**
 * Latest bar whose session has finished.
 *
 * This is the ONLY bar allowed to seed a forward-looking CPR.
 */
export function latestCompleteBar(bars: SessionBar[]): SessionBar | null {
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].complete) return bars[i];
  }
  return null;
}
