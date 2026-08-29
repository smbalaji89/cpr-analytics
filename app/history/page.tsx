import type { Metadata } from "next";
import { Suspense } from "react";
import {
  CategoryFilterChips,
  FilteredEmptyState,
} from "@/components/category-filter";
import { CPRCard, CPRUnavailableCard } from "@/components/cpr-card";
import { CPRChart } from "@/components/cpr-chart";
import { CPRTable } from "@/components/cpr-table";
import { MockDataBanner, ProvenanceNote } from "@/components/data-notice";
import { DateSelector } from "@/components/date-selector";
import { InstrumentSelector } from "@/components/instrument-selector";
import { SiteHeader } from "@/components/site-header";
import { isPrivileged } from "@/lib/auth/access";
import { redactContext, redactRecords, redactRecordIf } from "@/lib/cpr/redact";
import { noteFor } from "@/lib/instruments";
import { WindowSelector } from "@/components/window-selector";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { COMPARISON_WINDOWS } from "@/lib/api/validation";
import { parseCategoryFilter, type CategoryFilter } from "@/lib/cpr/filter";
import { DEFAULT_INSTRUMENT_SYMBOL, getInstrument } from "@/lib/instruments";
import {
  getCPRForDate,
  getDateNavigation,
  getDefaultTradingDate,
  getRangeSeries,
  horizonFor,
  todayFor,
  unsupportedReason,
} from "@/lib/services/cpr-service";
import { retentionCutoff, retentionDays } from "@/lib/services/retention";
import { addDays, isISODate, type ISODate } from "@/lib/utils/date";

export const metadata: Metadata = { title: "Historical Data" };
export const dynamic = "force-dynamic";

/**
 * Historical data (PRD §12, §13, §15).
 *
 * Pick any date inside the retention window and see the CPR that applied to it,
 * the previous session's H/L/C that produced it, and the width / width % series
 * over a selectable window.
 */

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

export default async function HistoryPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const symbol = (
    getInstrument(
      (
        firstParam(params, "instrument") ?? DEFAULT_INSTRUMENT_SYMBOL
      ).toUpperCase(),
    ) ?? getInstrument(DEFAULT_INSTRUMENT_SYMBOL)!
  ).symbol;

  const rawDate = firstParam(params, "date");
  const requestedDate =
    rawDate && isISODate(rawDate) ? (rawDate as ISODate) : undefined;

  const rawDays = Number(firstParam(params, "days"));
  const days = (COMPARISON_WINDOWS as readonly number[]).includes(rawDays)
    ? rawDays
    : 30;

  const categories = parseCategoryFilter(firstParam(params, "category"));

  const query = new URLSearchParams({ instrument: symbol });
  if (requestedDate) query.set("date", requestedDate);
  const categoryValue = firstParam(params, "category");
  if (categories && categoryValue) query.set("category", categoryValue);

  return (
    <div className="min-h-dvh bg-surface-muted">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
        <div className="mb-5 sm:mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            Historical Data
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Any trading date within the last {retentionDays()} days.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <InstrumentSelector value={symbol} className="w-full sm:w-64" />
          <Suspense fallback={<div className="h-11" />}>
            <HistoryDateControls
              symbol={symbol}
              requestedDate={requestedDate}
            />
          </Suspense>
        </div>

        <Suspense
          fallback={
            <div className="mt-5 space-y-5">
              <Card>
                <ChartSkeleton />
              </Card>
              <Card>
                <TableSkeleton />
              </Card>
            </div>
          }
        >
          <HistoryContent
            symbol={symbol}
            requestedDate={requestedDate}
            days={days}
            categories={categories}
            baseQuery={query.toString()}
          />
        </Suspense>
      </main>
    </div>
  );
}

async function HistoryDateControls({
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

async function HistoryContent({
  symbol,
  requestedDate,
  days,
  categories,
  baseQuery,
}: {
  symbol: string;
  requestedDate?: ISODate;
  days: number;
  categories: CategoryFilter;
  baseQuery: string;
}) {
  const instrument = getInstrument(symbol)!;
  const fallbackDate = await getDefaultTradingDate(symbol);
  const activeDate = requestedDate ?? fallbackDate;

  if (!activeDate) {
    // Distinguish a permanent provider gap from a transient outage: telling
    // someone to try again later when it can never work is simply wrong.
    const unsupported = unsupportedReason(symbol, await isPrivileged());
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

  const today = todayFor(instrument);
  // Clamp the window start to the retention floor so a "Last 90" request can
  // never ask for a date the API is required to reject.
  const start = [addDays(today, -days), retentionCutoff(today)]
    .sort()
    .reverse()[0];

  const [{ lookup, context }, range, privileged] = await Promise.all([
    getCPRForDate(symbol, activeDate),
    getRangeSeries(symbol, start, today, categories),
    isPrivileged(),
  ]);

  // Redact before the charts and table receive them — those are client
  // components, so their props are serialised into the page source.
  const records = redactRecords(range.records, privileged);
  const publicContext = redactContext(context, privileged);

  const buildHref = (value: number) => `/history?${baseQuery}&days=${value}`;

  return (
    <div className="mt-5 space-y-5">
      <MockDataBanner context={context} />

      <div className="grid gap-5 lg:grid-cols-2">
        {lookup.available ? (
          <CPRCard
            record={redactRecordIf(lookup.record, privileged)}
            horizon={horizonFor(lookup.record, today)}
            instrumentNote={noteFor(instrument, privileged)}
          />
        ) : (
          <CPRUnavailableCard
            instrumentName={instrument.name}
            tradingDate={activeDate}
            error={lookup.error}
            suggestedHref={
              lookup.error.suggestedDate
                ? `/history?instrument=${symbol}&date=${lookup.error.suggestedDate}`
                : undefined
            }
          />
        )}

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>CPR width</CardTitle>
              <CardDescription>
                Points, {range.records.length} sessions.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-3">
              <CPRChart records={records} metric="width" height={200} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>CPR width %</CardTitle>
              <CardDescription>
                Percentage of pivot, {range.records.length} sessions.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-3">
              <CPRChart
                records={records}
                metric="widthPercent"
                height={200}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{instrument.name} — CPR history</CardTitle>
              <CardDescription>
                {range.records.length}
                {categories ? ` of ${range.totalBeforeFilter}` : ""} sessions
                from {start} to {today}.
              </CardDescription>
            </div>
            <WindowSelector current={days} buildHref={buildHref} />
          </div>
          <CategoryFilterChips selected={categories} className="mt-3" />
        </CardHeader>
        {range.records.length === 0 && categories ? (
          <FilteredEmptyState totalBeforeFilter={range.totalBeforeFilter} />
        ) : (
          <CPRTable
            records={records}
            emptyMessage="No CPR data available for this range."
            className="mt-2"
          />
        )}
      </Card>

      <ProvenanceNote context={publicContext} className="px-1 pb-2" />
    </div>
  );
}
