import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { INSTRUMENTS, requireInstrument } from "@/lib/instruments";
import { MarketDataError } from "@/lib/market-data/provider";
import {
  UpstoxProvider,
  decodeInstrumentMaster,
  explainUpstoxError,
  hasSessionEnded,
  parseCandle,
  pickFuturesContract,
  type UpstoxInstrument,
} from "@/lib/market-data/providers/upstox";
import { cacheClear } from "@/lib/services/cache";

/**
 * Upstox provider, driven by an Analytics Token.
 *
 * Exercised through an injected `fetch`, so no token and no network are needed.
 * Shapes follow the documented contract:
 *   candles  [timestamp, open, high, low, close, volume, oi]
 *   endpoint /v3/historical-candle/:key/:unit/:interval/:to/:from
 *
 * The instrument keys asserted below were read from Upstox's PUBLIC instrument
 * master during development, so they are real rather than guessed.
 */

const IST = "Asia/Kolkata";
/** 2026-08-25 16:00 IST — after the 15:30 NSE close. */
const AFTER_CLOSE = new Date("2026-08-25T10:30:00Z");
/** 2026-08-25 12:00 IST — mid-session. */
const MID_SESSION = new Date("2026-08-25T06:30:00Z");

const MCX_MASTER: UpstoxInstrument[] = [
  {
    instrument_key: "MCX_FO|483078",
    trading_symbol: "GOLD FUT 05 SEP 26",
    asset_symbol: "GOLD",
    instrument_type: "FUT",
    segment: "MCX_FO",
    expiry: Date.UTC(2026, 8, 5),
  },
  {
    instrument_key: "MCX_FO|483079",
    trading_symbol: "GOLD FUT 05 OCT 26",
    asset_symbol: "GOLD",
    instrument_type: "FUT",
    segment: "MCX_FO",
    expiry: Date.UTC(2026, 9, 5),
  },
  {
    instrument_key: "MCX_FO|999999",
    trading_symbol: "GOLD 60000 CE",
    asset_symbol: "GOLD",
    instrument_type: "CE",
    segment: "MCX_FO",
    expiry: Date.UTC(2026, 8, 5),
  },
];

function candles(rows: unknown[][]) {
  return { status: "success", data: { candles: rows } };
}

function providerWith(
  historical: unknown,
  options: { now?: Date; status?: number; intraday?: unknown } = {},
) {
  const fetchImpl = (async (url: string) => {
    const u = String(url);
    if (u.includes("assets.upstox.com")) {
      return new Response(gzipSync(Buffer.from(JSON.stringify(MCX_MASTER))), {
        status: 200,
      });
    }
    if (options.status && options.status !== 200) {
      return new Response("{}", { status: options.status });
    }
    // The current session comes from the intraday endpoint, not the daily one.
    if (u.includes("/historical-candle/intraday/")) {
      return new Response(
        JSON.stringify(options.intraday ?? candles([])),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify(historical), { status: 200 });
  }) as unknown as typeof fetch;

  return new UpstoxProvider({
    accessToken: "analytics_token",
    fetchImpl,
    now: () => options.now ?? AFTER_CLOSE,
  });
}

afterEach(() => cacheClear());

describe("credentials", () => {
  const original = process.env.UPSTOX_ACCESS_TOKEN;
  afterEach(() => {
    if (original === undefined) delete process.env.UPSTOX_ACCESS_TOKEN;
    else process.env.UPSTOX_ACCESS_TOKEN = original;
  });

  it("refuses to construct without a token, and says where to get one", () => {
    delete process.env.UPSTOX_ACCESS_TOKEN;
    expect(() => new UpstoxProvider()).toThrow(MarketDataError);
    expect(() => new UpstoxProvider()).toThrow(/Analytics Token/);
  });
});

describe("candle parsing", () => {
  it("maps the documented tuple order, ignoring open interest", () => {
    const bar = parseCandle(
      ["2026-08-24T00:00:00+05:30", 24285.05, 24313.0, 24144.3, 24219.05, 236300, 0],
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
    const bar = parseCandle(
      ["2026-08-25T00:30:00+05:30", 1, 2, 0.5, 1.5, 10, 0],
      IST,
    );
    expect(bar!.date).toBe("2026-08-25");
  });

  it("rejects malformed candles rather than emitting NaN", () => {
    expect(parseCandle([], IST)).toBeNull();
    expect(parseCandle(["2026-08-24T00:00:00+05:30", 1, 2], IST)).toBeNull();
    expect(
      parseCandle(["2026-08-24T00:00:00+05:30", null, 2, 1, 1.5, 10, 0], IST),
    ).toBeNull();
  });
});

describe("instrument master", () => {
  it("decodes a gzipped master", () => {
    const rows = decodeInstrumentMaster(
      gzipSync(Buffer.from(JSON.stringify(MCX_MASTER))),
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].instrument_key).toBe("MCX_FO|483078");
  });

  it("decodes an uncompressed master too", () => {
    const rows = decodeInstrumentMaster(
      Buffer.from(JSON.stringify(MCX_MASTER)),
    );
    expect(rows).toHaveLength(3);
  });

  it("returns an empty list for an unexpected payload", () => {
    expect(decodeInstrumentMaster(Buffer.from('{"not":"an array"}'))).toEqual(
      [],
    );
  });
});

describe("futures contract selection", () => {
  const nowMs = Date.UTC(2026, 7, 25);

  it("takes the nearest expiry that is comfortably out", () => {
    const picked = pickFuturesContract(MCX_MASTER, "GOLD", nowMs);
    expect(picked!.instrument_key).toBe("MCX_FO|483078");
  });

  it("skips a contract inside the roll buffer", () => {
    // Two days before the September expiry, liquidity has already moved on.
    const nearExpiry = Date.UTC(2026, 8, 3);
    const picked = pickFuturesContract(MCX_MASTER, "GOLD", nearExpiry);
    expect(picked!.instrument_key).toBe("MCX_FO|483079");
  });

  it("never selects an option as a futures contract", () => {
    const picked = pickFuturesContract(MCX_MASTER, "GOLD", nowMs);
    expect(picked!.instrument_type).toBe("FUT");
  });

  it("returns null for a root with no contracts", () => {
    expect(pickFuturesContract(MCX_MASTER, "ZINC", nowMs)).toBeNull();
  });
});

describe("session end detection", () => {
  it("is false during the session and true after the close", () => {
    expect(hasSessionEnded(IST, "15:30", MID_SESSION)).toBe(false);
    expect(hasSessionEnded(IST, "15:30", AFTER_CLOSE)).toBe(true);
  });

  it("keeps MCX open in the afternoon, since it runs to 23:30", () => {
    expect(hasSessionEnded(IST, "23:30", AFTER_CLOSE)).toBe(false);
  });
});

describe("historical bars", () => {
  const request = {
    instrument: requireInstrument("NIFTY50"),
    start: "2026-08-24" as const,
    end: "2026-08-25" as const,
  };

  it("returns settled prior sessions as complete", async () => {
    const provider = providerWith(
      candles([
        ["2026-08-24T00:00:00+05:30", 24285.05, 24313.0, 24144.3, 24219.05, 236300, 0],
        ["2026-08-25T00:00:00+05:30", 24175.75, 24334.55, 24115.45, 24334.55, 241800, 0],
      ]),
    );
    const bars = await provider.getHistoricalOHLC(request);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ date: "2026-08-24", complete: true });
    expect(bars[1]).toMatchObject({ date: "2026-08-25", complete: true });
  });

  it("marks today's candle incomplete during the session", async () => {
    const provider = providerWith(
      candles([
        ["2026-08-25T00:00:00+05:30", 24175.75, 24334.55, 24115.45, 24280.1, 120000, 0],
      ]),
      { now: MID_SESSION },
    );
    const bars = await provider.getHistoricalOHLC(request);
    expect(bars[0].complete).toBe(false);
  });

  it("marks today's candle incomplete when the close sits outside high/low", async () => {
    const provider = providerWith(
      candles([
        ["2026-08-25T00:00:00+05:30", 77295.49, 77587.56, 77125.91, 77645.21, 8700, 0],
      ]),
    );
    const bars = await provider.getHistoricalOHLC(request);
    expect(bars[0].complete).toBe(false);
  });

  it("explains a rejected token in terms of the Analytics Token", async () => {
    const provider = providerWith(candles([]), { status: 401 });
    await expect(provider.getHistoricalOHLC(request)).rejects.toThrow(
      /Analytics Token/,
    );
  });
});

describe("the current session comes from the intraday endpoint", () => {
  const request = {
    instrument: requireInstrument("NIFTY50"),
    start: "2026-08-24" as const,
    end: "2026-08-25" as const,
  };

  it("merges today's intraday day-candle with the daily series", async () => {
    // Measured: at 18:30 IST the daily endpoint's newest candle was the PREVIOUS
    // session for every instrument type. Today lives on the intraday endpoint.
    const provider = providerWith(
      candles([
        ["2026-08-24T00:00:00+05:30", 24285.05, 24313.0, 24144.3, 24219.05, 0, 0],
      ]),
      {
        intraday: candles([
          ["2026-08-25T00:00:00+05:30", 24341.95, 24378.6, 24207.75, 24207.75, 0, 0],
        ]),
      },
    );
    const bars = await provider.getHistoricalOHLC(request);
    expect(bars.map((b) => b.date)).toEqual(["2026-08-24", "2026-08-25"]);
    expect(bars[1].high).toBe(24378.6);
    expect(bars[1].complete).toBe(true);
  });

  it("prefers the settled daily record when both endpoints have the date", async () => {
    const provider = providerWith(
      candles([
        ["2026-08-25T00:00:00+05:30", 1, 2, 0.5, 1.5, 111, 0],
      ]),
      {
        intraday: candles([
          ["2026-08-25T00:00:00+05:30", 9, 9, 9, 9, 999, 0],
        ]),
      },
    );
    const bars = await provider.getHistoricalOHLC(request);
    expect(bars).toHaveLength(1);
    expect(bars[0].volume).toBe(111);
  });

  it("survives the intraday endpoint failing", async () => {
    const provider = providerWith(
      candles([
        ["2026-08-24T00:00:00+05:30", 24285.05, 24313.0, 24144.3, 24219.05, 0, 0],
      ]),
      { intraday: { status: "error", errors: [{ message: "boom" }] } },
    );
    const bars = await provider.getHistoricalOHLC(request);
    expect(bars.map((b) => b.date)).toEqual(["2026-08-24"]);
  });
});

describe("account-level errors are explained, not just relayed", () => {
  it("identifies inactive segments as an account setting", () => {
    const hint = explainUpstoxError(
      "No segments for these users are active. Manual reactivation is recommended from Upstox app/web.",
    );
    expect(hint).toContain("ACCOUNT setting");
    expect(hint).toContain("COMMODITY segment");
    expect(hint).toContain("yahoo");
  });

  it("surfaces the hint through the provider", async () => {
    const provider = providerWith({
      status: "error",
      errors: [
        { message: "No segments for these users are active.", errorCode: "UDAPI" },
      ],
    });
    await expect(
      provider.getHistoricalOHLC({
        instrument: requireInstrument("NIFTY50"),
        start: "2026-08-24",
        end: "2026-08-25",
      }),
    ).rejects.toThrow(/ACCOUNT setting/);
  });

  it("points a token error at regeneration instead", () => {
    expect(explainUpstoxError("Invalid token used to access API")).toContain(
      "regenerate the Analytics Token",
    );
  });

  it("adds nothing for an error it does not recognise", () => {
    expect(explainUpstoxError("some unrelated failure")).toBe("");
  });
});

describe("instrument wiring", () => {
  it("resolves the real index keys read from the public master", async () => {
    const provider = providerWith(candles([]));
    expect(await provider.getResolvedSymbol(requireInstrument("NIFTY50"))).toBe(
      "NSE_INDEX|Nifty 50",
    );
    expect(await provider.getResolvedSymbol(requireInstrument("SENSEX"))).toBe(
      "BSE_INDEX|SENSEX",
    );
  });

  it("resolves an MCX contract dynamically rather than from a hardcoded key", async () => {
    const provider = providerWith(candles([]));
    const key = await provider.getResolvedSymbol(requireInstrument("GOLD_MCX"));
    expect(key).toBe("MCX_FO|483078");
  });

  it("gives every MCX instrument a contract root instead of a fixed symbol", () => {
    for (const symbol of ["GOLD_MCX", "SILVER_MCX", "CRUDEOIL_MCX"]) {
      const instrument = requireInstrument(symbol);
      expect(instrument.upstoxContract?.exchange).toBe("MCX");
      expect(instrument.upstoxContract?.root).toBeTruthy();
      expect(instrument.market).toBe("MCX");
      expect(instrument.currency).toBe("INR");
    }
  });

  it("says plainly when an instrument has no Upstox key", async () => {
    const provider = providerWith(candles([]));
    await expect(
      provider.getResolvedSymbol(requireInstrument("BTC")),
    ).rejects.toThrow(/no Upstox instrument_key/);
  });

  it("keeps every instrument reachable by at least one provider", () => {
    for (const instrument of INSTRUMENTS) {
      const reachable =
        Object.keys(instrument.providerSymbols).length > 0 ||
        Boolean(instrument.upstoxContract);
      expect(reachable, `${instrument.symbol} has no provider`).toBe(true);
    }
  });
});
