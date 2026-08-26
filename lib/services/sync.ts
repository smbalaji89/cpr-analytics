import { isDatabaseConfigured } from "@/lib/db/client";
import {
  deleteOlderThan,
  deleteUnreconciled,
  resultToInsert,
  upsertCPRRecords,
} from "@/lib/db/repository";
import { buildCPRResult } from "@/lib/cpr/calculator";
import { CPRValidationError } from "@/lib/cpr/types";
import { INSTRUMENTS, requireInstrument } from "@/lib/instruments";
import {
  getCalendar,
  getMarketDataProvider,
  getProviderForInstrument,
  type SessionBar,
} from "@/lib/market-data";
import { addDays, type ISODate } from "@/lib/utils/date";
import { retentionCutoff, retentionDays } from "./retention";

/**
 * Data synchronisation (PRD §33).
 *
 * Pipeline per instrument:
 *   latest completed session -> OHLC window -> CPR -> width -> width % ->
 *   classification -> R1–R5/S1–S5 -> upsert -> retention cleanup.
 *
 * Idempotent by construction: the upsert keys on
 * (instrument_symbol, trading_date), so a cron retry that overlaps a manual run
 * updates rows rather than duplicating them.
 */

export interface InstrumentSyncResult {
  symbol: string;
  ok: boolean;
  /** Rows written (inserted or updated). */
  written: number;
  /** Sessions skipped because their source bar could not produce a CPR. */
  skipped: { date: ISODate; reason: string }[];
  /** Latest trading date now stored. */
  latestTradingDate: ISODate | null;
  /** Vendor series used; for futures, the resolved contract month. */
  providerSymbol?: string;
  /** Stale rows removed because observed sessions no longer produce them. */
  reconciledAway: number;
  error?: string;
}

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  provider: string;
  databaseConfigured: boolean;
  instruments: InstrumentSyncResult[];
  totalWritten: number;
  deletedByRetention: number;
}

/** Extra lookback so the oldest synced session still has a preceding bar. */
const LOOKBACK_BUFFER_DAYS = 12;

async function syncInstrument(
  symbol: string,
  windowDays: number,
): Promise<InstrumentSyncResult> {
  const result: InstrumentSyncResult = {
    symbol,
    ok: false,
    written: 0,
    skipped: [],
    latestTradingDate: null,
    reconciledAway: 0,
  };

  try {
    const instrument = requireInstrument(symbol);
    const calendar = getCalendar(instrument.market);
    // Bypass the fetch cache: a sync that reads a stale window defeats its
    // purpose. Routed per instrument so stored rows come from the same source
    // the reads use.
    const provider = getProviderForInstrument(instrument, {
      revalidateSeconds: 0,
    });

    if (provider.isMock) {
      throw new Error(
        "Refusing to persist synthetic data — the mock provider is active. " +
          "Set MARKET_DATA_PROVIDER=yahoo before syncing.",
      );
    }

    const today = calendar.today();
    const start = addDays(today, -(windowDays + LOOKBACK_BUFFER_DAYS));

    const [bars, resolvedSymbol] = await Promise.all([
      provider.getHistoricalOHLC({ instrument, start, end: today }),
      provider.getResolvedSymbol(instrument),
    ]);
    result.providerSymbol = resolvedSymbol;

    // PRD §23: only FINISHED sessions may seed a CPR.
    const complete: SessionBar[] = bars.filter((bar) => bar.complete);
    if (complete.length < 2) {
      throw new Error(
        `provider returned ${complete.length} completed session(s) — not enough to derive a CPR`,
      );
    }

    const cutoff = retentionCutoff(today);
    const inserts: ReturnType<typeof resultToInsert>[] = [];

    const build = (
      sourceIndex: number,
      tradingDate: ISODate,
      projected: boolean,
    ) => {
      if (tradingDate < cutoff) return; // outside retention; would be deleted anyway
      try {
        inserts.push(
          resultToInsert(
            {
              ...buildCPRResult(
                complete[sourceIndex],
                tradingDate,
                instrument.classificationMethod,
              ),
              projected,
            },
            instrument,
            provider.id,
            resolvedSymbol,
          ),
        );
      } catch (error) {
        if (error instanceof CPRValidationError) {
          result.skipped.push({ date: tradingDate, reason: error.message });
        } else {
          throw error;
        }
      }
    };

    // Historical: each completed session takes the CPR of the one before it.
    for (let i = 1; i < complete.length; i++) {
      build(i - 1, complete[i].date, false);
    }
    // Forward: the next trading day, from the most recent completed session.
    const latest = complete[complete.length - 1];
    build(complete.length - 1, calendar.nextTradingDay(latest.date), true);

    if (isDatabaseConfigured()) {
      result.written = await upsertCPRRecords(inserts);

      // Reconcile: drop rows in the window that observed sessions no longer
      // produce, so a mis-projected date cannot survive as phantom history.
      const keep = inserts.map((row) => row.tradingDate);
      if (keep.length > 0) {
        result.reconciledAway = await deleteUnreconciled(
          instrument.symbol,
          keep[0],
          keep[keep.length - 1],
          keep,
        );
      }
    }

    result.latestTradingDate =
      inserts.length > 0 ? inserts[inserts.length - 1].tradingDate : null;
    result.ok = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

/**
 * Sync every instrument, then enforce retention.
 *
 * Instruments are synced concurrently but failures are isolated — one dead
 * symbol must not stop the other six from updating.
 */
export async function runSync(
  options: { symbols?: string[]; windowDays?: number } = {},
): Promise<SyncResult> {
  const startedAt = new Date();
  const symbols = options.symbols ?? INSTRUMENTS.map((i) => i.symbol);
  const windowDays = options.windowDays ?? retentionDays();

  const instruments = await Promise.all(
    symbols.map((symbol) => syncInstrument(symbol, windowDays)),
  );

  let deletedByRetention = 0;
  if (isDatabaseConfigured()) {
    try {
      deletedByRetention = await runCleanup();
    } catch (error) {
      console.error("[sync] retention cleanup failed", error);
    }
  }

  const finishedAt = new Date();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    provider: getMarketDataProvider().id,
    databaseConfigured: isDatabaseConfigured(),
    instruments,
    totalWritten: instruments.reduce((sum, i) => sum + i.written, 0),
    deletedByRetention,
  };
}

/**
 * Retention cleanup (PRD §21).
 *
 * Equivalent to:
 *   DELETE FROM cpr_data WHERE trading_date < CURRENT_DATE - INTERVAL '90 days';
 *
 * The cutoff is computed in UTC and applied uniformly. Instrument calendars
 * differ by at most a day at the boundary, which is immaterial for a 90-day
 * window and keeps the delete a single indexed statement.
 */
export async function runCleanup(): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const today = new Date().toISOString().slice(0, 10);
  return deleteOlderThan(retentionCutoff(today));
}
