import { AlertTriangle, ArrowLeftRight, Info } from "lucide-react";
import {
  ClassificationBadge,
  ClassificationBreakdown,
} from "@/components/classification-badge";
import { Card } from "@/components/ui/card";
import type { Horizon } from "@/lib/services/cpr-service";
import type { CPRRecord, CPRUnavailable } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatDisplayDate, formatWeekday } from "@/lib/utils/date";
import { formatPercent, formatPrice, formatWidth } from "@/lib/utils/format";

/** Main CPR card (PRD §7, §13, §37, §38). */

const HORIZON_LABEL: Record<Horizon, string> = {
  NEXT: "Next Trading Day",
  CURRENT: "Current Trading Day",
  HISTORICAL: "Trading Day",
};

function Level({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-3 text-center",
        emphasis
          ? "border-brand/30 bg-brand-tint"
          : "border-line bg-surface-muted",
      )}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div
        className={cn(
          "numeric mt-1 text-base font-semibold sm:text-lg",
          emphasis ? "text-brand" : "text-ink",
        )}
      >
        {formatPrice(value)}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-muted px-3 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div className="numeric mt-1 text-sm font-semibold text-ink sm:text-base">
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[11px] text-ink-muted">{hint}</div>
      ) : null}
    </div>
  );
}

/** PRD §27/§29: a reason, never a zero. */
export function CPRUnavailableCard({
  instrumentName,
  tradingDate,
  error,
}: {
  instrumentName: string;
  tradingDate: string;
  error: CPRUnavailable;
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
              <span className="font-medium text-brand">
                {formatDisplayDate(error.suggestedDate)}
              </span>
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
  record: CPRRecord;
  horizon: Horizon;
  instrumentNote?: string | null;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-brand">
              {HORIZON_LABEL[horizon]}
              {record.projected ? " · projected" : ""}
            </div>
            <h2 className="mt-1 truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl">
              {record.instrumentName}
            </h2>
            <p className="numeric mt-0.5 text-sm text-ink-muted">
              {formatDisplayDate(record.tradingDate)} ·{" "}
              {formatWeekday(record.tradingDate)}
            </p>
          </div>
          <ClassificationBadge value={record.overallClassification} size="lg" />
        </div>
      </div>

      <div className="px-4 py-4 sm:px-5">
        {/* BC / P / TC — the three levels the dashboard leads with (PRD §14). */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Level label="BC" value={record.bc} />
          <Level label="Pivot" value={record.pivot} emphasis />
          <Level label="TC" value={record.tc} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3">
          <Metric label="CPR Width" value={formatWidth(record.cprWidth)} />
          <Metric label="Width %" value={formatPercent(record.cprWidthPercent)} />
        </div>

        {record.inverted ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-surface-muted px-3 py-2 text-xs text-ink-muted">
            <ArrowLeftRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              <span className="font-medium text-ink">Inverted CPR.</span> The raw
              formula produced BC above TC; the two were swapped so TC ≥ BC. The
              width is unaffected.
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
        <div className="mt-4 border-t border-line pt-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            Derived from the completed {formatDisplayDate(record.sourceDate)}{" "}
            session
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:gap-3">
            <Metric label="High" value={formatPrice(record.high)} />
            <Metric label="Low" value={formatPrice(record.low)} />
            <Metric label="Close" value={formatPrice(record.close)} />
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
                  <code className="rounded bg-surface-muted px-1 py-0.5 text-[11px] text-ink">
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
