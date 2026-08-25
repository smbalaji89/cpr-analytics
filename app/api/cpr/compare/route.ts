import { apiError, apiSuccess, apiUnexpected, CACHE } from "@/lib/api/response";
import { compareQuerySchema, formatZodError } from "@/lib/api/validation";
import { getComparison, getDefaultTradingDate } from "@/lib/services/cpr-service";
import { DEFAULT_INSTRUMENT_SYMBOL, INSTRUMENTS } from "@/lib/instruments";
import { todayInTimeZone } from "@/lib/utils/date";
import { retentionCutoff, retentionDays } from "@/lib/services/retention";

export const dynamic = "force-dynamic";

/**
 * GET /api/cpr/compare?date=2026-08-25&instruments=NIFTY50,BTC
 *
 * One row per instrument for a single date (PRD §16).
 *
 * Instruments do NOT share a trading calendar, so a row can legitimately be
 * unavailable while its neighbours have data — a Saturday is a live BTC session
 * and a closed NSE. Each row carries its own availability rather than the
 * response being all-or-nothing.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = compareQuerySchema.safeParse({
      date: url.searchParams.get("date") ?? undefined,
      instruments: url.searchParams.get("instruments") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
    });

    if (!parsed.success) {
      return apiError("BAD_REQUEST", formatZodError(parsed.error));
    }

    const symbols = parsed.data.instruments ?? INSTRUMENTS.map((i) => i.symbol);

    // Default to the reference instrument's next trading date so the comparison
    // opens on the same date the dashboard shows.
    const date =
      parsed.data.date ?? (await getDefaultTradingDate(DEFAULT_INSTRUMENT_SYMBOL));
    if (!date) {
      return apiError(
        "PROVIDER_ERROR",
        "Market data temporarily unavailable. Please try again later.",
      );
    }

    const { rows, context, totalBeforeFilter } = await getComparison(
      date,
      symbols,
      parsed.data.category,
    );
    const today = todayInTimeZone("Asia/Kolkata");

    return apiSuccess(
      {
        date,
        category: parsed.data.category,
        count: rows.length,
        totalBeforeFilter,
        availableCount: rows.filter((r) => r.record !== null).length,
        rows,
      },
      {
        meta: {
          context,
          retentionDays: retentionDays(),
          earliestSelectableDate: retentionCutoff(today),
        },
        cache: CACHE.forward,
      },
    );
  } catch (error) {
    return apiUnexpected("GET /api/cpr/compare", error);
  }
}
