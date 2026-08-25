import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildCPRResult } from "@/lib/cpr/calculator";
import { parseCategoryFilter } from "@/lib/cpr/filter";
import { __setTestDatabase, type Database } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import {
  countRows,
  deleteOlderThan,
  deleteUnreconciled,
  findByInstrumentAndDate,
  findForCompare,
  findHistory,
  findRange,
  resultToInsert,
  upsertCPRRecords,
} from "@/lib/db/repository";
import { requireInstrument } from "@/lib/instruments";
import type { OHLC } from "@/lib/cpr/types";

/**
 * REAL database integration tests.
 *
 * These run the committed migration SQL and every repository query against an
 * actual Postgres (PGlite — Postgres compiled to WASM, in-process). No Docker,
 * no server, no credentials, but genuine Postgres semantics: real DDL, real
 * `numeric` handling, a real unique constraint, real `ON CONFLICT` behaviour.
 *
 * The point is to prove the schema and queries work BEFORE a Supabase URL is
 * plugged in, rather than discovering a broken constraint in production.
 */

let pg: PGlite;
let db: Database;

const NIFTY = requireInstrument("NIFTY50");
const BTC = requireInstrument("BTC");

function bar(date: string, high: number, low: number, close: number): OHLC {
  return { date, open: (high + low) / 2, high, low, close };
}

/** Build an insertable row the same way the sync job does. */
function row(
  instrument: typeof NIFTY,
  source: OHLC,
  tradingDate: string,
  projected = false,
) {
  return resultToInsert(
    {
      ...buildCPRResult(source, tradingDate, instrument.classificationMethod),
      projected,
    },
    instrument,
    "yahoo",
    instrument.providerSymbols.yahoo,
  );
}

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as Database;

  // Apply the COMMITTED migrations, in order — not a schema push. If a
  // migration is malformed this fails here rather than against Supabase.
  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await pg.exec(trimmed);
    }
  }

  __setTestDatabase(db);
}, 60_000);

afterAll(async () => {
  __setTestDatabase(null);
  await pg?.close();
});

beforeEach(async () => {
  await pg.exec("TRUNCATE TABLE cpr_data RESTART IDENTITY;");
});

describe("migrations", () => {
  it("creates cpr_data with every documented column", async () => {
    const result = await pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'cpr_data'`,
    );
    const columns = result.rows.map((r) => r.column_name);

    for (const expected of [
      "id", "instrument_id", "instrument_symbol", "instrument_category",
      "trading_date", "source_date", "high", "low", "close",
      "pivot", "bc", "tc", "cpr_width", "cpr_width_percent",
      "points_classification", "percentage_classification",
      "overall_classification", "classification_basis", "classification_method",
      "resolved_method", "methods_agree", "inverted",
      "r1", "r2", "r3", "r4", "r5", "s1", "s2", "s3", "s4", "s5",
      "data_source", "provider_symbol", "projected",
      "created_at", "updated_at",
    ]) {
      expect(columns).toContain(expected);
    }
  });

  it("stores prices as exact numeric, not floating point", async () => {
    const result = await pg.query<{ data_type: string; numeric_scale: number }>(
      `SELECT data_type, numeric_scale FROM information_schema.columns
       WHERE table_name = 'cpr_data' AND column_name = 'cpr_width'`,
    );
    expect(result.rows[0].data_type).toBe("numeric");
    expect(result.rows[0].numeric_scale).toBe(4);
  });

  it("creates the unique constraint and every index", async () => {
    const result = await pg.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'cpr_data'`,
    );
    const names = result.rows.map((r) => r.indexname);
    for (const expected of [
      "cpr_data_symbol_date_unq",
      "cpr_data_symbol_idx",
      "cpr_data_trading_date_idx",
      "cpr_data_category_idx",
      "cpr_data_overall_classification_idx",
      "cpr_data_symbol_date_idx",
    ]) {
      expect(names).toContain(expected);
    }
  });
});

describe("upsert idempotency (PRD §33)", () => {
  const source = bar("2026-08-24", 24313.0, 24144.3, 24219.05);

  it("writes rows on first run", async () => {
    await upsertCPRRecords([row(NIFTY, source, "2026-08-25")]);
    expect(await countRows()).toBe(1);
  });

  it("updates rather than duplicating when run twice", async () => {
    await upsertCPRRecords([row(NIFTY, source, "2026-08-25")]);
    await upsertCPRRecords([row(NIFTY, source, "2026-08-25")]);
    expect(await countRows()).toBe(1);
  });

  it("overwrites values on conflict", async () => {
    await upsertCPRRecords([row(NIFTY, source, "2026-08-25")]);
    const revised = bar("2026-08-24", 24400.0, 24100.0, 24250.0);
    await upsertCPRRecords([row(NIFTY, revised, "2026-08-25")]);

    const stored = await findByInstrumentAndDate(
      "NIFTY50",
      "2026-08-25",
      "2026-08-25",
    );
    expect(stored?.high).toBe(24400);
    expect(await countRows()).toBe(1);
  });

  it("keys uniqueness on symbol AND date, so instruments do not collide", async () => {
    await upsertCPRRecords([
      row(NIFTY, source, "2026-08-25"),
      row(BTC, bar("2026-08-24", 79000, 77000, 78000), "2026-08-25"),
    ]);
    expect(await countRows()).toBe(2);
  });
});

describe("numeric round-trip", () => {
  it("returns the exact stored values, not float approximations", async () => {
    // The PRD reference session; every figure must survive the round trip.
    await upsertCPRRecords([
      row(NIFTY, bar("2026-08-24", 24313.0, 24144.30078125, 24219.05078125), "2026-08-25"),
    ]);

    const stored = await findByInstrumentAndDate(
      "NIFTY50",
      "2026-08-25",
      "2026-08-25",
    );
    expect(stored).not.toBeNull();
    expect(stored!.bc).toBe(24222.25);
    expect(stored!.pivot).toBe(24225.45);
    expect(stored!.tc).toBe(24228.65);
    expect(stored!.cprWidth).toBe(6.4);
    expect(stored!.cprWidthPercent).toBe(0.0264);
    expect(stored!.overallClassification).toBe("NARROW");
    expect(stored!.classificationMethod).toBe("POINTS");
    expect(stored!.inverted).toBe(true);
  });

  it("preserves the full R1–R5 / S1–S5 ladder", async () => {
    await upsertCPRRecords([
      row(NIFTY, bar("2026-08-24", 110, 90, 100), "2026-08-25"),
    ]);
    const stored = await findByInstrumentAndDate(
      "NIFTY50",
      "2026-08-25",
      "2026-08-25",
    );
    expect(stored!.pivotLevels.r1).toBe(110);
    expect(stored!.pivotLevels.s5).toBe(50);
  });
});

describe("queries", () => {
  /**
   * Fixtures chosen so the rows carry DIFFERENT classifications, otherwise a
   * category filter cannot be shown to discriminate.
   *
   * With a fixed high/low, CPR width = |2C − H − L| / 3, so the close alone
   * dials the width. NIFTY is points-classified, giving NARROW (≤40),
   * MIXED (41–70) and WIDER (71–200).
   */
  const HIGH = 24350;
  const LOW = 24050;
  const fixtures: { tradingDate: string; close: number; expect: string }[] = [
    { tradingDate: "2026-08-17", close: 24245, expect: "NARROW" }, // width 30
    { tradingDate: "2026-08-18", close: 24275, expect: "MIXED" },  // width 50
    { tradingDate: "2026-08-19", close: 24335, expect: "WIDER" },  // width 90
    { tradingDate: "2026-08-20", close: 24245, expect: "NARROW" },
    { tradingDate: "2026-08-21", close: 24275, expect: "MIXED" },
  ];

  beforeEach(async () => {
    await upsertCPRRecords(
      fixtures.map((f, i) =>
        row(
          NIFTY,
          bar(`2026-08-${10 + i}`, HIGH, LOW, f.close),
          f.tradingDate,
        ),
      ),
    );
  });

  it("stores the classifications the fixtures were designed to produce", async () => {
    const rows = await findRange(
      "NIFTY50", "2026-08-17", "2026-08-21", "2026-08-21",
    );
    const byDate = new Map(rows.map((r) => [r.tradingDate, r]));
    for (const f of fixtures) {
      expect(byDate.get(f.tradingDate)?.overallClassification).toBe(f.expect);
    }
  });

  it("findHistory returns newest first and honours the limit", async () => {
    const rows = await findHistory("NIFTY50", 3, "2026-08-21");
    expect(rows.map((r) => r.tradingDate)).toEqual([
      "2026-08-21", "2026-08-20", "2026-08-19",
    ]);
  });

  it("findHistory respects the onOrBefore anchor", async () => {
    const rows = await findHistory("NIFTY50", 10, "2026-08-21", "2026-08-19");
    expect(rows.every((r) => r.tradingDate <= "2026-08-19")).toBe(true);
  });

  it("findRange is inclusive at both ends", async () => {
    const rows = await findRange(
      "NIFTY50", "2026-08-18", "2026-08-20", "2026-08-21",
    );
    expect(rows.map((r) => r.tradingDate)).toEqual([
      "2026-08-20", "2026-08-19", "2026-08-18",
    ]);
  });

  it("filters by category in SQL", async () => {
    const range = (categories?: ReturnType<typeof parseCategoryFilter>) =>
      findRange("NIFTY50", "2026-08-17", "2026-08-21", "2026-08-21", categories);

    expect(await range()).toHaveLength(5);
    expect(await range(parseCategoryFilter("NARROW"))).toHaveLength(2);
    expect(await range(parseCategoryFilter("MIXED"))).toHaveLength(2);
    expect(await range(parseCategoryFilter("WIDER"))).toHaveLength(1);
    expect(await range(parseCategoryFilter("NARROW,WIDER"))).toHaveLength(3);

    // A category no row carries must return nothing, not everything.
    expect(await range(["UNCLASSIFIED"])).toHaveLength(0);

    // And every returned row must genuinely match.
    for (const record of await range(parseCategoryFilter("WIDER"))) {
      expect(record.overallClassification).toBe("WIDER");
    }
  });

  it("applies the category filter BEFORE the limit, not after", async () => {
    // Otherwise "10 most recent MIXED sessions" would silently return fewer.
    const rows = await findHistory(
      "NIFTY50", 2, "2026-08-21", undefined, parseCategoryFilter("MIXED"),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.overallClassification === "MIXED")).toBe(true);
  });

  it("findForCompare returns one row per instrument for a date", async () => {
    await upsertCPRRecords([
      row(BTC, bar("2026-08-20", 79000, 77000, 78000), "2026-08-21"),
    ]);
    const rows = await findForCompare(
      "2026-08-21", ["NIFTY50", "BTC"], "2026-08-21",
    );
    expect(rows.map((r) => r.instrumentSymbol).sort()).toEqual([
      "BTC", "NIFTY50",
    ]);
  });
});

describe("projected flag is re-evaluated on read", () => {
  it("stays true while the trading date is still ahead", async () => {
    await upsertCPRRecords([
      row(NIFTY, bar("2026-08-24", 24313, 24144.3, 24219.05), "2026-08-25", true),
    ]);
    const stored = await findByInstrumentAndDate(
      "NIFTY50", "2026-08-25", "2026-08-24",
    );
    expect(stored!.projected).toBe(true);
  });

  it("becomes false once that day has passed", async () => {
    // Written as tomorrow's forecast; read a week later it is simply history.
    await upsertCPRRecords([
      row(NIFTY, bar("2026-08-24", 24313, 24144.3, 24219.05), "2026-08-25", true),
    ]);
    const stored = await findByInstrumentAndDate(
      "NIFTY50", "2026-08-25", "2026-09-01",
    );
    expect(stored!.projected).toBe(false);
  });
});

describe("retention (PRD §21)", () => {
  it("deletes only rows strictly older than the cutoff", async () => {
    await upsertCPRRecords([
      row(NIFTY, bar("2026-05-01", 100, 90, 95), "2026-05-04"),
      row(NIFTY, bar("2026-08-20", 24300, 24100, 24200), "2026-08-21"),
    ]);
    expect(await countRows()).toBe(2);

    const deleted = await deleteOlderThan("2026-05-26");
    expect(deleted).toBe(1);
    expect(await countRows()).toBe(1);

    const remaining = await findHistory("NIFTY50", 10, "2026-08-21");
    expect(remaining[0].tradingDate).toBe("2026-08-21");
  });

  it("keeps a row exactly on the cutoff", async () => {
    await upsertCPRRecords([
      row(NIFTY, bar("2026-05-25", 100, 90, 95), "2026-05-26"),
    ]);
    expect(await deleteOlderThan("2026-05-26")).toBe(0);
    expect(await countRows()).toBe(1);
  });
});

describe("reconciliation removes phantom rows", () => {
  it("deletes a mis-projected date that never became a session", async () => {
    // A forward row was written for a date the calendar wrongly predicted.
    await upsertCPRRecords([
      row(NIFTY, bar("2026-08-19", 24300, 24100, 24200), "2026-08-20"),
      row(NIFTY, bar("2026-08-20", 24300, 24100, 24200), "2026-08-21", true),
      row(NIFTY, bar("2026-08-21", 24300, 24100, 24200), "2026-08-24", true),
    ]);
    expect(await countRows()).toBe(3);

    // The next sync observes only 08-20 and 08-24 — 08-21 was a holiday.
    const removed = await deleteUnreconciled(
      "NIFTY50", "2026-08-20", "2026-08-24", ["2026-08-20", "2026-08-24"],
    );
    expect(removed).toBe(1);

    const left = await findRange(
      "NIFTY50", "2026-08-20", "2026-08-24", "2026-08-24",
    );
    expect(left.map((r) => r.tradingDate)).toEqual([
      "2026-08-24", "2026-08-20",
    ]);
  });

  it("never touches another instrument or dates outside the window", async () => {
    await upsertCPRRecords([
      row(NIFTY, bar("2026-08-10", 24300, 24100, 24200), "2026-08-11"),
      row(BTC, bar("2026-08-20", 79000, 77000, 78000), "2026-08-21"),
    ]);
    const removed = await deleteUnreconciled(
      "NIFTY50", "2026-08-20", "2026-08-24", ["2026-08-24"],
    );
    expect(removed).toBe(0);
    expect(await countRows()).toBe(2);
  });
});
