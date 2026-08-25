import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-surface-raised p-6 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">
          404
        </p>
        <h1 className="mt-2 text-base font-semibold text-ink">
          Page not found
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          That page does not exist.
        </p>
        <Button asChild variant="primary" className="mt-5 w-full">
          <Link href="/">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
