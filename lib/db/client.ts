import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { readEnv } from "@/lib/utils/env";
import * as schema from "./schema";

/**
 * Database client — deliberately OPTIONAL.
 *
 * `DATABASE_URL` may be absent (a fresh clone, a preview deploy, CI running
 * `next build`). Rather than crashing at import time, the app degrades to
 * computing CPR live from the market-data provider on each request. That keeps
 * `npm run build` and local development working with zero setup, while the
 * cache/persistence/history-beyond-the-provider-window benefits simply switch on
 * once a connection string exists.
 *
 * Callers MUST branch on `isDatabaseConfigured()` rather than assuming a
 * connection; `getDb()` throws if used blindly.
 */

/**
 * Driver-agnostic handle.
 *
 * Typed against Drizzle's base `PgDatabase` rather than the postgres-js
 * specialisation, so the same repository code runs against the production driver
 * and against the embedded Postgres used by the integration tests.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

let client: ReturnType<typeof postgres> | null = null;
let db: Database | null = null;
/** Set only by integration tests; see `__setTestDatabase`. */
let testDb: Database | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(testDb) || readEnv("DATABASE_URL") !== undefined;
}

/**
 * Point the repository at an already-constructed Drizzle instance.
 *
 * Exists so `tests/db-integration.test.ts` can exercise the real SQL against an
 * embedded Postgres. Passing `null` restores normal behaviour. Never called by
 * application code.
 */
export function __setTestDatabase(instance: Database | null): void {
  testDb = instance;
}

/**
 * Lazily create the pool.
 *
 * Serverless functions are short-lived and can be invoked concurrently, so the
 * pool is deliberately small; Supabase's transaction pooler multiplexes on top.
 * `prepare: false` is required by that pooler — prepared statements are not
 * supported in transaction pooling mode.
 */
export function getDb(): Database {
  if (testDb) return testDb;
  if (db) return db;

  const url = readEnv("DATABASE_URL");
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Guard database access with isDatabaseConfigured().",
    );
  }

  client = postgres(url, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  db = drizzle(client, { schema });
  return db;
}

export { schema };
