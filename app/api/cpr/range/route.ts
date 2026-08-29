import { apiError, apiSuccess, apiUnexpected, cacheFor, CACHE } from "@/lib/api/response";
import { isPrivileged } from "@/lib/auth/access";
import { redactContext, redactRecords } from "@/lib/cpr/redact";
import { formatZodError, rangeQuerySchema } from "@/lib/api/validation";
import { getRangeSeries, todayFor } from "@/lib/services/cpr-service";
import { requireInstrument } from "@/lib/instruments";
import { isWithinRetention, retentionCutoff, retentionDays } from "@/lib/services/retention";

export const dynamic = "force-dynamic";

/**
 * GET /api/cpr/range?instrument=NIFTY50&start=2026-06-01&end=2026-08-24
 *
 * Backs the comparison charts (PRD §15). Rejects a start date outside the
 * retention window rather than quietly returning a shorter series — a chart
 * labelled "Last 90 Days" that silently covers 40 would misrepresent the data.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = rangeQuerySchema.safeParse({
      instrument: url.searchParams.get("instrument") ?? undefined,
      start: url.searchParams.get("start") ?? undefined,
      end: url.searchParams.get("end") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
    });

    if (!parsed.success) {
      return apiError("BAD_REQUEST", formatZodError(parsed.error));
    }

    const { instrument, start, end, category } = parsed.data;
    const today = todayFor(requireInstrument(instrument));

    if (!isWithinRetention(start, today)) {
      return apiError(
        "OUT_OF_RANGE",
        `Only the most recent ${retentionDays()} days are available. The earliest selectable date is ${retentionCutoff(today)}.`,
      );
    }

    const { records, context, totalBeforeFilter } = await getRangeSeries(
      instrument,
      start,
      end,
      category,
    );

    const privileged = await isPrivileged();
    return apiSuccess(
      {
        instrument,
        start,
        end,
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
        cache: cacheFor(privileged, end >= today ? CACHE.forward : CACHE.historical),
      },
    );
  } catch (error) {
    return apiUnexpected("GET /api/cpr/range", error);
  }
}
