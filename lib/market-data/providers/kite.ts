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
 * Zerodha Kite Connect provider.
 *
 * Exchange-sourced Indian market data, which fixes two things Yahoo cannot:
 *
 *  1. **Settlement latency.** Yahoo publishes a settled daily bar hours after
 *     the close — measured 32 minutes after the 2026-08-25 NSE close, its bar
 *     still carried volume 0 and a close exactly equal to the high. Kite serves
 *     the exchange's own candles, so a session is final when the session is.
 *  2. **MCX.** Yahoo has no MCX coverage at all; every MCX symbol returns 404.
 *     Kite reaches MCX futures directly, so Gold/Silver/Crude can be the
 *     contracts Indian traders actually trade rather than COMEX proxies.
 *
 * ── The operational catch ──────────────────────────────────────────────────
 * `access_token` expires at **6 AM IST the next day** — a regulatory
 * requirement, not a design choice — and renewing it needs an interactive
 * browser login. No server-side code can refresh it unattended. This provider
 * therefore reports an expired token explicitly rather than failing opaquely,
 * and the app falls back to its "market data temporarily unavailable" state.
 *
 * Contract verified against https://kite.trade/docs/connect/v3/historical/
 */

const BASE_URL = "https://api.kite.trade";

/** Instrument dumps regenerate once a day; no point re-fetching within one. */
const INSTRUMENTS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;

interface KiteCandleResponse {
  status?: string;
  data?: { candles?: unknown[][] };
  message?: string;
  error_type?: string;
}

export interface KiteProviderOptions {
  apiKey?: string;
  accessToken?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class KiteConnectProvider implements MarketDataProvider {
  readonly id = "kite";
  readonly label = "Zerodha Kite Connect";
  readonly isMock = false;

  private readonly apiKey: string;
  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: KiteProviderOptions = {}) {
    const apiKey = options.apiKey ?? readEnv("KITE_API_KEY");
    const accessToken = options.accessToken ?? readEnv("KITE_ACCESS_TOKEN");

    if (!apiKey || !accessToken) {
      throw new MarketDataError(
        "Kite Connect needs both KITE_API_KEY and KITE_ACCESS_TOKEN. " +
          "The access token expires at 6 AM IST daily and must be regenerated " +
          "through the Kite login flow — see README, 'Kite Connect'.",
      );
    }

    this.apiKey = apiKey;
    this.accessToken = accessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  private headers(): Record<string, string> {
    return {
      "X-Kite-Version": "3",
      Authorization: `token ${this.apiKey}:${this.accessToken}`,
    };
  }

  /** `NSE:NIFTY 50` -> `["NSE", "NIFTY 50"]`. */
  private splitSymbol(instrument: Instrument): [string, string] {
    const raw = instrument.providerSymbols[this.id];
    if (!raw || !raw.includes(":")) {
      throw new MarketDataError(
        `Instrument ${instrument.symbol} has no Kite symbol. Add ` +
          `providerSymbols.kite in the form "EXCHANGE:TRADINGSYMBOL", ` +
          `for example "NSE:NIFTY 50" or "MCX:GOLDM26DECFUT".`,
        { instrumentSymbol: instrument.symbol },
      );
    }
    const idx = raw.indexOf(":");
    return [raw.slice(0, idx).toUpperCase(), raw.slice(idx + 1)];
  }

  /**
   * Map (exchange, tradingsymbol) to the numeric instrument_token.
   *
   * The docs are explicit that this PAIR is the stable key and the token is
   * not: exchanges reuse tokens after derivative expiry. So the daily dump is
   * the lookup rather than a hardcoded token.
   */
  private async resolveToken(instrument: Instrument): Promise<number> {
    const [exchange, tradingsymbol] = this.splitSymbol(instrument);
    const key = `kite:token:${exchange}:${tradingsymbol}`;
    const cached = cacheGet<number>(key);
    if (cached !== undefined) return cached;

    const csv = await this.fetchInstrumentsDump(exchange);
    const token = findInstrumentToken(csv, exchange, tradingsymbol);

    if (token === null) {
      const near = suggestSymbols(csv, tradingsymbol);
      throw new MarketDataError(
        `Kite has no instrument "${exchange}:${tradingsymbol}".` +
          (near.length ? ` Closest matches: ${near.join(", ")}.` : "") +
          " Futures trading symbols embed the expiry, so they change every" +
          " contract cycle.",
        { instrumentSymbol: instrument.symbol },
      );
    }

    cacheSet(key, token, INSTRUMENTS_CACHE_TTL_MS);
    return token;
  }

  private async fetchInstrumentsDump(exchange: string): Promise<string> {
    const key = `kite:dump:${exchange}`;
    const cached = cacheGet<string>(key);
    if (cached !== undefined) return cached;

    // The per-exchange dump is a fraction of the size of the full one.
    const response = await this.request(`/instruments/${exchange}`);
    const csv = await response.text();
    cacheSet(key, csv, INSTRUMENTS_CACHE_TTL_MS);
    return csv;
  }

  private async request(path: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${BASE_URL}${path}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      throw new MarketDataError(
        `${this.label} request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }

    if (response.status === 403) {
      // The single most likely failure in normal operation.
      throw new MarketDataError(
        "Kite access token is invalid or has expired. Tokens expire at 6 AM IST " +
          "daily and must be regenerated through the Kite login flow, then set " +
          "as KITE_ACCESS_TOKEN.",
      );
    }
    if (!response.ok) {
      throw new MarketDataError(
        `${this.label} returned HTTP ${response.status} for ${path}`,
      );
    }
    return response;
  }

  async getHistoricalOHLC({
    instrument,
    start,
    end,
  }: HistoricalOHLCRequest): Promise<SessionBar[]> {
    const token = await this.resolveToken(instrument);
    const market = MARKETS[instrument.market];

    const params = new URLSearchParams({
      from: `${start} 00:00:00`,
      to: `${end} 23:59:59`,
    });
    const response = await this.request(
      `/instruments/historical/${token}/day?${params}`,
    );

    const body = (await response.json()) as KiteCandleResponse;
    if (body.status !== "success" || !body.data?.candles) {
      throw new MarketDataError(
        `${this.label} error: ${body.message ?? "unexpected response shape"}`,
        { instrumentSymbol: instrument.symbol },
      );
    }

    const now = this.now();
    const todayTz = todayInTimeZone(market.timeZone, now);
    const sessionOver = hasSessionEnded(
      market.timeZone,
      market.sessionClose,
      now,
    );

    const bars: SessionBar[] = [];
    for (const candle of body.data.candles) {
      const bar = parseCandle(candle, market.timeZone);
      if (!bar) continue;

      // Same settlement discipline as the Yahoo provider: a same-day candle is
      // final only once the session has ended AND the candle is coherent AND it
      // carries volume. Exchange data normally satisfies all three at the close,
      // which is the whole reason for using this provider.
      const complete =
        bar.date < todayTz
          ? true
          : bar.date === todayTz &&
            sessionOver &&
            bar.close >= bar.low &&
            bar.close <= bar.high &&
            (bar.volume ?? 0) > 0;

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

  async getTradingCalendar(request: HistoricalOHLCRequest): Promise<ISODate[]> {
    return (await this.getHistoricalOHLC(request)).map((bar) => bar.date);
  }

  async getResolvedSymbol(instrument: Instrument): Promise<string> {
    const [exchange, tradingsymbol] = this.splitSymbol(instrument);
    return `${exchange}:${tradingsymbol}`;
  }
}

/* ── pure helpers, exported so they can be tested without a network ─────── */

/** `[timestamp, open, high, low, close, volume]` -> a bar, or null if unusable. */
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

  // "2026-08-25T09:15:00+0530" — resolve the session date in the exchange's own
  // timezone rather than whatever the server happens to run in.
  const parsed = new Date(normaliseOffset(ts));
  if (Number.isNaN(parsed.getTime())) return null;

  return {
    date: todayInTimeZone(timeZone, parsed),
    open: open as number,
    high: high as number,
    low: low as number,
    close: close as number,
    volume: typeof volume === "number" ? volume : null,
  };
}

/** `+0530` is valid ISO 8601 but not accepted by every Date parser. */
function normaliseOffset(timestamp: string): string {
  return timestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

/** Has the market's regular session ended today? A null close never closes. */
export function hasSessionEnded(
  timeZone: string,
  sessionClose: string | null,
  now: Date,
): boolean {
  if (!sessionClose) return false;
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return local >= sessionClose;
}

/** Minimal CSV row splitter that respects quoted fields. */
export function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (quoted) {
      if (char === QUOTE) {
        if (row[i + 1] === QUOTE) {
          field += QUOTE;
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === QUOTE) {
      quoted = true;
    } else if (char === ",") {
      out.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  out.push(field);
  return out;
}

const QUOTE = String.fromCharCode(34);

/** Look up instrument_token by (exchange, tradingsymbol) in an instruments dump. */
export function findInstrumentToken(
  csv: string,
  exchange: string,
  tradingsymbol: string,
): number | null {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;

  const header = splitCsvRow(lines[0]);
  const iToken = header.indexOf("instrument_token");
  const iSymbol = header.indexOf("tradingsymbol");
  const iExchange = header.indexOf("exchange");
  if (iToken === -1 || iSymbol === -1) return null;

  for (let i = 1; i < lines.length; i++) {
    const row = splitCsvRow(lines[i]);
    if (row[iSymbol] !== tradingsymbol) continue;
    if (iExchange !== -1 && row[iExchange] !== exchange) continue;
    const token = Number(row[iToken]);
    if (Number.isFinite(token)) return token;
  }
  return null;
}

/** Nearby trading symbols, so a stale expiry produces an actionable error. */
export function suggestSymbols(
  csv: string,
  tradingsymbol: string,
  limit = 5,
): string[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = splitCsvRow(lines[0]);
  const iSymbol = header.indexOf("tradingsymbol");
  if (iSymbol === -1) return [];

  // Match on the alphabetic root, which is what survives a contract roll.
  const root = tradingsymbol.replace(/[0-9].*$/, "").toUpperCase();
  if (root.length < 2) return [];

  const seen = new Set<string>();
  for (let i = 1; i < lines.length && seen.size < limit; i++) {
    const symbol = splitCsvRow(lines[i])[iSymbol];
    if (symbol && symbol.toUpperCase().startsWith(root)) seen.add(symbol);
  }
  return [...seen];
}
