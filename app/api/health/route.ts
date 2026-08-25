import { apiSuccess, CACHE } from "@/lib/api/response";
import { isDatabaseConfigured } from "@/lib/db/client";
import { countRows } from "@/lib/db/repository";
import { DEFAULT_INSTRUMENT_SYMBOL, requireInstrument } from "@/lib/instruments";
import { getCalendar, getMarketDataProvider } from "@/lib/market-data";
import { addDays } from "@/lib/utils/date";
import { readEnv } from "@/lib/utils/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — deployment diagnostics.
 *
 * Answers "which dependency is broken?" from a browser, without shell access to
 * the platform logs. Production Server Component errors are deliberately opaque
 * (only a digest reaches the client), so this endpoint exercises each dependency
 * separately and reports the actual failure.
 *
 * Reports only presence and shape of configuration — never a value, so the
 * response is safe to share.
 */
export async function GET() {
  const started = Date.now();

  const config = {
    DATABASE_URL: describeUrl(process.env.DATABASE_URL),
    CRON_SECRET: readEnv("CRON_SECRET")
      ? `set (${readEnv("CRON_SECRET")!.length} chars)`
      : describeBlank("CRON_SECRET", "NOT SET — cron and admin sync disabled"),
    MARKET_DATA_PROVIDER: describeBlank(
      "MARKET_DATA_PROVIDER",
      "unset → defaults to yahoo",
    ),
    DATA_RETENTION_DAYS: describeBlank(
      "DATA_RETENTION_DAYS",
      "unset → defaults to 90",
    ),
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_REGION: process.env.VERCEL_REGION ?? "(not on Vercel)",
  };

  /**
   * Which deployment is actually answering.
   *
   * Environment variables are captured per deployment, so adding one in the
   * dashboard does nothing until a NEW deployment is created — and a var scoped
   * to Preview is invisible to Production. Both mistakes look identical from
   * the outside ("I set it and it is still not there"), so the deployment
   * identity is reported alongside.
   */
  const deployment = {
    vercelEnv: process.env.VERCEL_ENV ?? "(not on Vercel)",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "(unknown)",
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? "(unknown)",
    url: process.env.VERCEL_URL ?? "(unknown)",
  };

  /**
   * Names of every env var that looks related, values omitted.
   *
   * Catches the case a plain "is it set?" check cannot: the value IS present
   * but under a misspelled key, so the app never reads it.
   */
  const relatedKeys = Object.keys(process.env)
    .filter((k) => /CRON|SECRET|DATABASE|MARKET|RETENTION|SUPABASE/i.test(k))
    .sort();

  // ── Market data ──────────────────────────────────────────────────────────
  const provider: Record<string, unknown> = {};
  const providerStart = Date.now();
  try {
    const impl = getMarketDataProvider({ revalidateSeconds: 0 });
    provider.id = impl.id;
    provider.isMock = impl.isMock;

    const instrument = requireInstrument(DEFAULT_INSTRUMENT_SYMBOL);
    const today = getCalendar(instrument.market).today();
    const bars = await impl.getHistoricalOHLC({
      instrument,
      start: addDays(today, -10),
      end: today,
    });
    provider.ok = true;
    provider.barsReturned = bars.length;
    provider.latestBar = bars.at(-1)?.date ?? null;
    provider.completeBars = bars.filter((b) => b.complete).length;
  } catch (error) {
    provider.ok = false;
    provider.error = error instanceof Error ? error.message : String(error);
    provider.errorName = error instanceof Error ? error.name : "Unknown";
  }
  provider.ms = Date.now() - providerStart;

  // ── Database ─────────────────────────────────────────────────────────────
  const database: Record<string, unknown> = {
    configured: isDatabaseConfigured(),
  };
  if (isDatabaseConfigured()) {
    const dbStart = Date.now();
    try {
      database.rows = await countRows();
      database.ok = true;
    } catch (error) {
      database.ok = false;
      database.error = error instanceof Error ? error.message : String(error);
    }
    database.ms = Date.now() - dbStart;
  }

  return apiSuccess(
    {
      healthy: provider.ok === true,
      deployment,
      config,
      relatedEnvKeysPresent: relatedKeys,
      provider,
      database,
      totalMs: Date.now() - started,
    },
    { cache: CACHE.none },
  );
}

/**
 * Distinguish "declared but blank" from "not declared".
 *
 * They behave identically now, but a blank value means someone added the key
 * and forgot the value — worth surfacing so it can be tidied up.
 */
function describeBlank(name: string, whenUnset: string): string {
  const raw = process.env[name];
  if (raw === undefined) return `(${whenUnset})`;
  const trimmed = raw.trim();
  if (!trimmed) return `(declared but BLANK → treated as unset; ${whenUnset})`;
  return trimmed;
}

/** Shape of a connection string, with every credential removed. */
function describeUrl(raw?: string): string {
  const url = raw?.trim();
  if (!url) return "NOT SET";
  try {
    const parsed = new URL(url);
    const port = parsed.port || "(default)";
    const mode = port === "6543" ? "transaction pooler" : port === "5432" ? "session/direct" : "unknown";
    return `set — host ${parsed.hostname}, port ${port} (${mode})`;
  } catch {
    return "SET BUT UNPARSEABLE — check for stray quotes, spaces or a line break";
  }
}
