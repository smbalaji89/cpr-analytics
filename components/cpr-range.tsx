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
 *
 * ── Why the connector is a flex rail, not an absolute band ─────────────────
 * An absolutely-positioned band has to guess where the first and last rows
 * land, and any padding change silently misaligns it. Here the rail is a real
 * grid column: the line runs between the first and last markers by
 * construction, so it cannot drift.
 */

interface LevelProps {
  label: string;
  value: number;
  tone: "edge" | "pivot";
  position: "top" | "middle" | "bottom";
}

function Level({ label, value, tone, position }: LevelProps) {
  const isPivot = tone === "pivot";
  return (
    <div
      className={cn(
        "relative grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3",
        // Even row heights keep the ladder schematic rather than implying scale.
        "py-3 sm:py-3.5",
        isPivot && "rounded-lg bg-brand/[0.08]",
      )}
    >
      {/* Rail: a continuous line through all three rows, capped at the ends. */}
      <span aria-hidden className="relative flex h-full w-3 justify-center">
        <span
          className={cn(
            "absolute w-px bg-brand/30",
            position === "top" && "top-1/2 bottom-0",
            position === "middle" && "inset-y-0",
            position === "bottom" && "top-0 bottom-1/2",
          )}
        />
        <span
          className={cn(
            "relative z-10 self-center rounded-full ring-2 ring-surface-raised",
            isPivot ? "h-2.5 w-2.5 bg-brand" : "h-2 w-2 bg-brand/45",
          )}
        />
      </span>

      <span
        className={cn("eyebrow", isPivot ? "text-ink" : "text-ink-muted")}
      >
        {label}
      </span>

      <span
        className={cn(
          "display-figure",
          isPivot
            ? "text-2xl font-semibold text-ink sm:text-3xl"
            : "text-xl font-medium text-ink-secondary sm:text-2xl",
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
        // `justify-center` absorbs any extra height from a taller neighbour
        // instead of leaving a gap below the last row.
        "flex h-full flex-col justify-center rounded-xl border border-line bg-surface-raised p-1.5",
        className,
      )}
    >
      <Level label="TC" value={tc} tone="edge" position="top" />
      <Level label="Pivot" value={pivot} tone="pivot" position="middle" />
      <Level label="BC" value={bc} tone="edge" position="bottom" />
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
        "flex flex-col justify-center rounded-xl border border-line bg-surface-raised px-4 py-4 sm:px-5 sm:py-5",
        className,
      )}
    >
      <div className="eyebrow text-ink-muted">{label}</div>
      <div
        className={cn(
          "display-figure mt-1.5 font-semibold text-ink",
          emphasis
            ? "text-[2.125rem] sm:text-[2.75rem]"
            : "text-2xl sm:text-[1.75rem]",
        )}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-1.5 text-xs text-ink-muted">{hint}</div>
      ) : null}
    </div>
  );
}
