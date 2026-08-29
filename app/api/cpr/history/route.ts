import { apiError, apiSuccess, apiUnexpected, cacheFor, CACHE } from "@/lib/api/response";
import { isPrivileged } from "@/lib/auth/access";
import { redactContext, redactRecords } from "@/lib/cpr/redact";
import { formatZodError, historyQuerySchema } from "@/lib/api/validation";
import { getHistory } from "@/lib/services/cpr-service";
import { retentionCutoff, retentionDays } from "@/lib/services/retention";

export const dynamic = "force-dynamic";

/**
 * GET /api/cpr/history?instrument=NIFTY50&days=10
 *
 * The most recent `days` trading sessions, newest first (PRD §12).
 * Optional `before=YYYY-MM-DD` anchors the window for historical browsing.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = historyQuerySchema.safeParse({
      instrument: url.searchParams.get("instrument") ?? undefined,
      days: url.searchParams.get("days") ?? undefined,
      before: url.searchParams.get("before") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
    });

    if (!parsed.success) {
      return apiError("BAD_REQUEST", formatZodError(parsed.error));
    }

    const { instrument, days, before, category } = parsed.data;
    const { records, context, today, totalBeforeFilter } = await getHistory(
      instrument,
      days,
      before,
      category,
    );

    const privileged = await isPrivileged();
    return apiSuccess(
      {
        instrument,
        days,
        today,
        category,
        count: records.length,
        totalBeforeFilter,
        records: redactRecords(records, privileged),
      },
      {
        meta: {
          context: redactContext(context, privileged),
          retentionDays: retentionDays(),
          earliestSelectableDate: retentionCutoff(today),
        },
        // The newest row may be the projected next session, so use the shorter TTL.
        cache: cacheFor(privileged, CACHE.forward),
      },
    );
  } catch (error) {
    return apiUnexpected("GET /api/cpr/history", error);
  }
}
