"use client";

import { AlertTriangle, CheckCircle2, Database, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import {
  cleanupNowAction,
  syncNowAction,
  type ActionState,
} from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { INSTRUMENTS } from "@/lib/instruments";
import { cn } from "@/lib/utils/cn";

/**
 * Sync / cleanup controls (PRD §33).
 *
 * The admin secret is typed per action rather than stored: this page is public,
 * so it must not become an unauthenticated trigger for provider traffic and
 * database writes. The field is a password input and the value is never echoed
 * back by the server action.
 */

function Result({ state }: { state: ActionState | null }) {
  if (!state) return null;
  return (
    <div
      role="status"
      className={cn(
        "mt-3 rounded-lg border px-3 py-2 text-xs",
        state.ok
          ? "border-cls-narrow/40 bg-cls-narrow/10"
          : "border-cls-conflicting/40 bg-cls-conflicting/10",
      )}
    >
      <p className="flex items-start gap-2 font-medium text-ink">
        {state.ok ? (
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cls-narrow" aria-hidden />
        ) : (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cls-conflicting" aria-hidden />
        )}
        {state.message}
      </p>
      {state.detail?.length ? (
        <ul className="mt-1.5 space-y-0.5 pl-5 text-ink-muted">
          {state.detail.map((line) => (
            <li key={line} className="numeric">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AdminPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [syncState, syncFormAction, syncPending] = useActionState<
    ActionState | null,
    FormData
  >(syncNowAction, null);
  const [cleanupState, cleanupFormAction, cleanupPending] = useActionState<
    ActionState | null,
    FormData
  >(cleanupNowAction, null);

  // Pull fresh stored-history figures once an action reports success. Doing
  // this here rather than via revalidatePath keeps the button's pending state
  // tied to the action alone, so a slow page re-render cannot strand it.
  useEffect(() => {
    if (syncState?.ok || cleanupState?.ok) router.refresh();
  }, [syncState, cleanupState, router]);

  if (!enabled) {
    return (
      <p className="text-xs leading-relaxed text-ink-muted">
        Set <code className="rounded bg-surface-muted px-1 py-0.5">CRON_SECRET</code>{" "}
        to enable manual sync and cleanup. Without it these actions fail closed,
        so the page cannot be used to trigger provider traffic.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <form action={syncFormAction} className="space-y-2.5">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Instrument
            </span>
            <select
              name="instrument"
              defaultValue="ALL"
              className="mt-1 h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink"
            >
              <option value="ALL">All instruments</option>
              {INSTRUMENTS.map((i) => (
                <option key={i.symbol} value={i.symbol}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Admin secret
            </span>
            <input
              type="password"
              name="secret"
              autoComplete="off"
              placeholder="CRON_SECRET"
              className="mt-1 h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink"
            />
          </label>
        </div>

        <Button type="submit" variant="primary" disabled={syncPending}>
          <RefreshCw
            className={cn("h-4 w-4", syncPending && "animate-spin")}
            aria-hidden
          />
          {syncPending ? "Syncing…" : "Sync now"}
        </Button>
        <p className="text-xs leading-relaxed text-ink-muted">
          Fetches the full retention window, recomputes every CPR and upserts it.
          Safe to run repeatedly — the unique constraint makes it idempotent.
        </p>
        <Result state={syncState} />
      </form>

      <form
        action={cleanupFormAction}
        className="space-y-2.5 border-t border-line pt-5"
      >
        <label className="block sm:max-w-xs">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Admin secret
          </span>
          <input
            type="password"
            name="secret"
            autoComplete="off"
            placeholder="CRON_SECRET"
            className="mt-1 h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink"
          />
        </label>
        <Button type="submit" variant="outline" disabled={cleanupPending}>
          <Trash2 className="h-4 w-4" aria-hidden />
          {cleanupPending ? "Cleaning…" : "Run retention cleanup"}
        </Button>
        <Result state={cleanupState} />
      </form>
    </div>
  );
}

/** Per-instrument stored coverage. */
export function CoverageTable({
  coverage,
  retentionDays,
}: {
  coverage: {
    symbol: string;
    name: string;
    rows: number;
    oldest: string | null;
    newest: string | null;
    providerSymbol: string | null;
  }[];
  retentionDays: number;
}) {
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            {["Instrument", "Rows", "Oldest", "Newest", "Series"].map((h) => (
              <th
                key={h}
                scope="col"
                className="px-2 py-2 eyebrow text-ink-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {coverage.map((row) => (
            <tr key={row.symbol} className="border-b border-line last:border-0">
              <td className="px-2 py-2 font-medium text-ink">{row.name}</td>
              <td className="numeric px-2 py-2">
                {row.rows === 0 ? (
                  <span className="text-ink-muted">not stored yet</span>
                ) : (
                  <span className="text-ink">{row.rows}</span>
                )}
              </td>
              <td className="numeric px-2 py-2 text-ink-muted">
                {row.oldest ?? "—"}
              </td>
              <td className="numeric px-2 py-2 text-ink-muted">
                {row.newest ?? "—"}
              </td>
              <td className="numeric px-2 py-2 text-xs text-ink-muted">
                {row.providerSymbol ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
        <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          A newly added instrument stores its full {retentionDays}-day history
          automatically the first time it is viewed or synced — the provider
          window and the retention window are the same, so one pass backfills it.
        </span>
      </p>
    </div>
  );
}
