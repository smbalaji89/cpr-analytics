import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import type { CategoryFilter } from "@/lib/cpr/filter";
import type { CPRResult } from "@/lib/cpr/types";
import { getInstrument, type Instrument } from "@/lib/instruments";
import type { CPRRecord } from "@/lib/types";
import type { ISODate } from "@/lib/utils/date";
import { getDb } from "./client";
import { cprData, type CPRDataRow } from "./schema";

/**
 * Data access for `cpr_data`.
 *
 * The ONLY place `numeric` columns cross between Postgres strings and JS
 * numbers. Keeping that conversion in one function means no caller ever has to
 * remember that `row.high` is a string, which is exactly the kind of silent
 * type confusion that produces wrong figures.
 */

function num(value: string | null): number {
  return value === null ? Number.NaN : Number(value);
}

/** Postgres `date` columns come back as `YYYY-MM-DD` strings. */
function toISO(value: string | Date): ISODate {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

export function rowToRecord(row: CPRDataRow, today: ISODate): CPRRecord {
  const instrument = getInstrument(row.instrumentSymbol);
  return {
    instrumentId: row.instrumentId,
    instrumentSymbol: row.instrumentSymbol,
    instrumentName: instrument?.name ?? row.instrumentSymbol,
    instrumentCategory:
      (instrument?.category ??
        row.instrumentCategory) as CPRRecord["instrumentCategory"],
    currency: instrument?.currency ?? "",

    tradingDate: toISO(row.tradingDate),
    sourceDate: toISO(row.sourceDate),

    high: num(row.high),
    low: num(row.low),
    close: num(row.close),

    pivot: num(row.pivot),
    bc: num(row.bc),
    tc: num(row.tc),

    cprWidth: num(row.cprWidth),
    cprWidthPercent: num(row.cprWidthPercent),

    pointsClassification:
      row.pointsClassification as CPRRecord["pointsClassification"],
    percentageClassification:
      row.percentageClassification as CPRRecord["percentageClassification"],
    overallClassification:
      row.overallClassification as CPRRecord["overallClassification"],
    basis: row.classificationBasis as CPRRecord["basis"],
    classificationMethod:
      row.classificationMethod as CPRRecord["classificationMethod"],
    resolvedMethod: row.resolvedMethod as CPRRecord["resolvedMethod"],
    methodsAgree: row.methodsAgree,

    inverted: row.inverted,

    pivotLevels: {
      r1: num(row.r1),
      r2: num(row.r2),
      r3: num(row.r3),
      r4: num(row.r4),
      r5: num(row.r5),
      s1: num(row.s1),
      s2: num(row.s2),
      s3: num(row.s3),
      s4: num(row.s4),
      s5: num(row.s5),
    },

    dataSource: row.dataSource,
    providerSymbol: row.providerSymbol ?? row.dataSource,
    // Rows are only ever written from a non-mock provider (the sync route and
    // the write-through path both refuse to persist mock output), so a
    // persisted row is real by construction.
    isMockData: false,
    // `projected` is re-evaluated against today rather than trusted as stored:
    // a row written as a forecast for tomorrow is simply history once that day
    // has passed, and must not keep claiming to be a projection.
    projected: row.projected && toISO(row.tradingDate) >= today,
  };
}

/** Map an engine result onto an insertable row. */
export function resultToInsert(
  result: CPRResult & { projected?: boolean },
  instrument: Instrument,
  dataSource: string,
  providerSymbol?: string,
) {
  const s = (v: number) => v.toString();
  return {
    instrumentId: instrument.symbol,
    instrumentSymbol: instrument.symbol,
    instrumentCategory: instrument.category,
    tradingDate: result.tradingDate,
    sourceDate: result.sourceDate,
    high: s(result.high),
    low: s(result.low),
    close: s(result.close),
    pivot: s(result.pivot),
    bc: s(result.bc),
    tc: s(result.tc),
    cprWidth: s(result.cprWidth),
    cprWidthPercent: s(result.cprWidthPercent),
    pointsClassification: result.pointsClassification,
    percentageClassification: result.percentageClassification,
    overallClassification: result.overallClassification,
    classificationBasis: result.basis,
    classificationMethod: result.classificationMethod,
    resolvedMethod: result.resolvedMethod,
    methodsAgree: result.methodsAgree,
    inverted: result.inverted,
    r1: s(result.pivotLevels.r1),
    r2: s(result.pivotLevels.r2),
    r3: s(result.pivotLevels.r3),
    r4: s(result.pivotLevels.r4),
    r5: s(result.pivotLevels.r5),
    s1: s(result.pivotLevels.s1),
    s2: s(result.pivotLevels.s2),
    s3: s(result.pivotLevels.s3),
    s4: s(result.pivotLevels.s4),
    s5: s(result.pivotLevels.s5),
    dataSource,
    providerSymbol: providerSymbol ?? dataSource,
    projected: result.projected ?? false,
  };
}

/**
 * Idempotent bulk write (PRD §33).
 *
 * Conflicts on (instrument_symbol, trading_date) update in place, so running the
 * sync twice — or a cron retry overlapping a manual run — can never duplicate a
 * session.
 */
export async function upsertCPRRecords(
  rows: ReturnType<typeof resultToInsert>[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getDb();

  await db
    .insert(cprData)
    .values(rows)
    .onConflictDoUpdate({
      target: [cprData.instrumentSymbol, cprData.tradingDate],
      set: {
        sourceDate: sql`excluded.source_date`,
        high: sql`excluded.high`,
        low: sql`excluded.low`,
        close: sql`excluded.close`,
        pivot: sql`excluded.pivot`,
        bc: sql`excluded.bc`,
        tc: sql`excluded.tc`,
        cprWidth: sql`excluded.cpr_width`,
        cprWidthPercent: sql`excluded.cpr_width_percent`,
        pointsClassification: sql`excluded.points_classification`,
        percentageClassification: sql`excluded.percentage_classification`,
        overallClassification: sql`excluded.overall_classification`,
        classificationBasis: sql`excluded.classification_basis`,
        classificationMethod: sql`excluded.classification_method`,
        resolvedMethod: sql`excluded.resolved_method`,
        methodsAgree: sql`excluded.methods_agree`,
        inverted: sql`excluded.inverted`,
        r1: sql`excluded.r1`,
        r2: sql`excluded.r2`,
        r3: sql`excluded.r3`,
        r4: sql`excluded.r4`,
        r5: sql`excluded.r5`,
        s1: sql`excluded.s1`,
        s2: sql`excluded.s2`,
        s3: sql`excluded.s3`,
        s4: sql`excluded.s4`,
        s5: sql`excluded.s5`,
        dataSource: sql`excluded.data_source`,
        providerSymbol: sql`excluded.provider_symbol`,
        projected: sql`excluded.projected`,
        updatedAt: sql`now()`,
      },
    });

  return rows.length;
}

export async function findByInstrumentAndDate(
  symbol: string,
  tradingDate: ISODate,
  today: ISODate,
): Promise<CPRRecord | null> {
  const rows = await getDb()
    .select()
    .from(cprData)
    .where(
      and(
        eq(cprData.instrumentSymbol, symbol),
        eq(cprData.tradingDate, tradingDate),
      ),
    )
    .limit(1);
  return rows.length ? rowToRecord(rows[0], today) : null;
}

/**
 * Category predicate, or `undefined` when no filter is active.
 *
 * Applied in SQL rather than after the fetch, so a `limit` still returns that
 * many MATCHING rows instead of that many rows of which some are then dropped.
 */
function categoryCondition(filter?: CategoryFilter) {
  return filter && filter.length > 0
    ? inArray(cprData.overallClassification, filter)
    : undefined;
}

/** Most recent `limit` sessions at or before `onOrBefore`, newest first. */
export async function findHistory(
  symbol: string,
  limit: number,
  today: ISODate,
  onOrBefore?: ISODate,
  categories?: CategoryFilter,
): Promise<CPRRecord[]> {
  const conditions = [eq(cprData.instrumentSymbol, symbol)];
  if (onOrBefore) conditions.push(lte(cprData.tradingDate, onOrBefore));
  const category = categoryCondition(categories);
  if (category) conditions.push(category);

  const rows = await getDb()
    .select()
    .from(cprData)
    .where(and(...conditions))
    .orderBy(desc(cprData.tradingDate))
    .limit(limit);
  return rows.map((row) => rowToRecord(row, today));
}

/** Inclusive date range, newest first. */
export async function findRange(
  symbol: string,
  start: ISODate,
  end: ISODate,
  today: ISODate,
  categories?: CategoryFilter,
): Promise<CPRRecord[]> {
  const conditions = [
    eq(cprData.instrumentSymbol, symbol),
    gte(cprData.tradingDate, start),
    lte(cprData.tradingDate, end),
  ];
  const category = categoryCondition(categories);
  if (category) conditions.push(category);

  const rows = await getDb()
    .select()
    .from(cprData)
    .where(and(...conditions))
    .orderBy(desc(cprData.tradingDate));
  return rows.map((row) => rowToRecord(row, today));
}

/** One row per instrument for a single date (PRD §16). */
export async function findForCompare(
  tradingDate: ISODate,
  symbols: string[],
  today: ISODate,
): Promise<CPRRecord[]> {
  if (symbols.length === 0) return [];
  const rows = await getDb()
    .select()
    .from(cprData)
    .where(
      and(
        eq(cprData.tradingDate, tradingDate),
        inArray(cprData.instrumentSymbol, symbols),
      ),
    );
  return rows.map((row) => rowToRecord(row, today));
}

/**
 * Remove rows in a window that the latest sync no longer produces.
 *
 * Forward-looking rows are written for a date the CALENDAR predicted. If that
 * prediction was wrong — an unlisted festival holiday, say — no session ever
 * occurs on it, and the row would otherwise linger forever and be read as
 * historical fact. Reconciling against the dates actually derived from observed
 * sessions deletes those phantoms.
 *
 * Scoped to one instrument and one date window so it can never touch anything
 * the caller did not just recompute.
 */
export async function deleteUnreconciled(
  symbol: string,
  start: ISODate,
  end: ISODate,
  keepDates: ISODate[],
): Promise<number> {
  const conditions = [
    eq(cprData.instrumentSymbol, symbol),
    gte(cprData.tradingDate, start),
    lte(cprData.tradingDate, end),
  ];
  if (keepDates.length > 0) {
    conditions.push(notInArray(cprData.tradingDate, keepDates));
  }

  const deleted = await getDb()
    .delete(cprData)
    .where(and(...conditions))
    .returning({ id: cprData.id });
  return deleted.length;
}

/** Retention cleanup (PRD §21). Returns the number of rows removed. */
export async function deleteOlderThan(cutoff: ISODate): Promise<number> {
  const deleted = await getDb()
    .delete(cprData)
    .where(lt(cprData.tradingDate, cutoff))
    .returning({ id: cprData.id });
  return deleted.length;
}

export async function countRows(): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(cprData);
  return row?.count ?? 0;
}
