import { afterEach, describe, expect, it } from "vitest";
import { requireInstrument } from "@/lib/instruments";
import {
  KiteConnectProvider,
  findInstrumentToken,
  hasSessionEnded,
  parseCandle,
  splitCsvRow,
  suggestSymbols,
} from "@/lib/market-data/providers/kite";
import { MarketDataError } from "@/lib/market-data/provider";
import { cacheClear } from "@/lib/services/cache";

/**
 * Kite Connect provider.
 *
 * Exercised entirely through an injected `fetch`, so the suite needs no
 * credentials and no network. The payload shapes below follow the documented
 * contract at https://kite.trade/docs/connect/v3/historical/ — candles are
 * `[timestamp, open, high, low, close, volume]` with `+0530` timestamps, and
 * the instruments endpoint returns CSV keyed on (exchange, tradingsymbol).
 */

const IST = "Asia/Kolkata";
/** 2026-08-25 16:00 IST — after the 15:30 NSE close. */
const AFTER_CLOSE = new Date("2026-08-25T10:30:00Z");
/** 2026-08-25 12:00 IST — mid-session. */
const MID_SESSION = new Date("2026-08-25T06:30:00Z");

const DUMP = [
  "instrument_token,exchange_token,tradingsymbol,name,expiry,instrument_type,segment,exchange",
  "256265,1001,NIFTY 50,NIFTY 50,,EQ,INDICES,NSE",
  "260105,1016,NIFTY BANK,NIFTY BANK,,EQ,INDICES,NSE",
  "53619207,209449,GOLDM26DECFUT,GOLDM,2026-12-31,FUT,MCX-FUT,MCX",
  "53619208,209450,GOLDM27FEBFUT,GOLDM,2027-02-26,FUT,MCX-FUT,MCX",
].join("\n");

function candles(rows: unknown[][]) {
  return { status: "success", data: { candles: rows } };
}

/** Routes the instruments dump and the historical endpoint to canned bodies. */
function providerWith(
  historical: unknown,
  options: { now?: Date; status?: number } = {},
) {
  const fetchImpl = (async (url: string) => {
    if (String(url).includes("/instruments/historical/")) {
      if (options.status && options.status !== 200) {
        return new Response("{}", { status: options.status });
      }
      return new Response(JSON.stringify(historical), { status: 200 });
    }
    return new Response(DUMP, { status: 200 });
  }) as unknown as typeof fetch;

  return new KiteConnectProvider({
    apiKey: "test_key",
    accessToken: "test_token",
    fetchImpl,
    now: () => options.now ?? AFTER_CLOSE,
  });
}

afterEach(() => cacheClear());

describe("credentials", () => {
  const keys = ["KITE_API_KEY", "KITE_ACCESS_TOKEN"] as const;
  const original = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const k of keys) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("refuses to construct without both key and token", () => {
    delete process.env.KITE_API_KEY;
    delete process.env.KITE_ACCESS_TOKEN;
    expect(() => new KiteConnectProvider()).toThrow(MarketDataError);
    expect(() => new KiteConnectProvider()).toThrow(/KITE_API_KEY/);
  });

  it("names the daily expiry in the error, since that is the usual cause", () => {
    delete process.env.KITE_ACCESS_TOKEN;
    process.env.KITE_API_KEY = "k";
    expect(() => new KiteConnectProvider()).toThrow(/6 AM IST/);
  });
});

describe("candle parsing", () => {
  it("maps the documented tuple order", () => {
    const bar = parseCandle(
      ["2026-08-24T09:15:00+0530", 24285.05, 24313.0, 24144.3, 24219.05, 236300],
      IST,
    );
    expect(bar).toEqual({
      date: "2026-08-24",
      open: 24285.05,
      high: 24313.0,
      low: 24144.3,
      close: 24219.05,
      volume: 236300,
    });
  });

  it("resolves the session date in IST, not the server timezone", () => {
    // 00:30 IST is still the previous UTC day; the date must come out as IST.
    const bar = parseCandle(
      ["2026-08-25T00:30:00+0530", 1, 2, 0.5, 1.5, 10],
      IST,
    );
    expect(bar!.date).toBe("2026-08-25");
  });

  it("rejects malformed candles rather than emitting NaN", () => {
    expect(parseCandle([], IST)).toBeNull();
    expect(parseCandle(["2026-08-24T09:15:00+0530", 1, 2, 3], IST)).toBeNull();
    expect(
      parseCandle(["2026-08-24T09:15:00+0530", null, 2, 1, 1.5, 10], IST),
    ).toBeNull();
    expect(parseCandle(["not-a-date", 1, 2, 0.5, 1.5, 10], IST)).toBeNull();
  });
});

describe("session end detection", () => {
  it("is false during the session and true after the close", () => {
    expect(hasSessionEnded(IST, "15:30", MID_SESSION)).toBe(false);
    expect(hasSessionEnded(IST, "15:30", AFTER_CLOSE)).toBe(true);
  });

  it("never reports a close for a market that does not close", () => {
    expect(hasSessionEnded("UTC", null, AFTER_CLOSE)).toBe(false);
  });
});

describe("instrument lookup", () => {
  it("finds a token by exchange and trading symbol", () => {
    expect(findInstrumentToken(DUMP, "NSE", "NIFTY 50")).toBe(256265);
    expect(findInstrumentToken(DUMP, "MCX", "GOLDM26DECFUT")).toBe(53619207);
  });

  it("will not match the same symbol on the wrong exchange", () => {
    expect(findInstrumentToken(DUMP, "MCX", "NIFTY 50")).toBeNull();
  });

  it("suggests live contracts when an expiry has rolled", () => {
    const near = suggestSymbols(DUMP, "GOLDM26AUGFUT");
    expect(near).toContain("GOLDM26DECFUT");
    expect(near).toContain("GOLDM27FEBFUT");
  });

  it("splits quoted CSV fields containing commas", () => {
    expect(splitCsvRow('1,"NIFTY, 50",EQ')).toEqual(["1", "NIFTY, 50", "EQ"]);
  });
});

describe("historical bars", () => {
  const NIFTY = requireInstrument("NIFTY50");

  const request = {
    instrument: NIFTY,
    start: "2026-08-24" as const,
    end: "2026-08-25" as const,
  };

  it("returns bars with the settled prior session complete", async () => {
    const provider = providerWith(
      candles([
        ["2026-08-24T00:00:00+0530", 24285.05, 24313.0, 24144.3, 24219.05, 236300],
        ["2026-08-25T00:00:00+0530", 24175.75, 24334.55, 24115.45, 24280.1, 241800],
      ]),
    );
    const bars = await provider.getHistoricalOHLC(request);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ date: "2026-08-24", complete: true });
    // After the close, coherent, with volume -> final.
    expect(bars[1]).toMatchObject({ date: "2026-08-25", complete: true });
  });

  it("marks today's candle incomplete during the session", async () => {
    const provider = providerWith(
      candles([
        ["2026-08-24T00:00:00+0530", 24285.05, 24313.0, 24144.3, 24219.05, 236300],
        ["2026-08-25T00:00:00+0530", 24175.75, 24334.55, 24115.45, 24280.1, 120000],
      ]),
      { now: MID_SESSION },
    );
    const bars = await provider.getHistoricalOHLC(request);
    expect(bars.find((b) => b.date === "2026-08-25")!.complete).toBe(false);
  });

  it("marks today's candle incomplete when it carries no volume", async () => {
    const provider = providerWith(
      candles([
        ["2026-08-25T00:00:00+0530", 24175.75, 24334.55, 24115.45, 24334.55, 0],
      ]),
    );
    const bars = await provider.getHistoricalOHLC(request);
    expect(bars[0].complete).toBe(false);
  });

  it("marks today's candle incomplete when the close sits outside high/low", async () => {
    const provider = providerWith(
      candles([
        ["2026-08-25T00:00:00+0530", 77295.49, 77587.56, 77125.91, 77645.21, 8700],
      ]),
    );
    const bars = await provider.getHistoricalOHLC(request);
    expect(bars[0].complete).toBe(false);
  });

  it("reports an expired access token in actionable terms", async () => {
    const provider = providerWith(candles([]), { status: 403 });
    await expect(provider.getHistoricalOHLC(request)).rejects.toThrow(
      /expired|invalid/i,
    );
    await expect(provider.getHistoricalOHLC(request)).rejects.toThrow(
      /6 AM IST/,
    );
  });

  it("reports the resolved exchange-qualified symbol for provenance", async () => {
    const provider = providerWith(candles([]));
    expect(await provider.getResolvedSymbol(NIFTY)).toBe("NSE:NIFTY 50");
  });

  it("refuses an instrument with no Kite symbol configured", async () => {
    const provider = providerWith(candles([]));
    await expect(
      provider.getResolvedSymbol(requireInstrument("BTC")),
    ).rejects.toThrow(/no Kite symbol/);
  });
});
