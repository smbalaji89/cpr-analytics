"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Route-level error boundary (PRD §27) — a reason and a retry, never zeros. */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] unhandled route error", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-surface-raised p-6 text-center shadow-sm">
        <AlertTriangle
          className="mx-auto h-8 w-8 text-cls-mixed"
          aria-hidden
        />
        <h1 className="mt-3 text-base font-semibold text-ink">
          Market data temporarily unavailable.
        </h1>
        <p className="mt-1 text-sm text-ink-muted">Please try again later.</p>
        <Button onClick={reset} variant="primary" className="mt-5 w-full">
          Try again
        </Button>
      </div>
    </div>
  );
}
