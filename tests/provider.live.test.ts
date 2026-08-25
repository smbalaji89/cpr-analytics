import { describe, expect, it } from "vitest";
import { buildCPRResult } from "@/lib/cpr/calculator";
import { INSTRUMENTS, requireInstrument } from "@/lib/instruments";
import { getCalendar } from "@/lib/market-data/calendar";
import { latestCompleteBar } from "@/lib/market-data/provider";
import { YahooFinanceProvider } from "@/lib/market-data/providers/yahoo";
import { addDays, todayInTimeZone } from "@/lib/utils/date";

/**
 * LIVE integration test — hits the real Yahoo Finance endpoint.
 *
 * Skipped by default so the unit suite stays hermetic and offline-safe.
 * Run explicitly with:
 *
 *   RUN_LIVE_TESTS=1 npm test
 *
 * Worth running after any provider change, and whenever a CPR figure looks
 * wrong — it proves the vendor contract still holds rather than assuming it.
 */
const live = process.env.RUN_LIVE_TESTS === "1" ? describe : describe.skip;

live("YahooFinanceProvider (live)", () => {
  const provider = new YahooFinanceProvider({ revalidateSeconds: 0 });

  it.each(INSTRUMENTS.map((i) => i.symbol))(
    "returns usable daily bars for %s",
    async (symbol) => {
      const instrument = requireInstrument(symbol);
      const calendar = getCalendar(instrument.market);
      const end = todayInTimeZone(calendar.timeZone);
      const bars = await provider.getHistoricalOHLC({
        instrument,
        start: addDays(end, -20),
        end,
      });

      expect(bars.length).toBeGreaterThan(0);

      for (const bar of bars) {
        expect(bar.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }

      // OHLC coherence is asserted on COMPLETED sessions only.
      //
      // An in-progress bar is genuinely allowed to be incoherent: the vendor
      // stitches a live last price into `close` while the day's aggregated
      // `high`/`low` lag behind it. Observed on BTC-USD mid-session —
      // close 79,769.17 against a high of 79,643.41, the high trailing by ~126.
      //
      // That is precisely why `complete` exists and why the engine only ever
      // consumes finished sessions (PRD §23). The next assertion pins that down.
      for (const bar of bars.filter((b) => b.complete)) {
        // NOTE: `high > low` is deliberately NOT asserted, even here.
        //
        // Thinly-traded contracts genuinely produce single-tick sessions where
        // open = high = low = close. Measured over 63 sessions of real data:
        // CL=F 0 such bars, GC=F 1, SI=F 9. That is vendor reality, not a parse
        // bug, so the provider passes them through unchanged and the CPR engine
        // rejects them downstream (see the degenerate-bar test below).
        expect(bar.high).toBeGreaterThanOrEqual(bar.low);
        expect(bar.close).toBeGreaterThanOrEqual(bar.low);
        expect(bar.close).toBeLessThanOrEqual(bar.high);
      }
    },
    30_000,
  );

  it.each(INSTRUMENTS.map((i) => i.symbol))(
    "never feeds an incoherent in-progress bar to the engine for %s",
    async (symbol) => {
      const instrument = requireInstrument(symbol);
      const calendar = getCalendar(instrument.market);
      const end = todayInTimeZone(calendar.timeZone);
      const bars = await provider.getHistoricalOHLC({
        instrument,
        start: addDays(end, -20),
        end,
      });

      // Any bar that violates OHLC coherence must be one the provider has
      // already excluded from CPR by marking it incomplete.
      const incoherent = bars.filter(
        (b) => b.close > b.high || b.close < b.low,
      );
      for (const bar of incoherent) {
        expect(bar.complete).toBe(false);
      }

      // And every completed bar must survive the engine's own validation.
      for (const bar of bars.filter((b) => b.complete && b.high > b.low)) {
        expect(() =>
          buildCPRResult(
            bar,
            addDays(bar.date, 1),
            instrument.classificationMethod,
          ),
        ).not.toThrow();
      }

      // Bars must be strictly ascending and unique.
      const dates = bars.map((b) => b.date);
      expect([...new Set(dates)]).toHaveLength(dates.length);
      expect([...dates].sort()).toEqual(dates);
    },
    30_000,
  );

  it("never marks a future-dated bar complete", async () => {
    for (const instrument of INSTRUMENTS) {
      const calendar = getCalendar(instrument.market);
      const today = todayInTimeZone(calendar.timeZone);
      const bars = await provider.getHistoricalOHLC({
        instrument,
        start: addDays(today, -10),
        end: today,
      });
      for (const bar of bars) {
        if (bar.date > today) expect(bar.complete).toBe(false);
      }
    }
  }, 60_000);

  it("refuses to build a CPR from a real single-tick session", async () => {
    // Silver is the instrument that actually exhibits this in live data.
    const instrument = requireInstrument("SILVER");
    const calendar = getCalendar(instrument.market);
    const today = todayInTimeZone(calendar.timeZone);
    const bars = await provider.getHistoricalOHLC({
      instrument,
      start: addDays(today, -90),
      end: today,
    });

    const degenerate = bars.filter((b) => b.high <= b.low);
    // Guard rail rather than an assertion on vendor behaviour: if the feed
    // improves and these vanish, the test still passes.
    for (const bar of degenerate) {
      expect(() => buildCPRResult(bar, addDays(bar.date, 1), instrument.classificationMethod)).toThrow();
    }

    // Whatever the feed does, no bar may yield a silently-zero CPR.
    for (const bar of bars) {
      if (bar.high > bar.low) {
        const result = buildCPRResult(bar, addDays(bar.date, 1), instrument.classificationMethod);
        expect(result.pivot).toBeGreaterThan(0);
      }
    }
  }, 30_000);

  it("builds a valid forward CPR from the latest COMPLETE session", async () => {
    const instrument = requireInstrument("NIFTY50");
    const calendar = getCalendar(instrument.market);
    const today = todayInTimeZone(calendar.timeZone);
    const bars = await provider.getHistoricalOHLC({
      instrument,
      start: addDays(today, -30),
      end: today,
    });

    const source = latestCompleteBar(bars);
    expect(source).not.toBeNull();

    const target = calendar.nextTradingDay(source!.date);
    const result = buildCPRResult(source!, target, instrument.classificationMethod);

    expect(result.tc).toBeGreaterThanOrEqual(result.bc);
    expect(result.cprWidth).toBeGreaterThanOrEqual(0);
    expect(result.sourceDate).toBe(source!.date);
    expect(result.tradingDate > result.sourceDate).toBe(true);
  }, 30_000);
});
