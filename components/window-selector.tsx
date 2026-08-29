import Link from "next/link";
import { COMPARISON_WINDOWS } from "@/lib/api/validation";
import { cn } from "@/lib/utils/cn";

/**
 * Comparison window selector (PRD §15) — Last 5 / 10 / 20 / 30 / 60 / 90 days.
 *
 * Plain links rather than a client component: each option is a distinct URL, so
 * it is shareable, crawlable and works without JavaScript.
 */
export function WindowSelector({
  current,
  buildHref,
  className,
}: {
  current: number;
  buildHref: (days: number) => string;
  className?: string;
}) {
  return (
    <nav aria-label="Comparison window" className={cn("scroll-x", className)}>
      <ul className="flex items-center gap-1.5">
        {COMPARISON_WINDOWS.map((days) => {
          const active = days === current;
          return (
            <li key={days}>
              <Link
                href={buildHref(days)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "inline-flex h-9 items-center whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors",
                  active
                    ? "border-brand bg-brand text-on-brand"
                    : "border-line bg-surface-raised text-ink-muted hover:bg-brand-tint hover:text-brand",
                )}
              >
                Last {days}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
