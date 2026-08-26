import type {
  Classification,
  ClassificationBasis,
  ClassificationMethod,
  OverallClassification,
  PivotLevels,
} from "@/lib/cpr/types";
import type { InstrumentCategory } from "@/lib/instruments";
import type { ISODate } from "@/lib/utils/date";

/**
 * The app-level CPR record — the single shape returned by the API and consumed
 * by every component. Database rows and freshly computed results both normalise
 * into this, so the UI cannot tell (or care) which path served it.
 */
export interface CPRRecord {
  instrumentId: string;
  instrumentSymbol: string;
  instrumentName: string;
  instrumentCategory: InstrumentCategory;
  currency: string;

  /** Session these levels apply to. */
  tradingDate: ISODate;
  /** Completed session the levels were derived from. */
  sourceDate: ISODate;

  high: number;
  low: number;
  close: number;

  pivot: number;
  bc: number;
  tc: number;

  cprWidth: number;
  cprWidthPercent: number;

  pointsClassification: Classification;
  percentageClassification: Classification;
  overallClassification: OverallClassification;
  basis: ClassificationBasis;
  /** The method configured for this instrument (NIFTY 50: points; others: %). */
  classificationMethod: ClassificationMethod;
  /** The method that actually produced the verdict; differs on a FALLBACK. */
  resolvedMethod: ClassificationMethod | null;
  /** True when both methods independently landed on the same band. */
  methodsAgree: boolean;

  /** Raw BC exceeded raw TC and the pair was swapped (inverted CPR). */
  inverted: boolean;

  pivotLevels: PivotLevels;

  /** Provider the source bar came from. */
  dataSource: string;
  /**
   * The exact vendor series queried. For futures this is the contract month,
   * e.g. "GCZ26.CMX" — recorded so a figure can be traced to its source series.
   */
  providerSymbol: string;
  /** True when the data is synthetic development output. */
  isMockData: boolean;
  /**
   * True when `tradingDate` is a FORECAST from the trading calendar rather than
   * a session the provider has observed. Forward-looking CPR is always
   * projected; the UI labels it so a projected date is never read as settled.
   */
  projected: boolean;
}

/** Why a CPR could not be produced (PRD §27, §29). */
export type CPRUnavailableReason =
  /** Provider returned nothing for the requested window. */
  | "NO_DATA"
  /** Market was closed on the requested date. */
  | "MARKET_CLOSED"
  /** Source bar failed validation, e.g. a single-tick session with no range. */
  | "INVALID_SOURCE_BAR"
  /** The provider itself errored or was unreachable. */
  | "PROVIDER_ERROR"
  /** Requested date is outside the retention window. */
  | "OUT_OF_RANGE"
  /**
   * The active provider cannot serve this instrument at all — not a transient
   * failure. MCX contracts under Yahoo, for instance.
   */
  | "PROVIDER_LACKS_INSTRUMENT"
  /**
   * The date is further ahead than any CPR can yet be derived for.
   *
   * A CPR for day D comes from day D-1's COMPLETED session, so the furthest
   * date that can exist is one session past the last settled one. Anything
   * beyond that is not missing data — it is not computable yet.
   */
  | "BEYOND_HORIZON";

export interface CPRUnavailable {
  reason: CPRUnavailableReason;
  message: string;
  /** Set when the market was closed and a nearby session exists. */
  suggestedDate?: ISODate;
}

export type CPRLookup =
  | { available: true; record: CPRRecord }
  | { available: false; error: CPRUnavailable };

/** Calendar/provenance context returned alongside dashboard payloads. */
export interface DataContext {
  provider: string;
  providerLabel: string;
  isMockData: boolean;
  /** Vendor series actually queried (futures: the resolved contract month). */
  resolvedSymbol?: string;
  /** Whether the instrument's forward holiday list is complete. */
  holidayCoverage: "COMPLETE" | "PARTIAL";
  /** True when results were served from the database rather than computed live. */
  fromDatabase: boolean;
}
