import { apiError, apiSuccess, apiUnexpected, CACHE } from "@/lib/api/response";
import { cprQuerySchema, formatZodError } from "@/lib/api/validation";
import {
  getCPRForDate,
  getDefaultTradingDate,
  horizonFor,
} from "@/lib/services/cpr-service";
import { retentionCutoff, retentionDays } from "@/lib/services/retention";

export const dynamic = "force-dynamic";

/**
 * GET /api/cpr?instrument=NIFTY50&date=2026-08-25
 *
 * Omitting `date` returns the default trading date (PRD §3) — the next session
 * whose CPR can be derived from a completed one.
 *
 * A date with no CPR is NOT an error: it returns 200 with `available: false`
 * and a reason, because "the market was closed" is a legitimate answer the UI
 * needs to render (PRD §27, §29).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = cprQuerySchema.safeParse({
      instrument: url.searchParams.get("instrument") ?? undefined,
      date: url.searchParams.get("date") ?? undefined,
    });

    if (!parsed.success) {
      return apiError("BAD_REQUEST", formatZodError(parsed.error));
    }

    const { instrument, date } = parsed.data;

    const tradingDate = date ?? (await getDefaultTradingDate(instrument));
    if (!tradingDate) {
      return apiError(
        "PROVIDER_ERROR",
        "Market data temporarily unavailable. Please try again later.",
      );
    }

    const { lookup, context, today } = await getCPRForDate(
      instrument,
      tradingDate,
    );

    const isForward = tradingDate >= today;
    return apiSuccess(
      {
        instrument,
        requestedDate: tradingDate,
        today,
        horizon: lookup.available
          ? horizonFor(lookup.record, today)
          : tradingDate > today
            ? "NEXT"
            : tradingDate === today
              ? "CURRENT"
              : "HISTORICAL",
        ...lookup,
      },
      {
        meta: {
          context,
          retentionDays: retentionDays(),
          earliestSelectableDate: retentionCutoff(today),
        },
        cache: isForward ? CACHE.forward : CACHE.historical,
      },
    );
  } catch (error) {
    return apiUnexpected("GET /api/cpr", error);
  }
}
