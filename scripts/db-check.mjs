#!/usr/bin/env node
/**
 * Database connection checker — `npm run db:check`.
 *
 * Verifies a `DATABASE_URL` before you rely on it: connects, confirms the
 * migrations are applied, and reports what is actually stored. Plain ESM so it
 * runs with bare `node`, no build step.
 *
 * It never prints the password.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const ENV_FILES = [".env.local", ".env"];

/** Minimal dotenv parse — enough for KEY=VALUE with optional quotes. */
function loadEnvFiles() {
  for (const file of ENV_FILES) {
    const path = join(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env) && value) process.env[key] = value;
    }
  }
}

/** Host/port/database only — never the credentials. */
function describeTarget(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`;
  } catch {
    return "(unparseable URL)";
  }
}

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);
const info = (m) => console.log(`    ${m}`);

async function main() {
  loadEnvFiles();
  const url = process.env.DATABASE_URL?.trim();

  console.log("\nCPR Analytics — database check\n");

  if (!url) {
    bad("DATABASE_URL is not set.");
    info("");
    info("The app runs fine without it — every CPR is computed live and");
    info("nothing is stored. To enable persistence:");
    info("");
    info("  1. Create a project at https://supabase.com");
    info("  2. Settings -> Database -> Connection string -> Transaction pooler");
    info("  3. Put it in .env.local as DATABASE_URL=...");
    info("  4. npm run db:migrate    (use the DIRECT :5432 string for this)");
    info("  5. npm run db:check");
    process.exit(1);
  }

  console.log(`  Target: ${describeTarget(url)}\n`);

  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const sql = postgres(url, {
    prepare: false,
    connect_timeout: 15,
    max: 1,
    // Supabase (and most hosted Postgres) require TLS. Honour an explicit
    // sslmode in the URL; otherwise default to requiring it off-localhost.
    ssl: /sslmode=/.test(url) ? undefined : isLocal ? false : "require",
    onnotice: () => {},
  });

  let exitCode = 0;

  try {
    const [{ version }] = await sql`SELECT version()`;
    ok(`Connected — ${version.split(",")[0]}`);

    const [{ exists }] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'cpr_data'
      ) AS exists`;

    if (!exists) {
      bad("Table cpr_data does not exist — migrations have not been applied.");
      info("Run: npm run db:migrate   (use the DIRECT :5432 connection string)");
      await sql.end({ timeout: 5 });
      process.exit(1);
    }
    ok("Table cpr_data exists");

    const indexes = await sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'cpr_data'`;
    const names = indexes.map((r) => r.indexname);
    const required = [
      "cpr_data_symbol_date_unq",
      "cpr_data_symbol_idx",
      "cpr_data_trading_date_idx",
      "cpr_data_category_idx",
      "cpr_data_overall_classification_idx",
      "cpr_data_symbol_date_idx",
    ];
    const missing = required.filter((n) => !names.includes(n));
    if (missing.length) {
      bad(`Missing index(es): ${missing.join(", ")}`);
      info("Run: npm run db:migrate");
      exitCode = 1;
    } else {
      ok(`All ${required.length} indexes present`);
    }

    const [{ count }] = await sql`SELECT count(*)::int AS count FROM cpr_data`;
    if (count === 0) {
      ok("Table is empty — 0 rows");
      info("This is expected before the first sync.");
      info("Rows appear automatically as you browse (write-through), or run:");
      info('  curl -X POST "$URL/api/admin/sync" -H "Authorization: Bearer $CRON_SECRET"');
    } else {
      ok(`${count} row(s) stored`);
      const rows = await sql`
        SELECT instrument_symbol,
               count(*)::int      AS rows,
               min(trading_date)  AS oldest,
               max(trading_date)  AS newest,
               max(provider_symbol) AS series,
               max(updated_at)    AS updated
        FROM cpr_data
        GROUP BY instrument_symbol
        ORDER BY instrument_symbol`;
      console.log("");
      console.log(
        `    ${"INSTRUMENT".padEnd(12)}${"ROWS".padEnd(7)}${"OLDEST".padEnd(13)}${"NEWEST".padEnd(13)}SERIES`,
      );
      for (const r of rows) {
        const d = (v) =>
          v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
        console.log(
          `    ${r.instrument_symbol.padEnd(12)}${String(r.rows).padEnd(7)}${d(r.oldest).padEnd(13)}${d(r.newest).padEnd(13)}${r.series ?? "-"}`,
        );
      }
    }

    console.log("");
    ok("Database is ready.");
  } catch (error) {
    bad(`Connection failed: ${error.message}`);
    info("");
    const message = String(error.message || "");
    if (/password|authentication/i.test(message)) {
      info("The password looks wrong. Copy the string again from");
      info("Supabase -> Settings -> Database, and URL-encode any special");
      info("characters in the password (@ becomes %40, # becomes %23).");
    } else if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
      info("Host not found. Check the project ref in the URL.");
    } else if (/ENETUNREACH|ECONNREFUSED|timeout/i.test(message)) {
      info("Could not reach the host. If you used the DIRECT connection");
      info("string, it is IPv6-only on Supabase — use the TRANSACTION POOLER");
      info("string (port 6543) for the app instead.");
    } else if (/SSL|certificate/i.test(message)) {
      info("TLS negotiation failed. Append ?sslmode=require to the URL.");
    }
    exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }

  console.log("");
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
