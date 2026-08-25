import Link from "next/link";
import { Suspense } from "react";
import {
  CategoryFilterChips,
  FilteredEmptyState,
} from "@/components/category-filter";
import { CPRCard, CPRUnavailableCard } from "@/components/cpr-card";
import { CPRTable } from "@/components/cpr-table";
import { MockDataBanner, ProvenanceNote } from "@/components/data-notice";
import { DateSelector } from "@/components/date-selector";
import { InstrumentSelector } from "@/components/instrument-selector";
import { PivotLevelsPanel } from "@/components/pivot-levels";
import { SiteHeader } from "@/components/site-header";
import { ToggleLink } from "@/components/toggle-link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CPRCardSkeleton,
  Skeleton,
  TableSkeleton,
} from "@/components/ui/skeleton";
import { classificationLabel } from "@/lib/cpr/classification";
import { formatPrice } from "@/lib/utils/format";
import { parseCategoryFilter, type CategoryFilter } from "@/lib/cpr/filter";
import { DEFAULT_INSTRUMENT_SYMBOL, getInstrument } from "@/lib/instruments";
import { retentionDays } from "@/lib/services/retention";
import {
  getCPRForDate,
  getDateNavigation,
  getDefaultTradingDate,
  getHistory,
  horizonFor,
  todayFor,
  unsupportedReason,
} from "@/lib/services/cpr-service";
import { isISODate, type ISODate } from "@/lib/utils/date";

/**
 * Dashboard (PRD §3, §4, §37, §38).
 *
 * A server component: the CPR engine, provider and database all run server-side
 * and only the finished figures cross to the client. Interactivity is confined
 * to the selectors, the toggle and the chart (PRD §31).
 *
 * State lives in the query string (`?instrument=&date=&levels=`), which makes
 * every view shareable and the browser's back button behave.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const requestedSymbol = (
    firstParam(params, "instrument") ?? DEFAULT_INSTRUMENT_SYMBOL
  ).toUpperCase();
  const instrument =
    getInstrument(requestedSymbol) ?? getInstrument(DEFAULT_INSTRUMENT_SYMBOL)!;

  const requestedDate = firstParam(params, "date");
  const showLevels = firstParam(params, "levels") === "1";
  const categories = parseCategoryFilter(firstParam(params, "category"));

  return (
    <div className="min-h-dvh bg-surface-muted">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6">
        {/* Controls — one row above the content on every breakpoint. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <InstrumentSelector
            value={instrument.symbol}
            className="w-full sm:w-64"
          />
          <Suspense fallback={<div className="h-11" />}>
            <DateControls
              symbol={instrument.symbol}
              requestedDate={
                requestedDate && isISODate(requestedDate)
                  ? (requestedDate as ISODate)
                  : undefined
              }
            />
          </Suspense>
        </div>

        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardContent
            symbol={instrument.symbol}
            requestedDate={
              requestedDate && isISODate(requestedDate)
                ? (requestedDate as ISODate)
                : undefined
            }
            showLevels={showLevels}
            categories={categories}
          />
        </Suspense>
      </main>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <CPRCardSkeleton />
      </div>
      <Card className="hidden p-4 lg:block">
        <Skeleton className="h-40 w-full" />
      </Card>
      <Card className="lg:col-span-3">
        <TableSkeleton rows={6} />
      </Card>
    </div>
  );
}

async function DateControls({
  symbol,
  requestedDate,
}: {
  symbol: string;
  requestedDate?: ISODate;
}) {
  const fallback = await getDefaultTradingDate(symbol);
  const activeDate = requestedDate ?? fallback;
  if (!activeDate) return null;

  const nav = await getDateNavigation(symbol, activeDate);

  return (
    <DateSelector
      value={activeDate}
      minDate={nav.minDate}
      maxDate={nav.maxDate}
      previousDate={nav.previousDate}
      nextDate={nav.nextDate}
      defaultDate={nav.defaultDate ?? activeDate}
      className="w-full sm:w-auto sm:min-w-[19rem]"
    />
  );
}

async function DashboardContent({
  symbol,
  requestedDate,
  showLevels,
  categories,
}: {
  symbol: string;
  requestedDate?: ISODate;
  showLevels: boolean;
  categories: CategoryFilter;
}) {
  const instrument = getInstrument(symbol)!;
  const fallbackDate = await getDefaultTradingDate(symbol);
  const activeDate = requestedDate ?? fallbackDate;

  if (!activeDate) {
    // Distinguish a permanent provider gap from a transient outage: telling
    // someone to try again later when it can never work is simply wrong.
    const unsupported = unsupportedReason(symbol);
    return (
      <div className="mt-4">
        <CPRUnavailableCard
          instrumentName={instrument.name}
          tradingDate={todayFor(instrument)}
          error={
            unsupported ?? {
              reason: "PROVIDER_ERROR",
              message:
                "Market data temporarily unavailable. Please try again later.",
            }
          }
        />
      </div>
    );
  }

  const [{ lookup, context, today }, history] = await Promise.all([
    getCPRForDate(symbol, activeDate),
    getHistory(symbol, 10, undefined, categories),
  ]);

  return (
    <div className="mt-4 space-y-4">
      <MockDataBanner context={context} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {lookup.available ? (
            <CPRCard
              record={lookup.record}
              horizon={horizonFor(lookup.record, today)}
              instrumentNote={instrument.note}
            />
          ) : (
            <CPRUnavailableCard
              instrumentName={instrument.name}
              tradingDate={activeDate}
              error={lookup.error}
            />
          )}

        </div>

        <div className="space-y-4">
          {lookup.available ? (
            <Card>
              <CardHeader>
                <CardTitle>At a glance</CardTitle>
                <CardDescription>
                  {instrument.name} · {lookup.record.currency}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-3">
                <dl className="space-y-2.5">
                  {(
                    [
                      ["Category", classificationLabel(lookup.record.overallClassification)],
                      ["Decided by", lookup.record.classificationMethod === "POINTS" ? "Width in points" : "Width %"],
                      ["Range", `${formatPrice(lookup.record.bc)} – ${formatPrice(lookup.record.tc)}`],
                      ["Session", lookup.record.sourceDate],
                      ["Series", lookup.record.providerSymbol],
                    ] as const
                  ).map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-baseline justify-between gap-3 border-b border-line pb-2.5 last:border-0 last:pb-0"
                    >
                      <dt className="text-xs text-ink-muted">{label}</dt>
                      <dd className="numeric text-right text-sm font-medium text-ink">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          {lookup.available && showLevels ? (
            <PivotLevelsPanel
              levels={lookup.record.pivotLevels}
              pivot={lookup.record.pivot}
            />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Display options</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              <ToggleLink
                param="levels"
                checked={showLevels}
                label="Show pivot levels (R1–R5 / S1–S5)"
              />
              <p className="mt-3 text-xs leading-relaxed text-ink-muted">
                The dashboard leads with BC, Pivot, TC, width, width % and
                classification. Support and resistance levels are secondary and
                off by default. Width and width % charts are on the{" "}
                <Link href="/history" className="text-brand hover:underline">
                  Historical Data
                </Link>{" "}
                page.
              </p>
            </CardContent>
          </Card>

        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>
            {categories
              ? `${history.records.length} most recent ${categories
                  .map((c) => classificationLabel(c))
                  .join(" / ")} session${history.records.length === 1 ? "" : "s"}`
              : "Last 10 trading sessions"}
          </CardTitle>
          <CardDescription>
            {categories ? (
              <>
                Drawn from the full {retentionDays()}-day window, so these are
                the most recent matching sessions rather than the last 10
                overall.{" "}
              </>
            ) : null}
            &ldquo;CPR for&rdquo; is the session the levels apply to;
            &ldquo;source session&rdquo; is the completed day whose H/L/C produced
            them.
          </CardDescription>
          <CategoryFilterChips selected={categories} className="mt-3" />
        </CardHeader>
        {history.records.length === 0 && categories ? (
          <FilteredEmptyState totalBeforeFilter={history.totalBeforeFilter} />
        ) : (
          <CPRTable
            records={history.records}
            emptyMessage="No CPR data available for this instrument."
            className="mt-2"
          />
        )}
      </Card>

      <ProvenanceNote context={context} className="px-1 pb-2" />
    </div>
  );
}
