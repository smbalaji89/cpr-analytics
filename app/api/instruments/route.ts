import { apiSuccess, apiUnexpected, CACHE } from "@/lib/api/response";
import {
  CATEGORY_LABELS,
  instrumentsByCategory,
  noteFor,
  DEFAULT_INSTRUMENT_SYMBOL,
} from "@/lib/instruments";
import { MARKETS } from "@/lib/market-data/calendar";
import { retentionDays } from "@/lib/services/retention";

export const dynamic = "force-static";

/**
 * GET /api/instruments
 *
 * Registry, grouped for the selector. Static data — cached aggressively.
 *
 * Always serves the PUBLIC note, even to an unlocked device. The route is
 * `force-static`: it cannot read the access cookie, and one cached body is
 * handed to everyone, so anything privileged placed here would leak to the
 * next anonymous caller. Privileged readers get the full note on
 * `/instruments`, which is dynamic.
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
        note: noteFor(instrument, false) ?? null,
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
