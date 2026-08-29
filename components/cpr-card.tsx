import Link from "next/link";
import { AlertTriangle, ArrowLeftRight, Info } from "lucide-react";
import {
  ClassificationBadge,
  ClassificationBreakdown,
} from "@/components/classification-badge";
import { CPRRange, Stat } from "@/components/cpr-range";
import { Card } from "@/components/ui/card";
import type { Horizon } from "@/lib/services/cpr-service";
import type { MaybeRedactedRecord } from "@/lib/cpr/redact";
import type { CPRUnavailable } from "@/lib/types";
import { formatDisplayDate, formatWeekday } from "@/lib/utils/date";
import { formatPercent, formatPrice, formatWidth } from "@/lib/utils/format";

/** Main CPR card (PRD §7, §13, §37, §38). */

const HORIZON_LABEL: Record<Horizon, string> = {
  NEXT: "Next Trading Day",
  CURRENT: "Current Trading Day",
  HISTORICAL: "Trading Day",
};

/** PRD §27/§29: a reason, never a zero. */
export function CPRUnavailableCard({
  instrumentName,
  tradingDate,
  error,
  suggestedHref,
}: {
  instrumentName: string;
  tradingDate: string;
  error: CPRUnavailable;
  /** Where "nearest available trading date" should go. */
  suggestedHref?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-cls-mixed"
          aria-hidden
        />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">
            {instrumentName} · {formatDisplayDate(tradingDate)}
          </h2>
          <p className="mt-1 text-sm font-medium text-ink">CPR unavailable</p>
          <p className="mt-1 text-sm text-ink-muted">{error.message}</p>
          {error.suggestedDate ? (
            <p className="mt-3 text-xs text-ink-muted">
              Nearest available trading date:{" "}
              {suggestedHref ? (
                <Link
                  href={suggestedHref}
                  className="font-medium text-brand underline underline-offset-2 hover:no-underline"
                >
                  {formatDisplayDate(error.suggestedDate)}
                </Link>
              ) : (
                <span className="font-medium text-brand">
                  {formatDisplayDate(error.suggestedDate)}
                </span>
              )}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export function CPRCard({
  record,
  horizon,
  instrumentNote,
}: {
  record: MaybeRedactedRecord;
  horizon: Horizon;
  instrumentNote?: string | null;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line bg-surface-muted/40 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 eyebrow text-brand">
              <span>{HORIZON_LABEL[horizon]}</span>
              {record.projected ? (
                <span className="rounded bg-brand-tint px-1.5 py-0.5 text-brand">
                  projected
                </span>
              ) : null}
            </div>
            <h2 className="mt-1.5 truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl">
              {record.instrumentName}
            </h2>
            <p className="numeric mt-1 text-sm text-ink-muted">
              {formatDisplayDate(record.tradingDate)} ·{" "}
              {formatWeekday(record.tradingDate)}
            </p>
          </div>
          <ClassificationBadge value={record.overallClassification} size="lg" />
        </div>
      </div>

      <div className="px-4 py-4 sm:px-5">
        {/* The range itself, then the two figures that describe it (PRD §14). */}
        <div className="grid items-stretch gap-3 sm:grid-cols-5">
          <CPRRange
            bc={record.bc}
            pivot={record.pivot}
            tc={record.tc}
            className="sm:col-span-3"
          />
          <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-1">
            <Stat
              label="CPR Width"
              value={formatWidth(record.cprWidth)}
              emphasis
            />
            <Stat
              label="Width %"
              value={formatPercent(record.cprWidthPercent)}
              emphasis
            />
          </div>
        </div>

        {record.inverted ? (
          <p className="mt-2.5 flex items-start gap-1.5 px-1 text-xs leading-relaxed text-ink-muted">
            <ArrowLeftRight className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>
              <span className="font-medium text-ink">Inverted CPR</span> — the
              raw formula produced BC above TC, so the two were swapped to keep
              TC ≥ BC. The width is unaffected.
            </span>
          </p>
        ) : null}

        <div className="mt-4 border-t border-line pt-4">
          <ClassificationBreakdown
            points={record.pointsClassification}
            percentage={record.percentageClassification}
            overall={record.overallClassification}
            basis={record.basis}
            method={record.classificationMethod}
            resolvedMethod={record.resolvedMethod}
            methodsAgree={record.methodsAgree}
          />
        </div>

        {/* Source session — PRD §13, and the answer to "which day made this?" */}
        <div className="mt-4 border-t border-line pt-3.5">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
              Derived from {formatDisplayDate(record.sourceDate)}
            </span>
            <dl className="numeric flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
              {(
                [
                  ["High", record.high],
                  ["Low", record.low],
                  ["Close", record.close],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-baseline gap-1.5">
                  <dt className="text-xs uppercase tracking-wider text-ink-muted">
                    {label}
                  </dt>
                  <dd className="font-medium text-ink">{formatPrice(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {instrumentNote ? (
          <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {instrumentNote}
              {/*
                For futures the contract month changes as contracts roll, and
                two contracts trade at different prices — so the series these
                levels came from is named, not implied.
              */}
              {record.providerSymbol &&
              record.providerSymbol !== record.dataSource ? (
                <>
                  {" "}
                  Series:{" "}
                  <code className="rounded bg-surface-muted px-1 py-0.5 text-xs text-ink">
                    {record.providerSymbol}
                  </code>
                  .
                </>
              ) : null}
            </span>
          </p>
        ) : null}
      </div>
    </Card>
  );
}
