import { describe, expect, it } from "vitest";
import { requireInstrument } from "@/lib/instruments";
import { YahooFinanceProvider } from "@/lib/market-data/providers/yahoo";

/**
 * A just-closed bar must be proven SETTLED, not merely past its session clock.
 *
 * Regression suite for real data observed on ^NSEI 14 minutes after the
 * 2026-08-25 close: O 24175.75 / H 24334.55 / L 24115.45 / C 24334.55 with
 * volume 0, while the two preceding sessions carried 236,300 and 259,300. The
 * close was the live last price stitched into a bar the vendor had not
 * finalised. ^BSESN at the same moment reported a close ABOVE its high.
 *
 * Treating those as complete produced a next-session CPR that would silently
 * change once the vendor settled — the exact failure PRD §23 exists to prevent.
 */

const IST = "Asia/Kolkata";
/** 2026-08-25 15:44 IST — 14 minutes after the 15:30 close. */
const NOW = new Date("2026-08-25T10:14:00Z");
const SESSION_END = Math.floor(
  new Date("2026-08-25T10:00:00Z").getTime() / 1000,
);
const day = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/** Build a chart payload with a settled prior bar and a configurable today bar. */
function payload(today: {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}) {
  return {
    chart: {
      result: [
        {
          meta: {
            symbol: "^NSEI",
            currency: "INR",
            exchangeTimezoneName: IST,
            currentTradingPeriod: { regular: { start: 0, end: SESSION_END } },
          },
          timestamp: [day("2026-08-24T03:45:00Z"), day("2026-08-25T03:45:00Z")],
          indicators: {
            quote: [
              {
                open: [24285.05, today.open],
                high: [24313.0, today.high],
                low: [24144.3, today.low],
                close: [24219.05, today.close],
                volume: [236300, today.volume],
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

function providerReturning(body: unknown) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  return new YahooFinanceProvider({
    fetchImpl,
    revalidateSeconds: 0,
    now: () => NOW,
  });
}

async function todayBar(body: unknown) {
  const bars = await providerReturning(body).getHistoricalOHLC({
    instrument: requireInstrument("NIFTY50"),
    start: "2026-08-24",
    end: "2026-08-25",
  });
  return bars.find((b) => b.date === "2026-08-25");
}

describe("a just-closed bar", () => {
  it("is INCOMPLETE when volume is zero and other bars report volume", async () => {
    // The exact bar observed in production.
    const bar = await todayBar(
      payload({
        open: 24175.75,
        high: 24334.55,
        low: 24115.45,
        close: 24334.55,
        volume: 0,
      }),
    );
    expect(bar).toBeDefined();
    expect(bar!.complete).toBe(false);
  });

  it("is INCOMPLETE when the close sits outside the high/low band", async () => {
    // ^BSESN's shape at the same moment: close above high.
    const bar = await todayBar(
      payload({
        open: 77295.49,
        high: 77587.56,
        low: 77125.91,
        close: 77645.21,
        volume: 8700,
      }),
    );
    expect(bar!.complete).toBe(false);
  });

  it("is COMPLETE once the vendor settles it", async () => {
    const bar = await todayBar(
      payload({
        open: 24175.75,
        high: 24334.55,
        low: 24115.45,
        close: 24280.1,
        volume: 241800,
      }),
    );
    expect(bar!.complete).toBe(true);
  });

  it("does not demand volume from a series that never reports any", async () => {
    // Requiring volume unconditionally would mark such a series incomplete
    // forever, so the rule is derived from the data rather than assumed.
    const body = payload({
      open: 24175.75,
      high: 24334.55,
      low: 24115.45,
      close: 24280.1,
      volume: null,
    });
    body.chart.result[0].indicators.quote[0].volume = [null, null] as never;
    const bar = await todayBar(body);
    expect(bar!.complete).toBe(true);
  });

  it("leaves the settled PRIOR session complete regardless", async () => {
    const bars = await providerReturning(
      payload({
        open: 24175.75,
        high: 24334.55,
        low: 24115.45,
        close: 24334.55,
        volume: 0,
      }),
    ).getHistoricalOHLC({
      instrument: requireInstrument("NIFTY50"),
      start: "2026-08-24",
      end: "2026-08-25",
    });
    const prior = bars.find((b) => b.date === "2026-08-24");
    expect(prior!.complete).toBe(true);
    expect(prior!.high).toBe(24313.0);
    expect(prior!.low).toBe(24144.3);
    expect(prior!.close).toBe(24219.05);
  });
});
