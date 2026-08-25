import { cn } from "@/lib/utils/cn";
import { formatPrice } from "@/lib/utils/format";

/**
 * The Central Pivot Range, drawn as a range.
 *
 * TC above, Pivot in the middle, BC below — the spatial arrangement traders
 * actually read these levels in. Three boxes side by side lose that entirely:
 * the whole point of a *range* is that it has a top and a bottom.
 *
 * ── Deliberately schematic, not to scale ───────────────────────────────────
 * A real CPR is a hairline against the price: 6.40 points on a 24,225 pivot is
 * 0.026 %. Drawn proportionally the band would be invisible, and stretching it
 * to fill the panel would misrepresent how wide the range is. So the rows are
 * evenly spaced and the width is stated numerically beside it, where it can be
 * read exactly.
 */

function Level({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "edge" | "pivot";
}) {
  const isPivot = tone === "pivot";
  return (
    <div className="relative flex items-center justify-between gap-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            "block rounded-full",
            isPivot ? "h-3.5 w-1 bg-brand" : "h-2 w-1 bg-ink-muted/50",
          )}
        />
        <span
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wider",
            isPivot ? "text-brand" : "text-ink-muted",
          )}
        >
          {label}
        </span>
      </div>
      <span
        className={cn(
          "numeric tabular-nums",
          isPivot
            ? "text-xl font-semibold text-brand sm:text-2xl"
            : "text-lg font-medium text-ink sm:text-xl",
        )}
      >
        {formatPrice(value)}
      </span>
    </div>
  );
}

export function CPRRange({
  bc,
  pivot,
  tc,
  className,
}: {
  bc: number;
  pivot: number;
  tc: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-line bg-surface-raised px-4 py-1",
        className,
      )}
    >
      {/* The band between the two edges, tinted to read as one continuous range. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[18%] bottom-[18%] bg-gradient-to-b from-brand/[0.07] via-brand/[0.12] to-brand/[0.07]"
      />
      <div className="relative divide-y divide-line/70">
        <Level label="TC" value={tc} tone="edge" />
        <Level label="Pivot" value={pivot} tone="pivot" />
        <Level label="BC" value={bc} tone="edge" />
      </div>
    </div>
  );
}

/** A single headline figure. */
export function Stat({
  label,
  value,
  hint,
  emphasis,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-surface-raised px-4 py-3.5",
        className,
      )}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div
        className={cn(
          "numeric mt-1 font-semibold text-ink",
          emphasis ? "text-2xl sm:text-3xl" : "text-lg sm:text-xl",
        )}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-[11px] text-ink-muted">{hint}</div>
      ) : null}
    </div>
  );
}
