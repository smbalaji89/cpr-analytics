import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PivotLevels } from "@/lib/cpr/types";
import { cn } from "@/lib/utils/cn";
import { formatPrice } from "@/lib/utils/format";

/**
 * R1–R5 / S1–S5 ladder (PRD §14).
 *
 * Secondary to BC/P/TC by design — the dashboard leads with the Central Pivot
 * Range and this is opt-in via the "Show pivot levels" toggle.
 *
 * Rendered as a single ladder ordered R5 down to S5 with the pivot in place,
 * because that is the spatial arrangement traders read these levels in; two
 * separate lists would lose the ordering that gives them meaning.
 */
export function PivotLevelsPanel({
  levels,
  pivot,
  className,
}: {
  levels: PivotLevels;
  pivot: number;
  className?: string;
}) {
  const rows: { label: string; value: number; kind: "r" | "p" | "s" }[] = [
    { label: "R5", value: levels.r5, kind: "r" },
    { label: "R4", value: levels.r4, kind: "r" },
    { label: "R3", value: levels.r3, kind: "r" },
    { label: "R2", value: levels.r2, kind: "r" },
    { label: "R1", value: levels.r1, kind: "r" },
    { label: "Pivot", value: pivot, kind: "p" },
    { label: "S1", value: levels.s1, kind: "s" },
    { label: "S2", value: levels.s2, kind: "s" },
    { label: "S3", value: levels.s3, kind: "s" },
    { label: "S4", value: levels.s4, kind: "s" },
    { label: "S5", value: levels.s5, kind: "s" },
  ];

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Pivot levels</CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li
              key={row.label}
              className={cn(
                "flex items-center justify-between gap-4 px-1 py-2",
                row.kind === "p" && "bg-brand-tint",
              )}
            >
              <span
                className={cn(
                  "text-xs font-semibold uppercase tracking-wide",
                  row.kind === "p" ? "text-brand" : "text-ink-muted",
                )}
              >
                {row.label}
              </span>
              <span
                className={cn(
                  "numeric text-sm font-medium",
                  row.kind === "p" ? "text-brand" : "text-ink",
                )}
              >
                {formatPrice(row.value)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
