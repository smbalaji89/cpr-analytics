import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration.
 *
 * Migrations live in ./drizzle. Generate with `npm run db:generate`, apply with
 * `npm run db:migrate`.
 *
 * ── Which connection string ────────────────────────────────────────────────
 * Prefers `DIRECT_DATABASE_URL` and falls back to `DATABASE_URL`. On Supabase,
 * DDL over the transaction pooler (port 6543) is unreliable, so migrations
 * should use the direct connection while the app keeps using the pooler. Setting
 * both lets `npm run db:migrate` and `npm run dev` each pick the right one with
 * no swapping.
 */

/** drizzle-kit does not read .env.local, so load it here. */
function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
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
      if (!process.env[key] && value) process.env[key] = value;
    }
  }
}

loadEnvFiles();

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DIRECT_DATABASE_URL?.trim() ||
      process.env.DATABASE_URL?.trim() ||
      "",
  },
  verbose: true,
  strict: true,
});
