import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { cprData } from "@/lib/db/schema";
import { INSTRUMENTS } from "@/lib/instruments";
import { retentionDays } from "./retention";
import type { ISODate } from "@/lib/utils/date";

/**
 * Read-only database status for the Settings page.
 *
 * Reports whether storage is connected and how much history each instrument
 * actually holds. Deliberately exposes NO connection details — only counts and
 * dates, never the URL, host or credentials.
 */

export interface InstrumentCoverage {
  symbol: string;
  name: string;
  /** Rows stored inside the retention window. */
  rows: number;
  oldest: ISODate | null;
  newest: ISODate | null;
  /** Vendor series the rows came from; for futures, the contract month. */
  providerSymbol: string | null;
  lastUpdated: string | null;
}

export type DatabaseStatus =
  | { configured: false }
  | { configured: true; reachable: false; error: string }
  | {
      configured: true;
      reachable: true;
      totalRows: number;
      retentionDays: number;
      coverage: InstrumentCoverage[];
      /** Registered instruments with no stored rows at all. */
      missing: string[];
    };

export async function getDatabaseStatus(): Promise<DatabaseStatus> {
  if (!isDatabaseConfigured()) return { configured: false };

  try {
    const rows = await getDb()
      .select({
        symbol: cprData.instrumentSymbol,
        rows: sql<number>`count(*)::int`,
        oldest: sql<string>`min(${cprData.tradingDate})`,
        newest: sql<string>`max(${cprData.tradingDate})`,
        providerSymbol: sql<string | null>`max(${cprData.providerSymbol})`,
        lastUpdated: sql<string>`max(${cprData.updatedAt})`,
      })
      .from(cprData)
      .groupBy(cprData.instrumentSymbol);

    const bySymbol = new Map(rows.map((r) => [r.symbol, r]));

    const coverage: InstrumentCoverage[] = INSTRUMENTS.map((instrument) => {
      const row = bySymbol.get(instrument.symbol);
      return {
        symbol: instrument.symbol,
        name: instrument.name,
        rows: row?.rows ?? 0,
        oldest: (row?.oldest as ISODate | undefined) ?? null,
        newest: (row?.newest as ISODate | undefined) ?? null,
        providerSymbol: row?.providerSymbol ?? null,
        lastUpdated: row?.lastUpdated ? String(row.lastUpdated) : null,
      };
    });

    return {
      configured: true,
      reachable: true,
      totalRows: coverage.reduce((sum, c) => sum + c.rows, 0),
      retentionDays: retentionDays(),
      coverage,
      missing: coverage.filter((c) => c.rows === 0).map((c) => c.symbol),
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      // Driver messages can echo the host but never the password; still, keep
      // it short rather than dumping a stack into the browser.
      error: error instanceof Error ? error.message.slice(0, 200) : "Unknown error",
    };
  }
}
