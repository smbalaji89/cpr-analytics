import { authorizeCronRequest } from "@/lib/api/auth";
import { apiError, apiSuccess, apiUnexpected, CACHE } from "@/lib/api/response";
import { formatZodError, syncBodySchema } from "@/lib/api/validation";
import { runSync } from "@/lib/services/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/sync — manual synchronisation (PRD §25, §33).
 *
 * Same credential as the cron endpoints. Body is optional:
 *   { "instruments": ["NIFTY50"], "windowDays": 30 }
 *
 * Use it to backfill after a deploy or to re-run a failed instrument without
 * waiting for the nightly cron.
 */
export async function POST(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) {
    return apiError("UNAUTHORIZED", auth.message);
  }

  try {
    let body: unknown = {};
    const raw = await request.text();
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        return apiError("BAD_REQUEST", "Request body must be valid JSON.");
      }
    }

    const parsed = syncBodySchema.safeParse(body);
    if (!parsed.success) {
      return apiError("BAD_REQUEST", formatZodError(parsed.error));
    }

    const result = await runSync({
      symbols: parsed.data.instruments,
      windowDays: parsed.data.windowDays,
    });

    return apiSuccess(
      {
        ...result,
        allSucceeded: result.instruments.every((i) => i.ok),
      },
      { cache: CACHE.none },
    );
  } catch (error) {
    return apiUnexpected("POST /api/admin/sync", error);
  }
}
