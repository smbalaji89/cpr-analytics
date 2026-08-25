"use server";

import { revalidatePath } from "next/cache";
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
 */

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
    const result = await runSync({ symbols });
    const failed = result.instruments.filter((i) => !i.ok);

    const detail = result.instruments.map((i) =>
      i.ok
        ? `${i.symbol}: ${i.written} row(s)${i.providerSymbol ? ` from ${i.providerSymbol}` : ""}${i.reconciledAway ? `, ${i.reconciledAway} stale removed` : ""}${i.skipped.length ? `, ${i.skipped.length} session(s) skipped` : ""}`
        : `${i.symbol}: FAILED — ${i.error}`,
    );

    revalidatePath("/settings");
    revalidatePath("/");

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
    const deleted = await runCleanup();
    revalidatePath("/settings");
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
