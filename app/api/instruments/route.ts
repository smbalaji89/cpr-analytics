import { apiSuccess, apiUnexpected, CACHE } from "@/lib/api/response";
import {
  CATEGORY_LABELS,
  instrumentsByCategory,
  DEFAULT_INSTRUMENT_SYMBOL,
} from "@/lib/instruments";
import { MARKETS } from "@/lib/market-data/calendar";
import { retentionDays } from "@/lib/services/retention";

export const dynamic = "force-static";

/**
 * GET /api/instruments
 *
 * Registry, grouped for the selector. Static data — cached aggressively.
 */
export async function GET() {
  try {
    const groups = instrumentsByCategory().map((group) => ({
      category: group.category,
      label: group.label,
      instruments: group.instruments.map((instrument) => ({
        symbol: instrument.symbol,
        name: instrument.name,
        shortName: instrument.shortName,
        category: instrument.category,
        categoryLabel: CATEGORY_LABELS[instrument.category],
        currency: instrument.currency,
        market: instrument.market,
        marketLabel: MARKETS[instrument.market].label,
        timeZone: MARKETS[instrument.market].timeZone,
        tradesWeekends: MARKETS[instrument.market].tradesWeekends,
        holidayCoverage: MARKETS[instrument.market].holidayCoverage,
        note: instrument.note ?? null,
      })),
    }));

    return apiSuccess(
      {
        groups,
        defaultInstrument: DEFAULT_INSTRUMENT_SYMBOL,
        retentionDays: retentionDays(),
      },
      { cache: CACHE.static },
    );
  } catch (error) {
    return apiUnexpected("GET /api/instruments", error);
  }
}
