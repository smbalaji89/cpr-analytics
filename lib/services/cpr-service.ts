import { buildCPRResult } from "@/lib/cpr/calculator";
import {
  filterByCategory,
  matchesCategoryFilter,
  type CategoryFilter,
} from "@/lib/cpr/filter";
import { CPRValidationError, type CPRResult } from "@/lib/cpr/types";
import { isDatabaseConfigured } from "@/lib/db/client";
import {
  findForCompare,
  findHistory,
  findRange,
  resultToInsert,
  upsertCPRRecords,
} from "@/lib/db/repository";
import {
  DEFAULT_INSTRUMENT_SYMBOL,
  INSTRUMENTS,
  requireInstrument,
  type Instrument,
} from "@/lib/instruments";
import {
  getCalendar,
  getMarketDataProvider,
  getProviderForInstrument,
  MarketDataError,
  type MarketDataProvider,
  type SessionBar,
  type TradingCalendar,
} from "@/lib/market-data";
import type {
  CPRLookup,
  CPRRecord,
  CPRUnavailable,
  CPRUnavailableReason,
  DataContext,
} from "@/lib/types";
import { addDays, formatDisplayDate, type ISODate } from "@/lib/utils/date";
import { after } from "next/server";
import { cacheGet, cacheSet, TTL } from "./cache";
import { isWithinRetention, retentionCutoff, retentionDays } from "./retention";

/**
 * CPR service — the orchestration layer.
 *
 * Wires provider -> engine -> calendar -> database into the shapes the API
 * serves. Two invariants govern everything here:
 *
 *  1. A CPR is ALWAYS derived from a session that has FINISHED (PRD §23). An
 *     in-progress bar is excluded before any arithmetic happens.
 *  2. When a CPR cannot be produced, the reason is returned. Nothing here ever
 *     substitutes a zero or a nearby value to fill a hole (PRD §27).
 */

/** Extra lookback so the oldest requested session still has a preceding bar. */
const LOOKBACK_BUFFER_DAYS = 12;

export interface SeriesResult {
  records: CPRRecord[];
  /** Sessions that exist but could not produce a CPR, with the reason. */
  unavailable: { date: ISODate; reason: CPRUnavailableReason; message: string }[];
  context: DataContext;
}

function contextFor(
  provider: MarketDataProvider,
  calendar: TradingCalendar,
  fromDatabase: boolean,
): DataContext {
  return {
    provider: provider.id,
    providerLabel: provider.label,
    isMockData: provider.isMock,
    holidayCoverage: calendar.holidayCoverage,
    fromDatabase,
  };
}

/**
 * Build a `DataContext` without ever throwing.
 *
 * `getMarketDataProvider()` throws on invalid configuration, and several of
 * these call sites sit INSIDE error handlers — so the handler itself would
 * crash and take the whole Server Component render down with it, which is
 * exactly the failure this is meant to report.
 */
function safeContextFor(
  calendar: TradingCalendar,
  fromDatabase: boolean,
): DataContext {
  try {
    return contextFor(getMarketDataProvider(), calendar, fromDatabase);
  } catch {
    return {
      provider: "unknown",
      providerLabel: "Market data provider",
      isMockData: false,
      holidayCoverage: calendar.holidayCoverage,
      fromDatabase,
    };
  }
}

function toRecord(
  result: CPRResult,
  instrument: Instrument,
  provider: MarketDataProvider,
  projected: boolean,
  resolvedSymbol: string,
): CPRRecord {
  return {
    instrumentId: instrument.symbol,
    instrumentSymbol: instrument.symbol,
    instrumentName: instrument.name,
    instrumentCategory: instrument.category,
    currency: instrument.currency,
    tradingDate: result.tradingDate,
    sourceDate: result.sourceDate,
    high: result.high,
    low: result.low,
    close: result.close,
    pivot: result.pivot,
    bc: result.bc,
    tc: result.tc,
    cprWidth: result.cprWidth,
    cprWidthPercent: result.cprWidthPercent,
    pointsClassification: result.pointsClassification,
    percentageClassification: result.percentageClassification,
    overallClassification: result.overallClassification,
    basis: result.basis,
    classificationMethod: result.classificationMethod,
    resolvedMethod: result.resolvedMethod,
    methodsAgree: result.methodsAgree,
    inverted: result.inverted,
    pivotLevels: result.pivotLevels,
    dataSource: provider.id,
    // Records the exact vendor series — for futures, the contract month.
    providerSymbol: resolvedSymbol,
    isMockData: provider.isMock,
    projected,
  };
}

/**
 * Turn a run of observed sessions into CPR records.
 *
 * Each COMPLETED session `d[i]` gets the CPR derived from `d[i-1]` — the
 * previous completed session, exactly as PRD §23 requires. Pairing *observed*
 * consecutive bars (rather than walking the rule-based calendar) means real
 * closures the rule set does not know about — festival holidays especially —
 * are handled correctly for historical data.
 *
 * One extra forward-looking record is appended for the next trading day, which
 * is necessarily a calendar projection and is flagged `projected: true`.
 */
function buildSeries(
  bars: SessionBar[],
  instrument: Instrument,
  provider: MarketDataProvider,
  calendar: TradingCalendar,
  resolvedSymbol: string,
): Omit<SeriesResult, "context"> {
  const complete = bars.filter((bar) => bar.complete);
  const records: CPRRecord[] = [];
  const unavailable: SeriesResult["unavailable"] = [];

  const attempt = (source: SessionBar, target: ISODate, projected: boolean) => {
    try {
      records.push(
        toRecord(
          buildCPRResult(source, target, instrument.classificationMethod),
          instrument,
          provider,
          projected,
          resolvedSymbol,
        ),
      );
    } catch (error) {
      if (error instanceof CPRValidationError) {
        // Most often a single-tick session (open = high = low = close) from a
        // thinly-traded contract. A CPR from that bar would be a meaningless
        // zero-width range, so the date is reported unavailable instead.
        unavailable.push({
          date: target,
          reason: "INVALID_SOURCE_BAR",
          message: `CPR unavailable — the ${source.date} session could not produce a valid range (${error.message}).`,
        });
      } else {
        throw error;
      }
    }
  };

  for (let i = 1; i < complete.length; i++) {
    attempt(complete[i - 1], complete[i].date, false);
  }

  const latest = complete[complete.length - 1];
  if (latest) {
    attempt(latest, calendar.nextTradingDay(latest.date), true);
  }

  records.sort((a, b) => b.tradingDate.localeCompare(a.tradingDate));
  return { records, unavailable };
}

/**
 * Load a computed series straight from the provider.
 *
 * One provider call covers the card, the history table and the charts — the
 * window is fetched whole and every derived view slices it.
 */
async function loadLiveSeries(
  instrument: Instrument,
  start: ISODate,
  end: ISODate,
  options: { fresh?: boolean } = {},
): Promise<SeriesResult> {
  // Per instrument, not global: Indian instruments prefer Upstox and fall back
  // to the configured default when it is unusable.
  const provider = getProviderForInstrument(
    instrument,
    options.fresh ? { revalidateSeconds: 0 } : {},
  );
  const calendar = getCalendar(instrument.market);

  const produce = async (): Promise<{
    series: SeriesResult;
    sessionInProgress: boolean;
  }> => {
    const [bars, resolvedSymbol] = await Promise.all([
      provider.getHistoricalOHLC({
        instrument,
        start: addDays(start, -LOOKBACK_BUFFER_DAYS),
        end,
      }),
      provider.getResolvedSymbol(instrument),
    ]);

    const series: SeriesResult = {
      ...buildSeries(bars, instrument, provider, calendar, resolvedSymbol),
      context: { ...contextFor(provider, calendar, false), resolvedSymbol },
    };

    // A trailing incomplete bar means a session is live and the forward CPR
    // could change; otherwise nothing can move until the next session opens.
    const sessionInProgress = bars.some((bar) => !bar.complete);

    // Write-through: a CPR computed here is durable, so store it rather than
    // recomputing it on the next request. Scheduled AFTER the response so the
    // user never waits on the write.
    persistInBackground(series.records, instrument, provider, resolvedSymbol);

    return { series, sessionInProgress };
  };

  if (options.fresh) return (await produce()).series;

  const key = `series:${provider.id}:${instrument.symbol}:${start}:${end}`;
  const hit = cacheGet<SeriesResult>(key);
  if (hit) return hit;

  const { series, sessionInProgress } = await produce();
  // PRD §26: a completed session's CPR never changes, so when no session is
  // live the whole window is immutable and can be held far longer.
  cacheSet(key, series, sessionInProgress ? TTL.forward : TTL.historical);
  return series;
}

/**
 * Persist computed records without blocking the response.
 *
 * Uses Next's `after()` so the write runs once the response has been sent. It is
 * strictly best-effort: the app is fully correct with no database, so a failure
 * here is logged and swallowed rather than surfaced.
 */
function persistInBackground(
  records: CPRRecord[],
  instrument: Instrument,
  provider: MarketDataProvider,
  resolvedSymbol: string,
): void {
  // Never persist synthetic prices — a stored mock row would outlive the
  // mock provider and be indistinguishable from real data afterwards.
  if (provider.isMock || !isDatabaseConfigured() || records.length === 0) {
    return;
  }

  // The series is fetched with an extra lookback buffer so the oldest requested
  // session still has a preceding bar to derive from. Those buffer rows are
  // OUTSIDE the retention window and must not be stored — PRD §21 requires the
  // table to hold only the retention period, and the sync job already excludes
  // them. Without this filter write-through quietly re-introduces rows that the
  // next cleanup would delete.
  const cutoff = retentionCutoff(todayFor(instrument));
  const retained = records.filter((record) => record.tradingDate >= cutoff);
  if (retained.length === 0) return;

  const write = async () => {
    try {
      const rows = retained.map((record) =>
        resultToInsert(
          {
            ...record,
            pivotLevels: record.pivotLevels,
            projected: record.projected,
          } as Parameters<typeof resultToInsert>[0],
          instrument,
          provider.id,
          resolvedSymbol,
        ),
      );
      await upsertCPRRecords(rows);
    } catch (error) {
      console.error(
        `[cpr-service] write-through persist failed for ${instrument.symbol}`,
        error,
      );
    }
  };

  try {
    // `after` is only valid inside a request/cron scope.
    after(write);
  } catch {
    void write();
  }
}

/**
 * `getSeries` that degrades instead of throwing.
 *
 * Every page begins by resolving a default date and the date-stepper bounds, so
 * an unguarded provider failure there crashes the whole Server Component render
 * before any of the guarded code runs — which in production surfaces only as an
 * opaque digest. PRD §27 requires "market data temporarily unavailable"
 * instead, so provider failures are converted into an empty series and the
 * caller renders the unavailable state.
 *
 * The real error is logged so it remains diagnosable in the platform logs.
 */
async function getSeriesSafe(
  symbol: string,
  options: { fresh?: boolean; start?: ISODate; end?: ISODate } = {},
): Promise<SeriesResult> {
  try {
    return await getSeries(symbol, options);
  } catch (error) {
    console.error(
      `[cpr-service] provider failed for ${symbol}:`,
      error instanceof Error ? error.message : error,
    );
    const instrument = requireInstrument(symbol);
    const calendar = getCalendar(instrument.market);
    return {
      records: [],
      unavailable: [],
      context: safeContextFor(calendar, false),
    };
  }
}

/**
 * Why this instrument can never be served by the active provider, or null.
 *
 * Checked BEFORE any date resolution: with no usable provider there is no
 * series, so the default date comes back null and the caller would otherwise
 * fall through to a generic "try again later" — false for a permanent gap like
 * MCX under Yahoo.
 */
export function unsupportedReason(symbol: string): CPRUnavailable | null {
  const instrument = requireInstrument(symbol);
  let provider: MarketDataProvider;
  try {
    provider = getProviderForInstrument(instrument);
  } catch {
    return null; // Provider misconfigured entirely — a different problem.
  }
  if (provider.supports(instrument)) return null;

  return {
    reason: "PROVIDER_LACKS_INSTRUMENT",
    message:
      `${instrument.name} is not available from ${provider.label}. ` +
      (instrument.market === "MCX"
        ? "MCX contracts require the Upstox provider — set MARKET_DATA_PROVIDER=upstox with an Analytics Token."
        : "Configure a provider that covers this instrument."),
  };
}

/** Today's date in the instrument's own exchange timezone. */
export function todayFor(instrument: Instrument): ISODate {
  return getCalendar(instrument.market).today();
}

/**
 * Full working window for an instrument: the retention period plus the
 * projected next trading day.
 */
export async function getSeries(
  symbol: string,
  options: { fresh?: boolean; start?: ISODate; end?: ISODate } = {},
): Promise<SeriesResult> {
  const instrument = requireInstrument(symbol);
  const today = todayFor(instrument);
  const start = options.start ?? retentionCutoff(today);
  const end = options.end ?? today;
  return loadLiveSeries(instrument, start, end, { fresh: options.fresh });
}

/**
 * The trading date shown by default (PRD §3): the next session for which a CPR
 * can be derived from a COMPLETED one.
 *
 * Note this is not always a future date. When a market's current session is
 * still open — Gold at 09:00 New York, say — the latest completed session is the
 * previous one, so the projected date is TODAY. That is the genuinely useful
 * answer, and `horizonFor` labels it accordingly rather than calling it "next".
 */
export async function getDefaultTradingDate(
  symbol: string,
): Promise<ISODate | null> {
  const series = await getSeriesSafe(symbol);
  const projected = series.records.find((r) => r.projected);
  return projected?.tradingDate ?? series.records[0]?.tradingDate ?? null;
}

export interface DateNavigation {
  /** Dates that actually have a CPR, newest first. */
  availableDates: ISODate[];
  defaultDate: ISODate | null;
  previousDate: ISODate | null;
  nextDate: ISODate | null;
  /** Bounds for the date picker (PRD §6). */
  minDate: ISODate;
  maxDate: ISODate;
}

/**
 * Adjacent trading dates for the date stepper.
 *
 * Derived from dates that actually HAVE a CPR, not from the calendar, so
 * stepping can never land on a weekend, a holiday, or a session whose source bar
 * was rejected. The client needs no calendar logic of its own as a result.
 */
export async function getDateNavigation(
  symbol: string,
  currentDate: ISODate,
): Promise<DateNavigation> {
  const instrument = requireInstrument(symbol);
  const today = todayFor(instrument);
  const series = await getSeriesSafe(symbol);

  // `records` is already newest-first.
  const availableDates = series.records.map((r) => r.tradingDate);
  const defaultDate =
    series.records.find((r) => r.projected)?.tradingDate ??
    availableDates[0] ??
    null;

  const index = availableDates.indexOf(currentDate);
  const previousDate =
    index >= 0
      ? (availableDates[index + 1] ?? null)
      : (availableDates.find((d) => d < currentDate) ?? null);
  const nextDate =
    index > 0
      ? availableDates[index - 1]
      : index === 0
        ? null
        : ([...availableDates].reverse().find((d) => d > currentDate) ?? null);

  return {
    availableDates,
    defaultDate,
    previousDate,
    nextDate,
    minDate: retentionCutoff(today),
    maxDate: availableDates[0] ?? today,
  };
}

export type Horizon = "NEXT" | "CURRENT" | "HISTORICAL";

export function horizonFor(record: CPRRecord, today: ISODate): Horizon {
  if (record.tradingDate > today) return "NEXT";
  if (record.tradingDate === today) return "CURRENT";
  return "HISTORICAL";
}

/**
 * CPR for one instrument on one date.
 *
 * Reads the database when configured and falls back to live computation on a
 * miss, so the app is fully functional before the first sync has ever run.
 */
export async function getCPRForDate(
  symbol: string,
  tradingDate: ISODate,
): Promise<{ lookup: CPRLookup; context: DataContext; today: ISODate }> {
  const instrument = requireInstrument(symbol);
  const calendar = getCalendar(instrument.market);
  const today = calendar.today();

  if (!isWithinRetention(tradingDate, today)) {
    return {
      lookup: {
        available: false,
        error: {
          reason: "OUT_OF_RANGE",
          message: `Only the most recent ${retentionDays()} days are available. Choose a date on or after ${retentionCutoff(today)}.`,
          suggestedDate: retentionCutoff(today),
        },
      },
      context: safeContextFor(calendar, false),
      today,
    };
  }

  // Database first — it is both faster and the only source for sessions that
  // have aged out of the provider's convenient window.
  if (isDatabaseConfigured()) {
    try {
      const rows = await findHistory(symbol, 1, today, tradingDate);
      const hit = rows.find((r) => r.tradingDate === tradingDate);
      if (hit) {
        return {
          lookup: { available: true, record: hit },
          context: safeContextFor(calendar, true),
          today,
        };
      }
    } catch (error) {
      // A database problem must not take the whole page down; fall through to
      // live computation and let the response say where the data came from.
      console.error("[cpr-service] database read failed, computing live", error);
    }
  }

  const unsupported = unsupportedReason(symbol);
  if (unsupported) {
    return {
      lookup: { available: false, error: unsupported },
      context: safeContextFor(calendar, false),
      today,
    };
  }

  try {
    const series = await getSeries(symbol);
    const record = series.records.find((r) => r.tradingDate === tradingDate);
    if (record) {
      return {
        lookup: { available: true, record },
        context: series.context,
        today,
      };
    }

    const blocked = series.unavailable.find((u) => u.date === tradingDate);
    if (blocked) {
      return {
        lookup: {
          available: false,
          error: { reason: blocked.reason, message: blocked.message },
        },
        context: series.context,
        today,
      };
    }

    // Beyond the horizon is NOT missing data: a CPR for day D is derived from
    // day D-1's completed session, so nothing past one session after the last
    // settled one can exist yet. Saying "no data available" invites the user to
    // go looking for a problem that is not there.
    const furthest = series.records[0]?.tradingDate;
    if (furthest && tradingDate > furthest) {
      const waitingOn = calendar.previousTradingDay(tradingDate, false);
      return {
        lookup: {
          available: false,
          error: {
            reason: "BEYOND_HORIZON",
            message:
              `A CPR for ${formatDisplayDate(tradingDate)} is derived from the ` +
              `${formatDisplayDate(waitingOn)} session, which has not completed yet. ` +
              `The furthest date currently available is ${formatDisplayDate(furthest)}.`,
            suggestedDate: furthest,
          },
        },
        context: series.context,
        today,
      };
    }

    // No record and no recorded failure means the exchange simply had no
    // session that day.
    const reason = calendar.closureReason(tradingDate);
    if (reason) {
      const suggested = calendar.previousTradingDay(tradingDate);
      return {
        lookup: {
          available: false,
          error: {
            reason: "MARKET_CLOSED",
            message:
              reason === "WEEKEND"
                ? "The market was closed on this date (weekend)."
                : "The market was closed on this date (holiday).",
            suggestedDate: suggested,
          },
        },
        context: series.context,
        today,
      };
    }

    return {
      lookup: {
        available: false,
        error: {
          reason: "NO_DATA",
          message: "No CPR data available for this date.",
        },
      },
      context: series.context,
      today,
    };
  } catch (error) {
    return {
      lookup: {
        available: false,
        error: {
          reason: "PROVIDER_ERROR",
          message:
            error instanceof MarketDataError
              ? "Market data temporarily unavailable. Please try again later."
              : "Market data temporarily unavailable. Please try again later.",
        },
      },
      context: safeContextFor(calendar, false),
      today,
    };
  }
}

/**
 * Combine stored and computed records, newest first.
 *
 * The live series is preferred on overlap: it is the fresher of the two, and
 * after a futures contract roll the stored rows still hold the previous
 * contract's prices until the next sync rewrites them.
 */
function mergeByTradingDate(
  stored: CPRRecord[],
  live: CPRRecord[],
): CPRRecord[] {
  const byDate = new Map<ISODate, CPRRecord>();
  for (const record of stored) byDate.set(record.tradingDate, record);
  for (const record of live) byDate.set(record.tradingDate, record);
  return [...byDate.values()].sort((a, b) =>
    b.tradingDate.localeCompare(a.tradingDate),
  );
}

/**
 * Most recent `days` sessions, newest first (PRD §12).
 *
 * `categories` filters by CPR category. It means "the most recent `days`
 * sessions THAT MATCH", not "the most recent `days` sessions, minus the ones
 * that don't" — so a filtered table fills up rather than thinning out.
 *
 * ── Partial storage ────────────────────────────────────────────────────────
 * The database is a cache, and write-through fills it gradually, so a partially
 * populated table is the NORMAL state rather than an edge case. Stored rows are
 * therefore only served alone when they fully satisfy the request; otherwise
 * they are merged with the live series. Returning whatever happened to be stored
 * would silently show fewer sessions than exist.
 */
export async function getHistory(
  symbol: string,
  days: number,
  onOrBefore?: ISODate,
  categories: CategoryFilter = null,
): Promise<{
  records: CPRRecord[];
  context: DataContext;
  today: ISODate;
  /** Sessions available before the category filter was applied. */
  totalBeforeFilter: number;
}> {
  const instrument = requireInstrument(symbol);
  const calendar = getCalendar(instrument.market);
  const today = calendar.today();
  const cutoff = onOrBefore ?? today;

  let stored: CPRRecord[] = [];
  let storedUnfiltered: CPRRecord[] | null = null;

  if (isDatabaseConfigured()) {
    try {
      [stored, storedUnfiltered] = await Promise.all([
        findHistory(symbol, days, today, cutoff, categories),
        categories
          ? findHistory(symbol, days, today, cutoff)
          : Promise.resolve(null),
      ]);

      // Sound sufficiency test: `days` matching rows is exactly what was asked
      // for, so no live call is needed.
      if (stored.length >= days) {
        return {
          records: stored,
          context: safeContextFor(calendar, true),
          today,
          totalBeforeFilter: storedUnfiltered?.length ?? stored.length,
        };
      }
    } catch (error) {
      console.error("[cpr-service] history read failed, computing live", error);
      stored = [];
      storedUnfiltered = null;
    }
  }

  const series = await getSeriesSafe(symbol);
  const inWindow = series.records.filter((r) => r.tradingDate <= cutoff);
  const merged = mergeByTradingDate(stored, inWindow).filter(
    (r) => r.tradingDate <= cutoff,
  );

  return {
    records: filterByCategory(merged, categories).slice(0, days),
    context: series.context,
    today,
    totalBeforeFilter: Math.max(
      merged.slice(0, days).length,
      storedUnfiltered?.length ?? 0,
    ),
  };
}

/**
 * Inclusive date range for the comparison charts (PRD §15).
 *
 * Same partial-storage rule as `getHistory`. Sufficiency here is measured
 * against the calendar's trading days for the window, which is an UPPER bound on
 * the real session count (it cannot know unlisted festival holidays). Requiring
 * stored rows to reach that bound therefore never wrongly declares the cache
 * complete — at worst it falls back to a live series that is already cached.
 */
export async function getRangeSeries(
  symbol: string,
  start: ISODate,
  end: ISODate,
  categories: CategoryFilter = null,
): Promise<{
  records: CPRRecord[];
  context: DataContext;
  today: ISODate;
  totalBeforeFilter: number;
}> {
  const instrument = requireInstrument(symbol);
  const calendar = getCalendar(instrument.market);
  const today = calendar.today();

  let stored: CPRRecord[] = [];
  let storedUnfiltered: CPRRecord[] | null = null;

  if (isDatabaseConfigured()) {
    try {
      [stored, storedUnfiltered] = await Promise.all([
        findRange(symbol, start, end, today, categories),
        categories
          ? findRange(symbol, start, end, today)
          : Promise.resolve(null),
      ]);

      const expectedSessions = calendar.tradingDaysBetween(start, end).length;
      const coverage = storedUnfiltered?.length ?? stored.length;
      if (coverage >= expectedSessions && expectedSessions > 0) {
        return {
          records: stored,
          context: safeContextFor(calendar, true),
          today,
          totalBeforeFilter: coverage,
        };
      }
    } catch (error) {
      console.error("[cpr-service] range read failed, computing live", error);
      stored = [];
      storedUnfiltered = null;
    }
  }

  const series = await getSeriesSafe(symbol, { start, end });
  const inWindow = series.records.filter(
    (r) => r.tradingDate >= start && r.tradingDate <= end,
  );
  const merged = mergeByTradingDate(stored, inWindow).filter(
    (r) => r.tradingDate >= start && r.tradingDate <= end,
  );

  return {
    records: filterByCategory(merged, categories),
    context: series.context,
    today,
    totalBeforeFilter: merged.length,
  };
}

export interface CompareRow {
  instrument: {
    symbol: string;
    name: string;
    category: string;
    currency: string;
    note?: string;
  };
  /** The date the caller asked for. */
  requestedDate: ISODate;
  /** The date actually used. May differ from `requestedDate` — see below. */
  tradingDate: ISODate | null;
  /** True when `tradingDate` differs from `requestedDate`. */
  dateAdjusted: boolean;
  /** Human-readable explanation, set only when `dateAdjusted` is true. */
  adjustmentNote: string | null;
  record: CPRRecord | null;
  unavailable: { reason: CPRUnavailableReason; message: string } | null;
}

/**
 * Cross-instrument comparison for a date (PRD §16).
 *
 * Instruments do not share a calendar OR a session clock, so one date rarely
 * maps cleanly across all seven. At 13:20 UTC on a Monday, NIFTY has settled and
 * its next CPR is Tuesday's, while COMEX and BTC are mid-session and their
 * latest derivable CPR is still Monday's. Requiring an exact date match leaves
 * most of the table empty.
 *
 * So each row falls back to that instrument's most recent session AT OR BEFORE
 * the requested date — and says so. `tradingDate`, `dateAdjusted` and
 * `adjustmentNote` are all returned and rendered, because comparing figures from
 * two different dates without showing the dates is precisely how a comparison
 * table misleads.
 */
export async function getComparison(
  tradingDate: ISODate,
  symbols: string[] = INSTRUMENTS.map((i) => i.symbol),
  categories: CategoryFilter = null,
): Promise<{
  rows: CompareRow[];
  context: DataContext;
  totalBeforeFilter: number;
}> {

  const dbRecords = new Map<string, CPRRecord>();
  if (isDatabaseConfigured()) {
    try {
      // Compare spans several markets; the reference instrument's calendar day
      // is close enough to re-evaluate the `projected` flag, which only matters
      // at the today/not-today boundary.
      const referenceToday = todayFor(
        requireInstrument(symbols[0] ?? DEFAULT_INSTRUMENT_SYMBOL),
      );
      for (const record of await findForCompare(
        tradingDate,
        symbols,
        referenceToday,
      )) {
        dbRecords.set(record.instrumentSymbol, record);
      }
    } catch (error) {
      console.error("[cpr-service] compare read failed, computing live", error);
    }
  }

  const rows = await Promise.all(
    symbols.map(async (symbol): Promise<CompareRow> => {
      const instrument = requireInstrument(symbol);
      const meta = {
        symbol: instrument.symbol,
        name: instrument.name,
        category: instrument.category,
        currency: instrument.currency,
        note: instrument.note,
      };

      const exact = (record: CPRRecord): CompareRow => ({
        instrument: meta,
        requestedDate: tradingDate,
        tradingDate: record.tradingDate,
        dateAdjusted: false,
        adjustmentNote: null,
        record,
        unavailable: null,
      });

      const cachedRow = dbRecords.get(symbol);
      if (cachedRow) return exact(cachedRow);

      const { lookup } = await getCPRForDate(symbol, tradingDate);
      if (lookup.available) return exact(lookup.record);

      // No CPR for the exact date. Fall back to this instrument's own most
      // recent session at or before it, disclosing the substitution.
      try {
        const series = await getSeriesSafe(symbol);
        // `records` is sorted newest-first, so the first match is the nearest.
        const nearest = series.records.find(
          (r) => r.tradingDate <= tradingDate,
        );
        if (nearest) {
          return {
            instrument: meta,
            requestedDate: tradingDate,
            tradingDate: nearest.tradingDate,
            dateAdjusted: nearest.tradingDate !== tradingDate,
            adjustmentNote:
              nearest.tradingDate !== tradingDate
                ? `${meta.name} has no session dated ${tradingDate}; showing its most recent CPR (${nearest.tradingDate}).`
                : null,
            record: nearest,
            unavailable: null,
          };
        }
      } catch (error) {
        console.error(`[cpr-service] compare fallback failed for ${symbol}`, error);
      }

      return {
        instrument: meta,
        requestedDate: tradingDate,
        tradingDate: null,
        dateAdjusted: false,
        adjustmentNote: null,
        record: null,
        unavailable: {
          reason: lookup.error.reason,
          message: lookup.error.message,
        },
      };
    }),
  );

  // An unavailable row has no category, so a category filter necessarily hides
  // it — that is correct, not a dropped row.
  const filtered = categories
    ? rows.filter(
        (row) =>
          row.record !== null &&
          matchesCategoryFilter(row.record.overallClassification, categories),
      )
    : rows;

  return {
    rows: filtered,
    totalBeforeFilter: rows.length,
    context: safeContextFor(
      getCalendar(
        requireInstrument(symbols[0] ?? DEFAULT_INSTRUMENT_SYMBOL).market,
      ),
      false,
    ),
  };
}
