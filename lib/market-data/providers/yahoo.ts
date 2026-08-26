import type { Instrument } from "@/lib/instruments";
import {
  addDays,
  isoToUnixSeconds,
  todayInTimeZone,
  unixSecondsToISO,
  type ISODate,
} from "@/lib/utils/date";
import { getCalendar } from "../calendar";
import { generateContractSymbols, median } from "../contracts";
import {
  MarketDataError,
  type HistoricalOHLCRequest,
  type MarketDataProvider,
  type SessionBar,
} from "../provider";
import { cacheGet, cacheSet } from "@/lib/services/cache";

/**
 * Yahoo Finance chart API provider.
 *
 * Real market data, no API key, covers every instrument in the registry:
 * `^NSEI`, `^NSEBANK`, `^BSESN`, `GC=F`, `SI=F`, `CL=F`, `BTC-USD`.
 *
 * It is an undocumented public endpoint with no published SLA. Everything that
 * depends on vendor specifics is contained in this file; the rest of the app
 * only sees `MarketDataProvider`.
 */

const BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

/**
 * Per-request timeout.
 *
 * Serverless functions are killed by the platform at their duration limit
 * (10s on Vercel Hobby) and that kill CANNOT be caught — it surfaces as an
 * opaque "Server Components render" error rather than the graceful
 * "temporarily unavailable" state. Bounding each request keeps the worst case
 * comfortably inside the limit so a slow vendor degrades instead of crashing.
 */
const REQUEST_TIMEOUT_MS = 6_000;
/** Worst case must stay under the platform limit: 2 attempts + one backoff. */
const DEFAULT_MAX_ATTEMPTS = 2;

/** Listed contract months probed when resolving a futures front month. */
const CONTRACT_CANDIDATES = 4;
/** Sessions sampled when ranking contract liquidity. */
const LIQUIDITY_SAMPLE_SESSIONS = 10;
/** Liquidity rankings do not move intraday; re-probe once per day. */
const CONTRACT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Yahoo rejects requests without a browser-like User-Agent. */
const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
} as const;

interface YahooChartResponse {
  chart: {
    result?: Array<{
      meta: {
        symbol: string;
        currency?: string;
        exchangeTimezoneName?: string;
        gmtoffset?: number;
        currentTradingPeriod?: {
          regular?: { start?: number; end?: number };
        };
      };
      timestamp?: number[];
      indicators: {
        quote: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: { code: string; description: string } | null;
  };
}

export interface YahooProviderOptions {
  /** Seconds of Next.js fetch caching. Pass 0 from the sync job to force fresh. */
  revalidateSeconds?: number;
  /** Total attempts including the first. */
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  /** Injected for deterministic tests. */
  now?: () => Date;
}

export class YahooFinanceProvider implements MarketDataProvider {
  readonly id = "yahoo";
  readonly label = "Yahoo Finance";
  readonly isMock = false;
  /**
   * Yahoo is an explicitly delayed feed and its daily bar keeps moving after
   * the close. An hour covers the drift observed on NSE sessions; the cost is
   * that tomorrow's CPR appears an hour after the close rather than at it,
   * which is the right trade against publishing a figure that later changes.
   */
  readonly settlementDelayMinutes = 60;

  private readonly revalidateSeconds: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: YahooProviderOptions = {}) {
    this.revalidateSeconds = options.revalidateSeconds ?? 300;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  private staticSymbolFor(instrument: Instrument): string {
    const symbol = instrument.providerSymbols[this.id];
    if (!symbol) {
      throw new MarketDataError(
        `Instrument ${instrument.symbol} has no ${this.id} provider symbol`,
        { instrumentSymbol: instrument.symbol },
      );
    }
    return symbol;
  }

  /**
   * Median volume over the most recent sessions, used to rank contract months.
   *
   * Returns `null` when the symbol does not resolve at all, so a non-listed
   * month is skipped rather than treated as zero-volume.
   */
  private async probeLiquidity(symbol: string): Promise<number | null> {
    try {
      const params = new URLSearchParams({ interval: "1d", range: "1mo" });
      // Single attempt: this is a ranking probe, not the data path.
      const result = await this.requestSymbol(symbol, params, 1);
      const quote = result?.[0]?.indicators?.quote?.[0];
      const volumes = (quote?.volume ?? [])
        .slice(-LIQUIDITY_SAMPLE_SESSIONS)
        .filter((v): v is number => typeof v === "number" && v > 0);
      return volumes.length ? median(volumes) : null;
    } catch {
      return null;
    }
  }

  /**
   * Pick the symbol to query for an instrument.
   *
   * Non-futures instruments use their static symbol. Futures generate the next
   * few listed contract months and take the most liquid — which is what "front
   * month" actually means, and what makes the series roll itself without a
   * hardcoded expiry schedule.
   *
   * The choice is cached per instrument per exchange-day: liquidity rankings do
   * not change intraday, and the probe costs one request per candidate.
   */
  async getResolvedSymbol(instrument: Instrument): Promise<string> {
    const spec = instrument.futuresContract;
    if (!spec) return this.staticSymbolFor(instrument);

    const today = getCalendar(instrument.market).today(this.now());
    const cacheKey = `contract:${this.id}:${instrument.symbol}:${today}`;
    const cached = cacheGet<string>(cacheKey);
    if (cached) return cached;

    const candidates = generateContractSymbols(spec, today, CONTRACT_CANDIDATES);
    const ranked = await Promise.all(
      candidates.map(async (symbol) => ({
        symbol,
        volume: await this.probeLiquidity(symbol),
      })),
    );

    const listed = ranked.filter(
      (r): r is { symbol: string; volume: number } => r.volume !== null,
    );

    if (listed.length === 0) {
      // Every candidate failed, which means the vendor is unreachable rather
      // than that a contract has expired. Falling back to the `=F` alias here
      // would silently substitute data measured to understate the daily range
      // by 29–58 %, so this fails loudly instead.
      throw new MarketDataError(
        `Could not resolve an active ${spec.label} contract for ${instrument.symbol} (tried ${candidates.join(", ")})`,
        { instrumentSymbol: instrument.symbol },
      );
    }

    listed.sort((a, b) => b.volume - a.volume);
    const chosen = listed[0].symbol;
    cacheSet(cacheKey, chosen, CONTRACT_CACHE_TTL_MS);
    return chosen;
  }

  private async request(
    instrument: Instrument,
    params: URLSearchParams,
  ): Promise<YahooChartResponse["chart"]["result"]> {
    const symbol = await this.getResolvedSymbol(instrument);
    return this.requestSymbol(symbol, params, this.maxAttempts, instrument);
  }

  private async requestSymbol(
    symbol: string,
    params: URLSearchParams,
    maxAttempts: number,
    instrument?: Instrument,
  ): Promise<YahooChartResponse["chart"]["result"]> {
    const url = `${BASE_URL}/${encodeURIComponent(symbol)}?${params}`;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.fetchImpl(url, {
          headers: REQUEST_HEADERS,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          next:
            this.revalidateSeconds > 0
              ? { revalidate: this.revalidateSeconds }
              : undefined,
          cache: this.revalidateSeconds > 0 ? undefined : "no-store",
        } as RequestInit);

        // 4xx means the symbol or range is wrong — retrying cannot help.
        if (response.status >= 400 && response.status < 500) {
          throw new MarketDataError(
            `${this.label} returned ${response.status} for ${symbol}`,
            { instrumentSymbol: instrument?.symbol },
          );
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const body = (await response.json()) as YahooChartResponse;
        if (body.chart?.error) {
          throw new MarketDataError(
            `${this.label} error for ${symbol}: ${body.chart.error.description}`,
            { instrumentSymbol: instrument?.symbol },
          );
        }
        return body.chart?.result;
      } catch (error) {
        lastError = error;
        // Deterministic failures should not be retried.
        if (error instanceof MarketDataError) break;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
        }
      }
    }

    if (lastError instanceof MarketDataError) throw lastError;
    throw new MarketDataError(
      `${this.label} request failed for ${symbol} after ${maxAttempts} attempts`,
      { instrumentSymbol: instrument?.symbol, cause: lastError },
    );
  }

  /**
   * Parse a chart payload into session bars.
   *
   * Two things matter for correctness:
   *
   *  1. Bar dates are resolved in the EXCHANGE's timezone, not the server's.
   *     A NIFTY session starting 09:15 IST is 03:45 UTC — same calendar date in
   *     IST, and the date must come out as the IST one.
   *
   *  2. Completeness is decided per bar. Any bar dated before "today in the
   *     exchange timezone" is finished. Today's bar is finished only if the
   *     regular session end has passed AND the vendor has actually SETTLED it.
   *     When completeness cannot be PROVEN, the bar is marked incomplete — the
   *     safe direction, since the worst case is falling back to the prior
   *     session rather than publishing a CPR built from a half-formed candle.
   *
   * ── Why the session clock alone is not enough ──────────────────────────
   * Observed on ^NSEI 14 minutes after the 2026-08-25 close: the bar read
   * O 24175.75 / H 24334.55 / L 24115.45 / C 24334.55 with volume 0, while the
   * two preceding sessions carried 236,300 and 259,300. The close was simply
   * the live last price stitched into a bar the vendor had not finalised — and
   * ^BSESN's bar for the same moment reported close 77,645.21 ABOVE its high of
   * 77,587.56, which is impossible.
   *
   * Cross-checking against NSE's own live snapshot settled which half of that
   * mattered. For the same session, NSE reported ^NSEI O 24175.75 / H 24334.55 /
   * L 24115.45 / last 24334.55 — IDENTICAL to Yahoo to the paisa. The index
   * really did close at its high; the zero volume was Yahoo backfilling index
   * volume late, not evidence of an unsettled bar.
   *
   * ^BSESN's close above its high, however, is impossible under any reading.
   *
   * So COHERENCE is the gate, and volume is not: requiring volume rejected data
   * that an independent exchange source confirms is correct.
   */
  private parseBars(
    result: NonNullable<YahooChartResponse["chart"]["result"]>[number],
  ): SessionBar[] {
    const timeZone = result.meta.exchangeTimezoneName ?? "UTC";
    const timestamps = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0];

    if (!quote) return [];

    const now = this.now();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const todayTz = todayInTimeZone(timeZone, now);

    const regularEnd = result.meta.currentTradingPeriod?.regular?.end;
    const regularEndDate =
      typeof regularEnd === "number"
        ? unixSecondsToISO(regularEnd, timeZone)
        : null;

    const bars: SessionBar[] = [];
    const seen = new Set<ISODate>();


    for (let i = 0; i < timestamps.length; i++) {
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      const close = quote.close?.[i];

      // Yahoo emits null rows for non-sessions. Dropping them is what makes
      // `getTradingCalendar` reflect real closures, festival holidays included.
      if (
        typeof high !== "number" ||
        typeof low !== "number" ||
        typeof close !== "number" ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        continue;
      }

      const date = unixSecondsToISO(timestamps[i], timeZone);
      if (seen.has(date)) continue;
      seen.add(date);

      const volume = quote.volume?.[i] ?? null;

      let complete: boolean;
      if (date < todayTz) {
        complete = true;
      } else if (date === todayTz && regularEndDate === todayTz && regularEnd) {
        // The clock must have passed the close PLUS this source's settlement
        // delay, and the bar must be internally coherent. Coherence alone is
        // not enough: a delayed feed's bar stays coherent while it is still
        // moving. See `settlementDelayMinutes`.
        const settledAt = regularEnd + this.settlementDelayMinutes * 60;
        const coherent = close >= low && close <= high;
        complete = nowSeconds >= settledAt && coherent;
      } else {
        complete = false;
      }

      bars.push({
        date,
        open: typeof open === "number" && Number.isFinite(open) ? open : close,
        high,
        low,
        close,
        volume,
        complete,
      });
    }

    bars.sort((a, b) => a.date.localeCompare(b.date));
    return bars;
  }

  async getHistoricalOHLC({
    instrument,
    start,
    end,
  }: HistoricalOHLCRequest): Promise<SessionBar[]> {
    const params = new URLSearchParams({
      interval: "1d",
      // Pad both ends: the API is exclusive-ish at the boundaries and futures
      // sessions can start the evening before their settlement date.
      period1: String(isoToUnixSeconds(addDays(start, -4))),
      period2: String(isoToUnixSeconds(addDays(end, 2))),
      includePrePost: "false",
      events: "div,splits",
    });

    const result = await this.request(instrument, params);
    if (!result?.length) {
      throw new MarketDataError(
        `${this.label} returned no chart data for ${instrument.symbol}`,
        { instrumentSymbol: instrument.symbol },
      );
    }

    return this.parseBars(result[0]).filter(
      (bar) => bar.date >= start && bar.date <= end,
    );
  }

  async getLatestOHLC(instrument: Instrument): Promise<SessionBar | null> {
    const params = new URLSearchParams({ interval: "1d", range: "10d" });
    const result = await this.request(instrument, params);
    if (!result?.length) return null;
    const bars = this.parseBars(result[0]);
    return bars.length ? bars[bars.length - 1] : null;
  }

  supports(instrument: Instrument): boolean {
    return Boolean(instrument.providerSymbols[this.id]);
  }

  async getTradingCalendar(
    request: HistoricalOHLCRequest,
  ): Promise<ISODate[]> {
    const bars = await this.getHistoricalOHLC(request);
    return bars.map((bar) => bar.date);
  }
}
