import type { Metadata } from "next";
import { Suspense } from "react";
import {
  CategoryFilterChips,
  FilteredEmptyState,
} from "@/components/category-filter";
import {
  ClassificationScaleNote,
  ComparisonTable,
} from "@/components/comparison-table";
import { MockDataBanner, ProvenanceNote } from "@/components/data-notice";
import { SiteHeader } from "@/components/site-header";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { parseCategoryFilter, type CategoryFilter } from "@/lib/cpr/filter";
import {
  DEFAULT_INSTRUMENT_SYMBOL,
  INSTRUMENTS,
  instrumentsByCategory,
} from "@/lib/instruments";
import { MARKETS } from "@/lib/market-data/calendar";
import { getProviderForInstrument } from "@/lib/market-data";
import { isPrivileged } from "@/lib/auth/access";
import { redactContext, redactRecordIf } from "@/lib/cpr/redact";
import { noteFor } from "@/lib/instruments";
import {
  getComparison,
  getDefaultTradingDate,
} from "@/lib/services/cpr-service";
import { formatDisplayDate, isISODate, type ISODate } from "@/lib/utils/date";

export const metadata: Metadata = { title: "Instruments" };
export const dynamic = "force-dynamic";

/** Instrument comparison and registry (PRD §2, §16, §24). */

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function InstrumentsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = params.date;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const date =
    requested && isISODate(requested) ? (requested as ISODate) : undefined;

  const rawCategory = params.category;
  const categories = parseCategoryFilter(
    Array.isArray(rawCategory) ? rawCategory[0] : rawCategory,
  );

  return (
    <div className="min-h-dvh bg-surface-muted">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6">
        <div className="mb-4">
          <h1 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
            Instruments
          </h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            CPR width across all {INSTRUMENTS.length} tracked instruments, plus
            the calendar each one follows.
          </p>
        </div>

        <Suspense
          fallback={
            <Card>
              <TableSkeleton rows={INSTRUMENTS.length} />
            </Card>
          }
        >
          <ComparisonSection date={date} categories={categories} />
        </Suspense>

        <InstrumentRegistry />
      </main>
    </div>
  );
}

async function ComparisonSection({
  date,
  categories,
}: {
  date?: ISODate;
  categories: CategoryFilter;
}) {
  const target =
    date ?? (await getDefaultTradingDate(DEFAULT_INSTRUMENT_SYMBOL));

  if (!target) {
    return (
      <Card className="p-6">
        <p className="text-sm font-medium text-ink">
          Market data temporarily unavailable.
        </p>
        <p className="mt-1 text-sm text-ink-muted">Please try again later.</p>
      </Card>
    );
  }

  const privileged = await isPrivileged();
  const { rows, context, totalBeforeFilter } = await getComparison(
    target,
    undefined,
    categories,
    privileged,
  );

  const publicRows = rows.map((row) =>
    row.record
      ? { ...row, record: redactRecordIf(row.record, privileged) }
      : row,
  );

  return (
    <div className="space-y-4">
      <MockDataBanner context={context} />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Comparison — {formatDisplayDate(target)}</CardTitle>
          <CardDescription>
            Both methods are shown for every instrument; the one that sets the
            category is tagged <em>decides</em>.
          </CardDescription>
          <CategoryFilterChips selected={categories} className="mt-3" />
        </CardHeader>
        {rows.length === 0 && categories ? (
          <FilteredEmptyState
            totalBeforeFilter={totalBeforeFilter}
            noun="instruments"
          />
        ) : (
          <ComparisonTable rows={publicRows} className="mt-2" />
        )}
      </Card>

      <ClassificationScaleNote />
      <ProvenanceNote context={redactContext(context, privileged)} className="px-1" />
    </div>
  );
}

/** Static registry view — which calendar and contract each instrument uses. */
async function InstrumentRegistry() {
  const privileged = await isPrivileged();
  const groups = instrumentsByCategory();

  return (
    <div className="mt-6 space-y-4">
      <h2 className="text-base font-semibold tracking-tight text-ink">
        Coverage
      </h2>
      {groups.map((group) => (
        <Card key={group.category}>
          <CardHeader>
            <CardTitle>{group.label}</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-line px-4 pb-2 sm:px-5">
            {group.instruments.map((instrument) => {
              const market = MARKETS[instrument.market];
              // Resolved per instrument, not the configured default: the
              // Indian instruments route to Upstox while the default is Yahoo.
              let source: string | null = null;
              if (privileged) {
                try {
                  source = getProviderForInstrument(instrument).label;
                } catch {
                  source = "provider not configured";
                }
              }
              return (
                <li key={instrument.symbol} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-ink">
                      {instrument.name}
                    </span>
                    <span className="text-[11px] text-ink-muted">
                      {market.label} · {instrument.currency} ·{" "}
                      {market.tradesWeekends
                        ? "trades 24/7"
                        : "weekdays, exchange holidays excluded"}
                      {source ? ` · ${source}` : ""}
                    </span>
                  </div>
                  {noteFor(instrument, privileged) ? (
                    <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                      {noteFor(instrument, privileged)}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
