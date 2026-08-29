import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { AdminPanel, CoverageTable } from "@/components/admin-panel";
import { SiteHeader } from "@/components/site-header";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PERCENT_BANDS, POINTS_BANDS } from "@/lib/cpr/classification";
import { INSTRUMENTS } from "@/lib/instruments";
import {
  getMarketDataProvider,
  getProviderForInstrument,
} from "@/lib/market-data";
import { getDatabaseStatus } from "@/lib/services/db-status";
import { retentionDays } from "@/lib/services/retention";
import { hasEnv } from "@/lib/utils/env";
import { isPrivileged } from "@/lib/auth/access";
import { LockDeviceButton } from "@/components/lock-device-button";

/**
 * The gate runs during metadata generation, not in the component.
 *
 * `notFound()` thrown from the component body lands after the response has
 * already been committed with the static `metadata` export, so the page
 * renders the not-found UI but with a 200 — which still tells a prober the
 * route exists. Deciding here happens before anything is sent, so the response
 * is a real 404.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (!(await isPrivileged())) notFound();
  return { title: "Settings" };
}
export const dynamic = "force-dynamic";

/**
 * Settings and system status (PRD §4).
 *
 * Read-only status plus the appearance toggle. Deliberately exposes NO secret
 * values — only whether each piece is configured, never the connection string,
 * the API key or the cron secret (PRD §32).
 */

function StatusRow({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      {ok ? (
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0 text-cls-narrow"
          aria-hidden
        />
      ) : (
        <XCircle
          className="mt-0.5 h-4 w-4 shrink-0 text-cls-unclassified"
          aria-hidden
        />
      )}
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-ink-muted">
          {detail}
        </div>
      </div>
    </li>
  );
}

export default async function SettingsPage() {
  // Belt and braces: generateMetadata already 404s an unprivileged request,
  // but the component must never depend on that having run.
  if (!(await isPrivileged())) notFound();

  const dbStatus = await getDatabaseStatus();

  let providerLabel = "Not configured";
  let providerIsMock = false;
  let providerError: string | null = null;
  try {
    const provider = getMarketDataProvider();
    providerLabel = provider.label;
    providerIsMock = provider.isMock;
  } catch (error) {
    providerError = error instanceof Error ? error.message : String(error);
  }

  /**
   * Which provider each instrument actually resolves to.
   *
   * Naming the configured default alone was wrong here for the same reason it
   * was wrong in the page footer: instruments route by `preferredProvider`, so
   * most of the Indian ones come from Upstox while the default is still Yahoo.
   */
  const routing = new Map<string, string[]>();
  for (const instrument of INSTRUMENTS) {
    try {
      const id = getProviderForInstrument(instrument).label;
      routing.set(id, [...(routing.get(id) ?? []), instrument.shortName]);
    } catch {
      routing.set("Not configured", [
        ...(routing.get("Not configured") ?? []),
        instrument.shortName,
      ]);
    }
  }

  const pointsInstruments = INSTRUMENTS.filter(
    (i) => i.classificationMethod === "POINTS",
  ).map((i) => i.name);
  const percentCount = INSTRUMENTS.length - pointsInstruments.length;

  const cronConfigured = hasEnv("CRON_SECRET");

  return (
    <div className="min-h-dvh bg-surface-muted">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-5 sm:px-6 sm:py-8">
        <div className="mb-5 sm:mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            Settings
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Appearance and system status.
          </p>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>This device</CardTitle>
              <CardDescription>
                Full access is stored in a cookie on this device only. Locking
                it returns this browser to the public view; other devices are
                unaffected. To revoke every device at once, rotate
                ADMIN_ACCESS_KEY.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-3">
              <LockDeviceButton />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Your choice is stored in this browser only.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between pt-3">
              <span className="text-sm text-ink">Light / dark theme</span>
              <ThemeToggle />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>System status</CardTitle>
              <CardDescription>
                No secret values are shown here — only whether each is set.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-1">
              <ul className="divide-y divide-line">
                <StatusRow
                  label="Market data"
                  ok={!providerError && !providerIsMock}
                  detail={
                    providerError ? (
                      providerError
                    ) : providerIsMock ? (
                      `${providerLabel} — SYNTHETIC data. Set MARKET_DATA_PROVIDER=yahoo for real prices.`
                    ) : (
                      <ul className="space-y-0.5">
                        {[...routing.entries()].map(([label, symbols]) => (
                          <li key={label}>
                            <span className="font-medium text-ink">
                              {label}
                            </span>
                            {" — "}
                            {symbols.join(", ")}
                          </li>
                        ))}
                      </ul>
                    )
                  }
                />
                <StatusRow
                  label="Database"
                  ok={dbStatus.configured && dbStatus.reachable !== false}
                  detail={
                    !dbStatus.configured
                      ? "DATABASE_URL is not set. The app computes every CPR live from the provider — fully functional, but history is limited to the provider's window and nothing is cached between deployments."
                      : dbStatus.reachable === false
                        ? `Configured but unreachable: ${dbStatus.error}`
                        : `Connected — ${dbStatus.totalRows} row(s) stored across ${dbStatus.coverage.filter((c) => c.rows > 0).length} instrument(s).`
                  }
                />
                <StatusRow
                  label="Scheduled sync & cleanup"
                  ok={cronConfigured}
                  detail={
                    cronConfigured
                      ? "CRON_SECRET is set. /api/cron/sync and /api/cron/cleanup are protected and callable by Vercel Cron."
                      : "CRON_SECRET is not set, so the cron and admin endpoints are disabled (they fail closed rather than run unprotected)."
                  }
                />
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stored history</CardTitle>
              <CardDescription>
                What each instrument holds in the database. {retentionDays()}{" "}
                days are kept; a scheduled job removes anything older each day,
                and the date picker will not go outside that window.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-3">
              {!dbStatus.configured ? (
                <div className="space-y-2 text-xs leading-relaxed text-ink-muted">
                  <p className="text-sm font-medium text-ink">
                    No database connected.
                  </p>
                  <p>
                    Every CPR is computed live and nothing is stored. The app is
                    fully correct this way — storage adds caching across
                    deployments and history beyond the provider&rsquo;s window.
                  </p>
                  <p>
                    Set{" "}
                    <code className="rounded bg-surface-muted px-1 py-0.5">
                      DATABASE_URL
                    </code>
                    , run{" "}
                    <code className="rounded bg-surface-muted px-1 py-0.5">
                      npm run db:migrate
                    </code>
                    , then verify with{" "}
                    <code className="rounded bg-surface-muted px-1 py-0.5">
                      npm run db:check
                    </code>
                    .
                  </p>
                </div>
              ) : dbStatus.reachable === false ? (
                <p className="text-xs leading-relaxed text-ink-muted">
                  <span className="font-medium text-ink">
                    Configured but unreachable.
                  </span>{" "}
                  {dbStatus.error}
                </p>
              ) : (
                <CoverageTable
                  coverage={dbStatus.coverage}
                  retentionDays={dbStatus.retentionDays}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Data synchronisation</CardTitle>
              <CardDescription>
                Runs the same pipeline as the nightly cron job.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-3">
              <AdminPanel enabled={cronConfigured} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Classification thresholds</CardTitle>
              <CardDescription>
                Both methods run on every session and both are always reported;
                which one <em>decides</em> the category depends on the
                instrument.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    By width (points)
                  </h3>
                  <p className="mt-1 text-xs text-ink-muted">
                    Decides: {pointsInstruments.join(", ")}
                  </p>
                  <ul className="numeric mt-2 space-y-1 text-sm text-ink">
                    <li>
                      {POINTS_BANDS.min}–{POINTS_BANDS.narrowMax} · Narrow
                    </li>
                    <li>
                      {POINTS_BANDS.narrowMax + 1}–{POINTS_BANDS.mixedMax} ·
                      Mixed
                    </li>
                    <li>
                      {POINTS_BANDS.mixedMax + 1}–{POINTS_BANDS.widerMax} ·
                      Wider
                    </li>
                    <li className="text-ink-muted">
                      outside · reported out of range
                    </li>
                  </ul>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    By width %
                  </h3>
                  <p className="mt-1 text-xs text-ink-muted">
                    Decides: every other instrument ({percentCount} of{" "}
                    {INSTRUMENTS.length})
                  </p>
                  <ul className="numeric mt-2 space-y-1 text-sm text-ink">
                    <li>
                      {PERCENT_BANDS.min}–{PERCENT_BANDS.narrowMax}% · Narrow
                    </li>
                    <li>
                      {PERCENT_BANDS.narrowMax}–{PERCENT_BANDS.widerMin}% ·
                      Mixed
                    </li>
                    <li>≥ {PERCENT_BANDS.widerMin}% · Wider</li>
                    <li className="text-ink-muted">
                      below {PERCENT_BANDS.min}% · reported out of range
                    </li>
                  </ul>
                </div>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-ink-muted">
                The points bands were calibrated for a NIFTY-scale index and do
                not transfer — Crude Oil near 85 produces a CPR under one point,
                below the scale entirely, while Bitcoin routinely exceeds 200.
                Width % divides by the pivot, so it holds at any price scale.
                When the two disagree the result is reported as MIXED /
                CONFLICTING rather than one being chosen silently.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
