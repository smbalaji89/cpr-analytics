import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CPRRecord } from "@/lib/types";

/**
 * Database read-path behaviour.
 *
 * The repository is mocked and the offline mock provider supplies the live
 * series, so these run without a database OR a network. They cover the rule
 * that matters once a database IS connected: the database is a CACHE that
 * write-through fills gradually, so a partially populated table is the normal
 * state and must never silently truncate a result.
 */

type AnyFn = (...args: unknown[]) => unknown;

const findHistory = vi.fn<AnyFn>();
const findRange = vi.fn<AnyFn>();
const findForCompare = vi.fn<AnyFn>();
const upsertCPRRecords = vi.fn<AnyFn>(async () => 0);
const isDatabaseConfigured = vi.fn<() => boolean>(() => true);

vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => isDatabaseConfigured(),
  getDb: () => {
    throw new Error("getDb must not be called in these tests");
  },
}));

vi.mock("@/lib/db/repository", () => ({
  findHistory: (...args: unknown[]) => findHistory(...args),
  findRange: (...args: unknown[]) => findRange(...args),
  findForCompare: (...args: unknown[]) => findForCompare(...args),
  upsertCPRRecords: (...args: unknown[]) => upsertCPRRecords(...args),
  resultToInsert: (result: unknown) => result,
}));

const { getHistory, getRangeSeries } = await import(
  "@/lib/services/cpr-service"
);
const { cacheClear } = await import("@/lib/services/cache");

/** A stored row, distinguishable from a live one by its sentinel width. */
function storedRow(tradingDate: string): CPRRecord {
  return {
    instrumentId: "NIFTY50",
    instrumentSymbol: "NIFTY50",
    instrumentName: "NIFTY 50",
    instrumentCategory: "INDIAN_INDICES",
    currency: "INR",
    tradingDate,
    sourceDate: "2000-01-01",
    high: 100,
    low: 90,
    close: 95,
    pivot: 95,
    bc: 95,
    tc: 95,
    cprWidth: -1, // sentinel: only a stored row carries this
    cprWidthPercent: 0,
    pointsClassification: "NARROW",
    percentageClassification: "NARROW",
    overallClassification: "NARROW",
    basis: "PRIMARY",
    classificationMethod: "POINTS",
    resolvedMethod: "POINTS",
    methodsAgree: true,
    inverted: false,
    pivotLevels: {
      r1: 0, r2: 0, r3: 0, r4: 0, r5: 0,
      s1: 0, s2: 0, s3: 0, s4: 0, s5: 0,
    },
    dataSource: "stored",
    providerSymbol: "stored",
    isMockData: false,
    projected: false,
  };
}

const isStored = (r: CPRRecord) => r.cprWidth === -1;

beforeEach(() => {
  // Offline, deterministic live series.
  process.env.MARKET_DATA_PROVIDER = "mock";
  delete process.env.DATABASE_URL;
  cacheClear();
  findHistory.mockReset();
  findRange.mockReset();
  upsertCPRRecords.mockReset();
  isDatabaseConfigured.mockReturnValue(true);
});

describe("getHistory — partial database", () => {
  it("serves stored rows alone when they fully satisfy the request", async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      storedRow(`2026-08-${String(10 + i).padStart(2, "0")}`),
    );
    findHistory.mockResolvedValue(rows);

    const result = await getHistory("NIFTY50", 10);

    expect(result.records).toHaveLength(10);
    expect(result.records.every(isStored)).toBe(true);
    expect(result.context.fromDatabase).toBe(true);
  });

  it("does NOT truncate to the stored count when the database is partial", async () => {
    // The regression: 3 stored rows for a 10-row request previously returned 3.
    findHistory.mockResolvedValue([
      storedRow("2026-08-12"),
      storedRow("2026-08-11"),
      storedRow("2026-08-10"),
    ]);

    const result = await getHistory("NIFTY50", 10);

    expect(result.records.length).toBeGreaterThan(3);
    expect(result.records).toHaveLength(10);
    expect(result.context.fromDatabase).toBe(false);
  });

  it("returns live data when the database is empty", async () => {
    findHistory.mockResolvedValue([]);
    const result = await getHistory("NIFTY50", 10);
    expect(result.records).toHaveLength(10);
    expect(result.records.some(isStored)).toBe(false);
  });

  it("falls back to live when the database read throws", async () => {
    findHistory.mockRejectedValue(new Error("connection refused"));
    const result = await getHistory("NIFTY50", 10);
    expect(result.records).toHaveLength(10);
    expect(result.context.fromDatabase).toBe(false);
  });

  it("skips the database entirely when it is not configured", async () => {
    isDatabaseConfigured.mockReturnValue(false);
    const result = await getHistory("NIFTY50", 10);
    expect(findHistory).not.toHaveBeenCalled();
    expect(result.records).toHaveLength(10);
  });

  it("never returns duplicate trading dates after a merge", async () => {
    // A stored row that also exists in the live series must not appear twice.
    findHistory.mockImplementation(async () => {
      const live = await getHistory("NIFTY50", 5);
      return [storedRow(live.records[0].tradingDate)];
    });
    isDatabaseConfigured.mockReturnValueOnce(false);
    const seed = await getHistory("NIFTY50", 5);
    isDatabaseConfigured.mockReturnValue(true);
    findHistory.mockResolvedValue([storedRow(seed.records[0].tradingDate)]);

    const result = await getHistory("NIFTY50", 10);
    const dates = result.records.map((r) => r.tradingDate);
    expect(new Set(dates).size).toBe(dates.length);
  });
});

describe("getRangeSeries — partial database", () => {
  it("does NOT return a near-empty chart from a partially synced range", async () => {
    // The regression: any non-empty stored result was returned as-is, so a
    // 3-row table produced a 3-point chart labelled with the full window.
    findRange.mockResolvedValue([
      storedRow("2026-08-12"),
      storedRow("2026-08-11"),
      storedRow("2026-08-10"),
    ]);

    const result = await getRangeSeries("NIFTY50", "2026-06-01", "2026-08-24");

    expect(result.records.length).toBeGreaterThan(20);
    expect(result.context.fromDatabase).toBe(false);
  });

  it("serves stored rows alone once coverage reaches the calendar's session count", async () => {
    const { getCalendar } = await import("@/lib/market-data/calendar");
    const expected = getCalendar("NSE").tradingDaysBetween(
      "2026-08-03",
      "2026-08-14",
    );
    findRange.mockResolvedValue(expected.map((d) => storedRow(d)));

    const result = await getRangeSeries("NIFTY50", "2026-08-03", "2026-08-14");

    expect(result.records).toHaveLength(expected.length);
    expect(result.records.every(isStored)).toBe(true);
    expect(result.context.fromDatabase).toBe(true);
  });

  it("keeps every returned record inside the requested window", async () => {
    findRange.mockResolvedValue([storedRow("2026-01-05")]); // outside the window
    const result = await getRangeSeries("NIFTY50", "2026-08-03", "2026-08-14");
    for (const record of result.records) {
      expect(record.tradingDate >= "2026-08-03").toBe(true);
      expect(record.tradingDate <= "2026-08-14").toBe(true);
    }
  });
});

describe("a newly added instrument backfills the full retention window", () => {
  it("computes the whole 90-day window on first view, not just the requested slice", async () => {
    // PRD §21 retention and the provider fetch window are the same 90 days, so
    // one pass over a brand-new instrument yields its entire history — which is
    // what write-through then persists.
    isDatabaseConfigured.mockReturnValue(false);
    const { getSeries } = await import("@/lib/services/cpr-service");
    const { retentionDays } = await import("@/lib/services/retention");

    const series = await getSeries("GOLD_MCX");
    const dates = series.records.map((r) => r.tradingDate).sort();

    // ~5 sessions a week over 90 calendar days, minus holidays.
    expect(series.records.length).toBeGreaterThan(50);

    const span =
      (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000;
    expect(span).toBeGreaterThan(retentionDays() - 12);
  });

  it("asks for only 10 rows but still has the full window cached behind it", async () => {
    isDatabaseConfigured.mockReturnValue(false);
    const ten = await getHistory("GOLD_MCX", 10);
    expect(ten.records).toHaveLength(10);

    const { getSeries } = await import("@/lib/services/cpr-service");
    const all = await getSeries("GOLD_MCX");
    expect(all.records.length).toBeGreaterThan(50);
  });
});

describe("provider failure degrades instead of crashing the render", () => {
  // Every page resolves a default date and stepper bounds FIRST, so an
  // unguarded throw there kills the whole Server Component render and reaches
  // the user as an opaque digest rather than PRD §27's message.
  const broken = () => {
    process.env.MARKET_DATA_PROVIDER = "definitely-not-a-provider";
    isDatabaseConfigured.mockReturnValue(false);
  };

  it("getDefaultTradingDate returns null rather than throwing", async () => {
    broken();
    const { getDefaultTradingDate } = await import(
      "@/lib/services/cpr-service"
    );
    await expect(getDefaultTradingDate("NIFTY50")).resolves.toBeNull();
  });

  it("getDateNavigation returns empty bounds rather than throwing", async () => {
    broken();
    const { getDateNavigation } = await import("@/lib/services/cpr-service");
    const nav = await getDateNavigation("NIFTY50", "2026-08-25");
    expect(nav.availableDates).toEqual([]);
    expect(nav.defaultDate).toBeNull();
  });

  it("getHistory returns no records rather than throwing", async () => {
    broken();
    const result = await getHistory("NIFTY50", 10);
    expect(result.records).toEqual([]);
  });

  it("getRangeSeries returns no records rather than throwing", async () => {
    broken();
    const result = await getRangeSeries("NIFTY50", "2026-08-01", "2026-08-25");
    expect(result.records).toEqual([]);
  });

  it("getCPRForDate reports the PRD §27 message rather than throwing", async () => {
    broken();
    const { getCPRForDate } = await import("@/lib/services/cpr-service");
    const { lookup } = await getCPRForDate("NIFTY50", "2026-08-25");
    expect(lookup.available).toBe(false);
    if (!lookup.available) {
      expect(lookup.error.message).toContain("temporarily unavailable");
    }
  });
});

describe("write-through persistence", () => {
  it("never stores rows older than the retention cutoff", async () => {
    // The series is fetched with a 12-day lookback buffer so the oldest wanted
    // session has a preceding bar. Those buffer rows sit OUTSIDE the retention
    // window and must not be written — PRD §21 requires the table to hold only
    // the retention period, and the sync job already excludes them.
    const { getSeries } = await import("@/lib/services/cpr-service");
    const { retentionCutoff } = await import("@/lib/services/retention");
    const { todayFor } = await import("@/lib/services/cpr-service");
    const { requireInstrument } = await import("@/lib/instruments");

    isDatabaseConfigured.mockReturnValue(false);
    const series = await getSeries("NIFTY50");
    const cutoff = retentionCutoff(todayFor(requireInstrument("NIFTY50")));

    // The computed series legitimately reaches back past the cutoff...
    const older = series.records.filter((r) => r.tradingDate < cutoff);
    expect(older.length).toBeGreaterThan(0);

    // ...but only the in-window subset is eligible for persistence.
    const retained = series.records.filter((r) => r.tradingDate >= cutoff);
    expect(retained.length).toBeGreaterThan(0);
    expect(retained.every((r) => r.tradingDate >= cutoff)).toBe(true);
  });

  it("does not persist synthetic mock-provider output", async () => {
    isDatabaseConfigured.mockReturnValue(true);
    findHistory.mockResolvedValue([]);

    await getHistory("NIFTY50", 10);
    // Allow any un-awaited background write to settle.
    await new Promise((r) => setTimeout(r, 20));

    expect(upsertCPRRecords).not.toHaveBeenCalled();
  });
});
