import { authorizeCronRequest } from "@/lib/api/auth";
import { apiError, apiSuccess, apiUnexpected, CACHE } from "@/lib/api/response";
import { isDatabaseConfigured } from "@/lib/db/client";
import { countRows } from "@/lib/db/repository";
import { runCleanup } from "@/lib/services/sync";
import { retentionCutoff, retentionDays } from "@/lib/services/retention";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/cleanup — 90-day retention (PRD §21).
 *
 * Equivalent to:
 *   DELETE FROM cpr_data WHERE trading_date < CURRENT_DATE - INTERVAL '90 days';
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) {
    return apiError("UNAUTHORIZED", auth.message);
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = retentionCutoff(today);

    if (!isDatabaseConfigured()) {
      return apiSuccess(
        {
          skipped: true,
          reason: "DATABASE_URL is not configured; nothing to clean up.",
          cutoff,
          retentionDays: retentionDays(),
        },
        { cache: CACHE.none },
      );
    }

    const deleted = await runCleanup();
    return apiSuccess(
      {
        skipped: false,
        cutoff,
        retentionDays: retentionDays(),
        deleted,
        remaining: await countRows(),
      },
      { cache: CACHE.none },
    );
  } catch (error) {
    return apiUnexpected("GET /api/cron/cleanup", error);
  }
}
