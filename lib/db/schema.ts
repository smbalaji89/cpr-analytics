import {
  date,
  index,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * Database schema (PRD §20).
 *
 * ── Why `numeric` and not `double precision` ───────────────────────────────
 * Every price column is exact decimal. Binary floats cannot represent 0.1
 * exactly, and a CPR width is frequently a difference of two large, nearly
 * equal numbers — precisely the case where float error is proportionally
 * largest. `numeric` costs a string conversion at the repository boundary and
 * removes an entire class of "the width is off by a cent" bugs.
 *
 * ── Precision budget ───────────────────────────────────────────────────────
 * Prices: numeric(20, 4) — comfortably holds BTC/SENSEX magnitudes with four
 * decimals of headroom over the two we display.
 * Width %: numeric(12, 6) — two spare decimals over the four the PRD displays.
 */

/** Column widths reused across price fields. */
const price = (name: string) => numeric(name, { precision: 20, scale: 4 });

export const cprData = pgTable(
  "cpr_data",
  {
    id: serial("id").primaryKey(),

    /** Canonical registry key, e.g. "NIFTY50". */
    instrumentId: text("instrument_id").notNull(),
    /** Ticker shown to users. Part of the uniqueness contract. */
    instrumentSymbol: text("instrument_symbol").notNull(),
    instrumentCategory: text("instrument_category").notNull(),

    /** Session these CPR levels APPLY to. */
    tradingDate: date("trading_date").notNull(),
    /** Completed session the levels were DERIVED from. Always < tradingDate. */
    sourceDate: date("source_date").notNull(),

    high: price("high").notNull(),
    low: price("low").notNull(),
    close: price("close").notNull(),

    pivot: price("pivot").notNull(),
    bc: price("bc").notNull(),
    tc: price("tc").notNull(),

    cprWidth: price("cpr_width").notNull(),
    cprWidthPercent: numeric("cpr_width_percent", {
      precision: 12,
      scale: 6,
    }).notNull(),

    pointsClassification: text("points_classification").notNull(),
    percentageClassification: text("percentage_classification").notNull(),
    overallClassification: text("overall_classification").notNull(),
    /**
     * How the verdict was reached: PRIMARY (the instrument's configured method)
     * / FALLBACK (configured method out of range) / NONE.
     */
    classificationBasis: text("classification_basis").notNull(),
    /** Method configured for the instrument: POINTS or PERCENTAGE. */
    classificationMethod: text("classification_method").notNull(),
    /** Method that actually produced the verdict; differs on a FALLBACK. */
    resolvedMethod: text("resolved_method"),
    /** Both methods independently landed on the same band. */
    methodsAgree: boolean("methods_agree").notNull().default(false),

    /** Raw BC exceeded raw TC and the two were swapped — an inverted CPR. */
    inverted: boolean("inverted").notNull().default(false),

    r1: price("r1").notNull(),
    r2: price("r2").notNull(),
    r3: price("r3").notNull(),
    r4: price("r4").notNull(),
    r5: price("r5").notNull(),
    s1: price("s1").notNull(),
    s2: price("s2").notNull(),
    s3: price("s3").notNull(),
    s4: price("s4").notNull(),
    s5: price("s5").notNull(),

    /** Provider id the source bar came from, for provenance. */
    dataSource: text("data_source").notNull(),
    /** Exact vendor series queried; for futures, the contract month. */
    providerSymbol: text("provider_symbol"),
    /**
     * The trading date was projected from the calendar rather than observed.
     * Re-evaluated on read — once the date has passed it is no longer a forecast.
     */
    projected: boolean("projected").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Makes the sync job idempotent — re-running it updates rather than duplicates.
    uniqueIndex("cpr_data_symbol_date_unq").on(
      table.instrumentSymbol,
      table.tradingDate,
    ),
    index("cpr_data_symbol_idx").on(table.instrumentSymbol),
    // Descending: every history query reads newest-first.
    index("cpr_data_trading_date_idx").on(table.tradingDate.desc()),
    index("cpr_data_category_idx").on(table.instrumentCategory),
    // Backs the "filter by CPR category" queries.
    index("cpr_data_overall_classification_idx").on(
      table.overallClassification,
    ),
    // Covers the hot path: one instrument's history over a date range.
    index("cpr_data_symbol_date_idx").on(
      table.instrumentSymbol,
      table.tradingDate.desc(),
    ),
  ],
);

export type CPRDataRow = typeof cprData.$inferSelect;
export type CPRDataInsert = typeof cprData.$inferInsert;
