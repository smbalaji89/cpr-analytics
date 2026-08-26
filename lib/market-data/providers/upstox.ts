import { gunzipSync } from "node:zlib";
import type { Instrument } from "@/lib/instruments";
import { cacheGet, cacheSet } from "@/lib/services/cache";
import { addDays, todayInTimeZone, type ISODate } from "@/lib/utils/date";
import { readEnv } from "@/lib/utils/env";
import { getCalendar, MARKETS } from "../calendar";
import {
  MarketDataError,
  type HistoricalOHLCRequest,
  type MarketDataProvider,
  type SessionBar,
} from "../provider";

/**
 * Upstox provider, driven by an **Analytics Token**.
 *
 * This is the provider to prefer for Indian instruments. Measured against the
 * alternatives:
 *
 *   | | Yahoo | Kite | Upstox Analytics |
 *   | token upkeep | none | **daily** manual login | **1 year** |
 *   | cost | free | paid add-on | **free** |
 *   | MCX | **none (404)** | yes | **yes** |
 *   | instrument list | n/a | needs auth | **public, no auth** |
 *   | order risk | n/a | full trading scope | **read-only** |
 *
 * The Analytics Token is generated from the Developer Apps dashboard with no
 * OAuth redirect, is valid for a year, and is strictly read-only — it cannot
 * place, modify or cancel an order, so a leaked token cannot trade. Market-data
 * endpoints need no static IP, so it works from serverless.
 *
 * Contract verified against:
 *   https://upstox.com/developer/api-documentation/v3/get-historical-candle-data
 *   https://upstox.com/developer/api-documentation/analytics-token/
 *   https://upstox.com/developer/api-documentation/instruments/
 */

const BASE_URL = "https://api.upstox.com";

/** Instrument masters are public and refresh once a day around 06:00 IST. */
const INSTRUMENTS_URL =
  "https://assets.upstox.com/market-quote/instruments/exchange";
const INSTRUMENTS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Skip a futures contract expiring within this many days.
 *
 * Liquidity migrates to the next month well before expiry, and the final
 * sessions of a contract produce thin, erratic ranges — precisely the defect
 * that made Yahoo's `SI=F` alias unusable.
 */
const ROLL_BUFFER_DAYS = 3;

interface UpstoxCandleResponse {
  status?: string;
  data?: { candles?: unknown[][] };
  errors?: { message?: string; errorCode?: string }[];
}

/** One row of the public instrument master. */
export interface UpstoxInstrument {
  instrument_key: string;
  trading_symbol?: string;
  name?: string;
  segment?: string;
  instrument_type?: string;
  asset_symbol?: string;
  /** Epoch milliseconds. Derivatives only. */
  expiry?: number;
}

export interface UpstoxProviderOptions {
  accessToken?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class UpstoxProvider implements MarketDataProvider {
  readonly id = "upstox";
  readonly label = "Upstox (Analytics Token)";
  readonly isMock = false;
  /** Exchange-sourced, so the daily candle is final shortly after the close.
   * A small buffer absorbs the exchange's own settlement processing. */
  readonly settlementDelayMinutes = 10;

  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: UpstoxProviderOptions = {}) {
    const token = options.accessToken ?? readEnv("UPSTOX_ACCESS_TOKEN");
    if (!token) {
      throw new MarketDataError(
        "Upstox needs UPSTOX_ACCESS_TOKEN. Generate an Analytics Token from the " +
          "Upstox Developer Apps dashboard (Analytics tab) — it is free, valid " +
          "for one year, and read-only. See README, 'Upstox'.",
      );
    }
    this.accessToken = token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * The `instrument_key` to query.
   *
   * Static for indices and equities. For MCX futures the contract rolls, so the
   * nearest sufficiently-distant expiry is resolved from the public instrument
   * master — no hardcoded expiry to maintain.
   */
  async getResolvedSymbol(instrument: Instrument): Promise<string> {
    const contract = instrument.upstoxContract;
    if (contract) return this.resolveFuturesKey(instrument, contract);

    const key = instrument.providerSymbols[this.id];
    if (!key) {
      throw new MarketDataError(
        `Instrument ${instrument.symbol} has no Upstox instrument_key. Add ` +
          `providerSymbols.upstox, for example "NSE_INDEX|Nifty 50".`,
        { instrumentSymbol: instrument.symbol },
      );
    }
    return key;
  }

  private async resolveFuturesKey(
    instrument: Instrument,
    contract: { exchange: string; root: string },
  ): Promise<string> {
    const today = getCalendar(instrument.market).today(this.now());
    const cacheKey = `upstox:fut:${contract.exchange}:${contract.root}:${today}`;
    const cached = cacheGet<string>(cacheKey);
    if (cached) return cached;

    const rows = await this.fetchInstrumentMaster(contract.exchange);
    const chosen = pickFuturesContract(
      rows,
      contract.root,
      this.now().getTime(),
    );

    if (!chosen) {
      throw new MarketDataError(
        `No live ${contract.exchange} futures contract found for "${contract.root}". ` +
          `The instrument master lists no unexpired FUT rows for that root.`,
        { instrumentSymbol: instrument.symbol },
      );
    }

    cacheSet(cacheKey, chosen.instrument_key, INSTRUMENTS_CACHE_TTL_MS);
    return chosen.instrument_key;
  }

  /** The instrument master is public — no Authorization header is sent. */
  private async fetchInstrumentMaster(
    exchange: string,
  ): Promise<UpstoxInstrument[]> {
    const cacheKey = `upstox:master:${exchange}`;
    const cached = cacheGet<UpstoxInstrument[]>(cacheKey);
    if (cached) return cached;

    let response: Response;
    try {
      response = await this.fetchImpl(
        `${INSTRUMENTS_URL}/${exchange}.json.gz`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" },
      );
    } catch (error) {
      throw new MarketDataError(
        `Could not download the ${exchange} instrument master: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new MarketDataError(
        `Instrument master for ${exchange} returned HTTP ${response.status}`,
      );
    }

    const rows = decodeInstrumentMaster(
      Buffer.from(await response.arrayBuffer()),
    );
    cacheSet(cacheKey, rows, INSTRUMENTS_CACHE_TTL_MS);
    return rows;
  }

  /** One authenticated GET against the candle API. */
  private async fetchCandles(
    path: string,
    instrument: Instrument,
  ): Promise<unknown[][]> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${BASE_URL}${path}`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      throw new MarketDataError(
        `${this.label} request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { instrumentSymbol: instrument.symbol, cause: error },
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new MarketDataError(
        "Upstox rejected the access token. An Analytics Token is valid for one " +
          "year — regenerate it from the Developer Apps dashboard (Analytics " +
          "tab) and update UPSTOX_ACCESS_TOKEN. Note only one token is active " +
          "per account, so generating a new one revokes the old.",
        { instrumentSymbol: instrument.symbol },
      );
    }
    if (!response.ok) {
      throw new MarketDataError(
        `${this.label} returned HTTP ${response.status} for ${instrument.symbol}`,
        { instrumentSymbol: instrument.symbol },
      );
    }

    const body = (await response.json()) as UpstoxCandleResponse;
    if (body.status !== "success" || !body.data?.candles) {
      const message = body.errors?.[0]?.message ?? "unexpected response shape";
      throw new MarketDataError(
        `${this.label} error: ${message}${explainUpstoxError(message)}`,
        { instrumentSymbol: instrument.symbol },
      );
    }
    return body.data.candles;
  }

  async getHistoricalOHLC({
    instrument,
    start,
    end,
  }: HistoricalOHLCRequest): Promise<SessionBar[]> {
    const key = await this.getResolvedSymbol(instrument);
    const market = MARKETS[instrument.market];
    const encoded = encodeURIComponent(key);
    const now = this.now();
    const today = todayInTimeZone(market.timeZone, now);

    /*
     * Two endpoints, because the daily series EXCLUDES the current session.
     *
     * Measured at 18:30 IST on 2026-08-26, the daily endpoint's newest candle
     * was 2026-08-25 for every instrument type — indices, NSE equities and MCX
     * futures alike. Today's session lives on the intraday endpoint instead,
     * where `days/1` returns it as a single day candle:
     *
     *   ["2026-08-26T00:00:00+05:30", 24341.95, 24378.6, 24207.75, 24207.75]
     *
     * which matches NSE's own snapshot exactly. Without this the provider would
     * always be a session behind, and the next day's CPR could never be formed.
     */
    const [historical, intraday] = await Promise.all([
      this.fetchCandles(
        `/v3/historical-candle/${encoded}/days/1/${end}/${start}`,
        instrument,
      ),
      end >= today
        ? this.fetchCandles(
            `/v3/historical-candle/intraday/${encoded}/days/1`,
            instrument,
          ).catch(() => [] as unknown[][])
        : Promise.resolve([] as unknown[][]),
    ]);

    // Daily first, so it WINS on overlap: once the end-of-day record exists it
    // is the settled one and the intraday aggregate is superseded.
    const merged = [...historical, ...intraday];
    const todayTz = today;
    const sessionOver = hasSessionEnded(
      market.timeZone,
      market.sessionClose,
      now,
      this.settlementDelayMinutes,
    );

    const bars: SessionBar[] = [];
    const seen = new Set<string>();
    for (const candle of merged) {
      const bar = parseCandle(candle, market.timeZone);
      if (!bar) continue;
      if (seen.has(bar.date)) continue;
      seen.add(bar.date);

      // Same settlement rule as the other providers: a same-day candle is final
      // once the session has ended AND the candle is internally coherent.
      const complete =
        bar.date < todayTz
          ? true
          : bar.date === todayTz &&
            sessionOver &&
            bar.close >= bar.low &&
            bar.close <= bar.high;

      bars.push({ ...bar, complete });
    }

    bars.sort((a, b) => a.date.localeCompare(b.date));
    return bars.filter((bar) => bar.date >= start && bar.date <= end);
  }

  async getLatestOHLC(instrument: Instrument): Promise<SessionBar | null> {
    const today = getCalendar(instrument.market).today(this.now());
    const bars = await this.getHistoricalOHLC({
      instrument,
      start: addDays(today, -10),
      end: today,
    });
    return bars.length ? bars[bars.length - 1] : null;
  }

  supports(instrument: Instrument): boolean {
    return Boolean(
      instrument.providerSymbols[this.id] ?? instrument.upstoxContract,
    );
  }

  async getTradingCalendar(request: HistoricalOHLCRequest): Promise<ISODate[]> {
    return (await this.getHistoricalOHLC(request)).map((bar) => bar.date);
  }
}

/**
 * Turn an Upstox account-level error into something the user can act on.
 *
 * These are account state, not code faults, and the raw wording gives no clue
 * what to actually do — so the fix is spelled out where it is read.
 */
export function explainUpstoxError(message: string): string {
  const text = message.toLowerCase();

  if (text.includes("segment") && text.includes("active")) {
    return (
      " — this is an ACCOUNT setting, not a token problem: your token" +
      " authenticated but the account has no active trading segments. Log in to" +
      " the Upstox app or web (not the developer portal) and reactivate them." +
      " MCX instruments additionally need the COMMODITY segment enabled, which" +
      " usually requires income proof. Until then, MARKET_DATA_PROVIDER=yahoo" +
      " serves everything except MCX."
    );
  }
  if (text.includes("token") || text.includes("unauthor")) {
    return (
      " — regenerate the Analytics Token from Developer Apps (Analytics tab)." +
      " Only one is active per account, so generating a new one revokes the old."
    );
  }
  return "";
}

/* ── pure helpers, exported so they can be tested without a network ─────── */

/** Gunzip when gzipped, then parse. The master is served as `.json.gz`. */
export function decodeInstrumentMaster(buffer: Buffer): UpstoxInstrument[] {
  const isGzip = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const text = (isGzip ? gunzipSync(buffer) : buffer).toString("utf8");
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed) ? (parsed as UpstoxInstrument[]) : [];
}

/**
 * Nearest futures contract that is not about to expire.
 *
 * Contracts within `ROLL_BUFFER_DAYS` of expiry are skipped: liquidity has
 * already migrated to the next month and their ranges go thin and erratic.
 */
export function pickFuturesContract(
  rows: UpstoxInstrument[],
  root: string,
  nowMs: number,
  bufferDays = ROLL_BUFFER_DAYS,
): UpstoxInstrument | null {
  const cutoff = nowMs + bufferDays * 86_400_000;

  const candidates = rows
    .filter(
      (row) =>
        (row.asset_symbol ?? row.name) === root &&
        row.instrument_type === "FUT" &&
        typeof row.expiry === "number",
    )
    .sort((a, b) => (a.expiry as number) - (b.expiry as number));

  return (
    candidates.find((row) => (row.expiry as number) > cutoff) ??
    // Everything is inside the buffer: fall back to the furthest-out contract
    // rather than returning nothing.
    candidates[candidates.length - 1] ??
    null
  );
}

/** `[timestamp, open, high, low, close, volume, oi]` -> a bar, or null. */
export function parseCandle(
  candle: unknown[],
  timeZone: string,
): Omit<SessionBar, "complete"> | null {
  if (!Array.isArray(candle) || candle.length < 6) return null;
  const [ts, open, high, low, close, volume] = candle;
  if (typeof ts !== "string") return null;

  if (
    [open, high, low, close].some(
      (n) => typeof n !== "number" || !Number.isFinite(n),
    )
  ) {
    return null;
  }

  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return null;

  return {
    // Resolve the session date in the exchange's timezone, not the server's.
    date: todayInTimeZone(timeZone, parsed),
    open: open as number,
    high: high as number,
    low: low as number,
    close: close as number,
    volume: typeof volume === "number" ? volume : null,
  };
}

/** Has the market's regular session ended today? A null close never closes. */
export function hasSessionEnded(
  timeZone: string,
  sessionClose: string | null,
  now: Date,
  settlementDelayMinutes = 0,
): boolean {
  if (!sessionClose) return false;
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const [h, m] = sessionClose.split(":").map(Number);
  const settled = h * 60 + m + settlementDelayMinutes;
  const [nh, nm] = local.split(":").map(Number);
  return nh * 60 + nm >= settled;
}
