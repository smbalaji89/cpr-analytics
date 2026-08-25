"use server";

import { authorizeSecret } from "@/lib/api/auth";
import { INSTRUMENTS } from "@/lib/instruments";
import { runCleanup, runSync } from "@/lib/services/sync";

/**
 * Server actions behind the Settings page controls.
 *
 * Both require the same `CRON_SECRET` that protects the cron endpoints, entered
 * into the form and compared server-side with a timing-safe check. Without that
 * the page would be an unauthenticated way for anyone to burn the provider quota
 * and hammer the database.
 *
 * The secret is never sent back to the client and never stored.
 *
 * ── Why these do not call revalidatePath ───────────────────────────────────
 * `revalidatePath` makes Next re-render the settings page as part of the
 * action's response, and that page queries the database itself. A slow or
 * failing re-render then strands the submit button in its pending state even
 * though the work already succeeded — the user sees "Cleaning…" forever with no
 * way to tell whether anything happened.
 *
 * Refreshing is the client's job instead: the action returns a result, and the
 * component calls `router.refresh()` once it has one. Whether the work
 * succeeded is then independent of whether the page re-rendered.
 */

/** Never let a stuck dependency hold the UI in a pending state. */
const ACTION_TIMEOUT_MS = 45_000;

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ACTION_TIMEOUT_MS / 1000}s`)),
          ACTION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ActionState {
  ok: boolean;
  message: string;
  detail?: string[];
}

function unauthorized(message: string): ActionState {
  return { ok: false, message };
}

export async function syncNowAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const secret = String(formData.get("secret") ?? "");
  const auth = authorizeSecret(secret);
  if (!auth.authorized) return unauthorized(auth.message);

  const requested = String(formData.get("instrument") ?? "").trim();
  const symbols =
    requested && requested !== "ALL"
      ? [requested]
      : INSTRUMENTS.map((i) => i.symbol);

  try {
    const result = await withTimeout(runSync({ symbols }), "Sync");
    const failed = result.instruments.filter((i) => !i.ok);

    const detail = result.instruments.map((i) =>
      i.ok
        ? `${i.symbol}: ${i.written} row(s)${i.providerSymbol ? ` from ${i.providerSymbol}` : ""}${i.reconciledAway ? `, ${i.reconciledAway} stale removed` : ""}${i.skipped.length ? `, ${i.skipped.length} session(s) skipped` : ""}`
        : `${i.symbol}: FAILED — ${i.error}`,
    );

    return {
      ok: failed.length === 0,
      message:
        failed.length === 0
          ? `Synced ${result.instruments.length} instrument(s) in ${(result.durationMs / 1000).toFixed(1)}s — ${result.totalWritten} row(s) written.`
          : `${failed.length} of ${result.instruments.length} instrument(s) failed.`,
      detail,
    };
  } catch (error) {
    return {
      ok: false,
      message: "Sync failed.",
      detail: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function cleanupNowAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const secret = String(formData.get("secret") ?? "");
  const auth = authorizeSecret(secret);
  if (!auth.authorized) return unauthorized(auth.message);

  try {
    const deleted = await withTimeout(runCleanup(), "Cleanup");
    return {
      ok: true,
      message: `Retention cleanup complete — ${deleted} row(s) removed.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: "Cleanup failed.",
      detail: [error instanceof Error ? error.message : String(error)],
    };
  }
}
