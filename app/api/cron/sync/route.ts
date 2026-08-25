import { authorizeCronRequest } from "@/lib/api/auth";
import { apiError, apiSuccess, apiUnexpected, CACHE } from "@/lib/api/response";
import { runSync } from "@/lib/services/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/sync — scheduled data synchronisation (PRD §33).
 *
 * Invoked by Vercel Cron, which sends `Authorization: Bearer $CRON_SECRET`.
 * Returns 200 with per-instrument results even when some instruments failed, so
 * a single dead symbol does not make Vercel retry the whole run; the response
 * body carries the detail and `allSucceeded` makes it easy to alert on.
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) {
    return apiError("UNAUTHORIZED", auth.message);
  }

  try {
    const result = await runSync();
    const failed = result.instruments.filter((i) => !i.ok);
    if (failed.length > 0) {
      console.error(
        "[cron/sync] instruments failed:",
        failed.map((f) => `${f.symbol}: ${f.error}`).join(" | "),
      );
    }
    return apiSuccess(
      { ...result, allSucceeded: failed.length === 0 },
      { cache: CACHE.none },
    );
  } catch (error) {
    return apiUnexpected("GET /api/cron/sync", error);
  }
}
