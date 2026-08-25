import Link from "next/link";
import { ClassificationBadge } from "@/components/classification-badge";
import type { CPRRecord } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatDisplayDate, formatShortDate } from "@/lib/utils/date";
import { formatPercent, formatPrice } from "@/lib/utils/format";

/**
 * Historical CPR table (PRD §12, §17).
 *
 * Two renderings of the same data: a full table from `md` up, and cards below
 * it. PRD §17 is explicit that a wide desktop table must not be forced onto a
 * phone, and a 12-column financial grid at 375px is unreadable however much it
 * is allowed to scroll.
 *
 * ── On the two dates ───────────────────────────────────────────────────────
 * Every row carries a trading date and a source date, and shows both. The CPR
 * APPLIES to the trading date; the H/L/C columns are the SOURCE session that
 * produced it. Labelling a row with one date while showing the other session's
 * prices is the single easiest way for a table like this to mislead.
 */

function rowHref(record: CPRRecord): string {
  return `/?instrument=${record.instrumentSymbol}&date=${record.tradingDate}`;
}

function ProjectedTag() {
  return (
    <span className="ml-1.5 rounded bg-brand-tint px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">
      projected
    </span>
  );
}

export function CPRTable({
  records,
  emptyMessage = "No CPR data available for this date.",
  className,
}: {
  records: CPRRecord[];
  emptyMessage?: string;
  className?: string;
}) {
  if (records.length === 0) {
    return (
      <p className={cn("px-4 py-8 text-center text-sm text-ink-muted", className)}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className={className}>
      {/* ── Desktop ─────────────────────────────────────────────────────── */}
      <div className="scroll-x hidden md:block">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th
                scope="col"
                className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
              >
                CPR for
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
              >
                Source session
              </th>
              {["High", "Low", "Close", "BC", "Pivot", "TC"].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {label}
                </th>
              ))}
              <th
                scope="col"
                className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
              >
                Width
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
              >
                Width %
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
              >
                Classification
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr
                key={`${record.instrumentSymbol}-${record.tradingDate}`}
                className="border-b border-line last:border-0 hover:bg-surface-muted"
              >
                <td className="whitespace-nowrap px-3 py-2.5 font-medium text-ink">
                  <Link
                    href={rowHref(record)}
                    className="hover:text-brand hover:underline"
                  >
                    {formatShortDate(record.tradingDate)}
                  </Link>
                  {record.projected ? <ProjectedTag /> : null}
                </td>
                <td className="numeric whitespace-nowrap px-3 py-2.5 text-ink-muted">
                  {formatShortDate(record.sourceDate)}
                </td>
                {[
                  record.high,
                  record.low,
                  record.close,
                  record.bc,
                  record.pivot,
                  record.tc,
                ].map((value, i) => (
                  <td
                    key={i}
                    className="numeric whitespace-nowrap px-3 py-2.5 text-right text-ink"
                  >
                    {formatPrice(value)}
                  </td>
                ))}
                <td className="numeric whitespace-nowrap px-3 py-2.5 text-right font-semibold text-ink">
                  {formatPrice(record.cprWidth)}
                </td>
                <td className="numeric whitespace-nowrap px-3 py-2.5 text-right font-semibold text-ink">
                  {formatPercent(record.cprWidthPercent)}
                </td>
                <td className="px-3 py-2.5">
                  <ClassificationBadge
                    value={record.overallClassification}
                    size="sm"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile ──────────────────────────────────────────────────────── */}
      <ul className="divide-y divide-line md:hidden">
        {records.map((record) => (
          <li key={`${record.instrumentSymbol}-${record.tradingDate}`}>
            <Link
              href={rowHref(record)}
              className="block px-4 py-3 active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">
                    {formatDisplayDate(record.tradingDate)}
                    {record.projected ? <ProjectedTag /> : null}
                  </div>
                  <div className="numeric mt-0.5 text-[11px] text-ink-muted">
                    from {formatShortDate(record.sourceDate)} session
                  </div>
                </div>
                <ClassificationBadge
                  value={record.overallClassification}
                  size="sm"
                />
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <div className="rounded-md bg-surface-muted px-2.5 py-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-ink-muted">
                    Width
                  </div>
                  <div className="numeric text-sm font-semibold text-ink">
                    {formatPrice(record.cprWidth)} pts
                  </div>
                </div>
                <div className="rounded-md bg-surface-muted px-2.5 py-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-ink-muted">
                    Width %
                  </div>
                  <div className="numeric text-sm font-semibold text-ink">
                    {formatPercent(record.cprWidthPercent)}
                  </div>
                </div>
              </div>

              <div className="numeric mt-2 flex justify-between gap-2 text-[11px] text-ink-muted">
                <span>BC {formatPrice(record.bc)}</span>
                <span>P {formatPrice(record.pivot)}</span>
                <span>TC {formatPrice(record.tc)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
