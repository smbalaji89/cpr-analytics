import type { CPRRecord, DataContext } from "@/lib/types";

/**
 * Output redaction for the public view.
 *
 * ── Why this exists as its own layer ───────────────────────────────────────
 * The provenance is not only in the footer. `/history` renders charts as CLIENT
 * components, so Next serialises the record objects into the page source —
 * measured at 22 occurrences each of `dataSource`, `providerSymbol` and the
 * vendor name in the HTML of a single page. Hiding the footer, or hiding
 * anything with CSS, leaves all of that in view-source.
 *
 * So redaction happens by DELETING FIELDS on the way out, not by declining to
 * display them.
 *
 * ── Why not in the service layer ───────────────────────────────────────────
 * `lib/services/cpr-service.ts` feeds both rendering AND write-through
 * persistence. Redacting there would strip `dataSource` from rows on their way
 * INTO the database, permanently losing which provider produced them. So this
 * is applied at the two output boundaries — API responses, and page components
 * before records reach a client component — and never on the write path.
 */

/** Fields that identify the vendor or the plumbing behind a figure. */
type RedactedField = "dataSource" | "providerSymbol" | "isMockData";

export type PublicCPRRecord = Omit<CPRRecord, RedactedField>;

/**
 * A record that may or may not have been redacted.
 *
 * Display components take THIS rather than `CPRRecord`, so the same component
 * renders both views and the redacted fields are simply absent. Anything that
 * reads one already has to handle it being missing, which is what makes the
 * public view fall out automatically — the card's "Series:" line, for
 * instance, is conditional on `providerSymbol` and so disappears on its own.
 */
export type MaybeRedactedRecord = PublicCPRRecord &
  Partial<Pick<CPRRecord, RedactedField>>;

export function redactRecord(record: CPRRecord): PublicCPRRecord {
  const {
    dataSource: _dataSource,
    providerSymbol: _providerSymbol,
    isMockData: _isMockData,
    ...rest
  } = record;
  return rest;
}

/** Redact when unprivileged; pass through untouched when privileged. */
export function redactRecords(
  records: readonly CPRRecord[],
  privileged: boolean,
): MaybeRedactedRecord[] {
  return privileged ? [...records] : records.map(redactRecord);
}

export function redactRecordIf(
  record: CPRRecord,
  privileged: boolean,
): MaybeRedactedRecord {
  return privileged ? record : redactRecord(record);
}

/**
 * Redact the request context.
 *
 * `isMockData` is deliberately PRESERVED. It drives the synthetic-data banner,
 * and suppressing that warning is the one change in this whole feature capable
 * of causing real financial harm — someone trading off invented levels because
 * the page looked clean. A tidier public view is not worth that.
 */
export function redactContext(
  context: DataContext,
  privileged: boolean,
): DataContext {
  if (privileged) return context;
  return {
    ...context,
    provider: "",
    providerLabel: "",
    resolvedSymbol: undefined,
  };
}
