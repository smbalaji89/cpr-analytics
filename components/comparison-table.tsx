import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { ClassificationBadge } from "@/components/classification-badge";
import type { CompareRow } from "@/lib/services/cpr-service";
import type { MaybeRedactedRecord } from "@/lib/cpr/redact";

/**
 * The row as DISPLAYED — its record may have been redacted for a public
 * visitor. The service's own `CompareRow` keeps the full record type, because
 * the write path still needs it.
 */
type DisplayRow = Omit<CompareRow, "record"> & {
  record: MaybeRedactedRecord | null;
};
import { CATEGORY_LABELS } from "@/lib/instruments";
import { cn } from "@/lib/utils/cn";
import { formatShortDate } from "@/lib/utils/date";
import { formatPercent, formatPrice } from "@/lib/utils/format";

/**
 * Cross-instrument comparison (PRD §16, §36).
 *
 * Every row shows BOTH classification methods and marks which one decides that
 * instrument's category — NIFTY 50 by points, everything else by percentage.
 * This table is exactly where a reader would otherwise assume one shared scale
 * is in play, so the deciding method is named per row rather than implied.
 *
 * Rows also print the date each figure came from. Instruments run on different
 * calendars and session clocks, so a comparison can legitimately mix dates —
 * silently, that would be a fabricated like-for-like.
 */

/** Marks the method that set this row's category. */
function DecidesTag() {
  return (
    <span className="ml-1.5 rounded bg-brand px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
      decides
    </span>
  );
}
export function ComparisonTable({
  rows,
  className,
}: {
  rows: DisplayRow[];
  className?: string;
}) {
  const adjusted = rows.filter((r) => r.dateAdjusted);

  return (
    <div className={className}>
      {adjusted.length > 0 ? (
        <p className="mx-4 mb-3 flex items-start gap-2 rounded-lg bg-surface-muted px-3 py-2 text-xs text-ink-muted sm:mx-5">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {adjusted.length} instrument{adjusted.length === 1 ? "" : "s"} had no
            session on the requested date — their own most recent session is shown
            instead, marked below.
          </span>
        </p>
      ) : null}

      {/* ── Desktop ─────────────────────────────────────────────────────── */}
      <div className="scroll-x hidden md:block">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {["Instrument", "Date"].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {label}
                </th>
              ))}
              {["CPR Width", "Width %"].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {label}
                </th>
              ))}
              {["By points", "By percentage", "Overall"].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.instrument.symbol}
                className="border-b border-line last:border-0 hover:bg-surface-muted"
              >
                <td className="px-3 py-2.5">
                  <Link
                    href={`/?instrument=${row.instrument.symbol}`}
                    className="font-medium text-ink hover:text-brand hover:underline"
                  >
                    {row.instrument.name}
                  </Link>
                  <div className="text-[11px] text-ink-muted">
                    {
                      CATEGORY_LABELS[
                        row.instrument
                          .category as keyof typeof CATEGORY_LABELS
                      ]
                    }{" "}
                    · {row.instrument.currency}
                  </div>
                </td>
                <td className="numeric whitespace-nowrap px-3 py-2.5 text-ink-muted">
                  {row.tradingDate ? formatShortDate(row.tradingDate) : "—"}
                  {row.dateAdjusted ? (
                    <span className="ml-1.5 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
                      other date
                    </span>
                  ) : null}
                </td>
                {row.record ? (
                  <>
                    <td className="numeric px-3 py-2.5 text-right font-semibold text-ink">
                      {formatPrice(row.record.cprWidth)}
                    </td>
                    <td className="numeric px-3 py-2.5 text-right font-semibold text-ink">
                      {formatPercent(row.record.cprWidthPercent)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <ClassificationBadge
                        value={row.record.pointsClassification}
                        size="sm"
                      />
                      {(row.record.resolvedMethod ??
                        row.record.classificationMethod) === "POINTS" ? (
                        <DecidesTag />
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <ClassificationBadge
                        value={row.record.percentageClassification}
                        size="sm"
                      />
                      {(row.record.resolvedMethod ??
                        row.record.classificationMethod) === "PERCENTAGE" ? (
                        <DecidesTag />
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <ClassificationBadge
                        value={row.record.overallClassification}
                        size="sm"
                      />
                    </td>
                  </>
                ) : (
                  <td colSpan={5} className="px-3 py-2.5 text-ink-muted">
                    {row.unavailable?.message ??
                      "Data is not currently available for this instrument."}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile ──────────────────────────────────────────────────────── */}
      <ul className="divide-y divide-line md:hidden">
        {rows.map((row) => (
          <li key={row.instrument.symbol} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/?instrument=${row.instrument.symbol}`}
                  className="text-sm font-semibold text-ink"
                >
                  {row.instrument.name}
                </Link>
                <div className="numeric mt-0.5 text-[11px] text-ink-muted">
                  {row.tradingDate ? formatShortDate(row.tradingDate) : "—"}
                  {row.dateAdjusted ? " · other date" : ""}
                </div>
              </div>
              {row.record ? (
                <ClassificationBadge
                  value={row.record.overallClassification}
                  size="sm"
                />
              ) : null}
            </div>

            {row.record ? (
              <>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-surface-muted px-2.5 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-ink-muted">
                      Width
                    </div>
                    <div className="numeric text-sm font-semibold text-ink">
                      {formatPrice(row.record.cprWidth)}
                    </div>
                  </div>
                  <div className="rounded-md bg-surface-muted px-2.5 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-ink-muted">
                      Width %
                    </div>
                    <div className="numeric text-sm font-semibold text-ink">
                      {formatPercent(row.record.cprWidthPercent)}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ink-muted">
                  <span className="flex items-center gap-1.5">
                    points
                    <ClassificationBadge
                      value={row.record.pointsClassification}
                      size="sm"
                    />
                  </span>
                  <span className="flex items-center gap-1.5">
                    percentage
                    <ClassificationBadge
                      value={row.record.percentageClassification}
                      size="sm"
                    />
                  </span>
                </div>
              </>
            ) : (
              <p className="mt-2 text-xs text-ink-muted">
                {row.unavailable?.message ??
                  "Data is not currently available for this instrument."}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Legend explaining which method decides each instrument's category. */
export function ClassificationScaleNote({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface-muted px-4 py-3 text-xs leading-relaxed text-ink-muted",
        className,
      )}
    >
      <p className="font-medium text-ink">
        How each instrument&rsquo;s category is decided
      </p>
      <p className="mt-1">
        <span className="font-medium text-ink">NIFTY 50</span> is classified by{" "}
        <span className="font-medium text-ink">CPR width in points</span> (1–40
        narrow, 41–70 mixed, 71–200 wider). Every{" "}
        <span className="font-medium text-ink">other instrument</span> is
        classified by <span className="font-medium text-ink">CPR width %</span>{" "}
        (0.01–0.25 % narrow, 0.26–0.49 % mixed, ≥ 0.50 % wider).
      </p>
      <p className="mt-2">
        The points bands were calibrated for a NIFTY-scale index and do not
        transfer: Crude Oil near 85 produces a CPR under one point — below the
        scale entirely — while BTC near 79,000 routinely exceeds 200 points.
        Width % divides by the pivot, so it stays meaningful at any price scale.
        Both methods are shown for every instrument; the one that sets the
        category is tagged <em>decides</em>.
      </p>
    </div>
  );
}
