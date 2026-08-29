"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { unlockDevice, type UnlockState } from "./actions";

const INITIAL: UnlockState = { error: null };

export function UnlockForm({ alreadyUnlocked }: { alreadyUnlocked: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(unlockDevice, INITIAL);

  // A successful unlock changes what every page renders, so the cached router
  // tree has to go — otherwise the header still shows the public nav.
  useEffect(() => {
    if (state === INITIAL) return;
    if (state.error === null) {
      router.refresh();
      router.push("/");
    }
  }, [state, router]);

  if (alreadyUnlocked) {
    return (
      <p className="text-sm text-ink-muted">
        This device already has full access.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label
          htmlFor="key"
          className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
        >
          Access key
        </label>
        <input
          id="key"
          name="key"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          className="mt-1.5 h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink focus:border-brand"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-cls-mixed">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Checking…" : "Unlock this device"}
      </Button>
    </form>
  );
}
