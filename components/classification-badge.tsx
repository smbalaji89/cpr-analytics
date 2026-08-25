import {
  basisExplanation,
  classificationLabel,
  methodLabel,
} from "@/lib/cpr/classification";
import type {
  Classification,
  ClassificationBasis,
  ClassificationMethod,
  OverallClassification,
} from "@/lib/cpr/types";
import { cn } from "@/lib/utils/cn";

/**
 * Classification badge (PRD §7, §11).
 *
 * Colours come from the theme's `--color-cls-*` tokens. The class strings are
 * static rather than interpolated so Tailwind can see them at build time.
 */

type AnyClassification = Classification | OverallClassification;

const STYLES: Record<AnyClassification, string> = {
  NARROW: "bg-cls-narrow/10 text-cls-narrow ring-cls-narrow/25",
  MIXED: "bg-cls-mixed/10 text-cls-mixed ring-cls-mixed/25",
  WIDER: "bg-cls-wider/10 text-cls-wider ring-cls-wider/25",
  UNCLASSIFIED:
    "bg-cls-unclassified/10 text-cls-unclassified ring-cls-unclassified/25",
  BELOW_RANGE:
    "bg-cls-unclassified/10 text-cls-unclassified ring-cls-unclassified/25",
  ABOVE_RANGE:
    "bg-cls-unclassified/10 text-cls-unclassified ring-cls-unclassified/25",
};

const SIZES = {
  sm: "px-2 py-0.5 text-[11px]",
  md: "px-2.5 py-1 text-xs",
  lg: "px-4 py-2 text-base sm:text-lg",
} as const;

export function ClassificationBadge({
  value,
  size = "md",
  className,
  title,
}: {
  value: AnyClassification;
  size?: keyof typeof SIZES;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-full font-semibold uppercase tracking-wide ring-1 ring-inset",
        STYLES[value] ?? STYLES.UNCLASSIFIED,
        SIZES[size],
        className,
      )}
    >
      {classificationLabel(value)}
    </span>
  );
}

/**
 * Both methods plus the resulting category, always shown together.
 *
 * The category comes from the instrument's configured method, but the OTHER
 * method is still displayed. A points threshold does not mean the same thing on
 * NIFTY as on BTC, and showing only the deciding method would let a reader
 * assume it does.
 *
 * The deciding method is marked so it is obvious which number the badge came
 * from, and a disagreement is called out rather than left for the reader to spot.
 */
export function ClassificationBreakdown({
  points,
  percentage,
  overall,
  basis,
  method,
  resolvedMethod,
  methodsAgree,
  className,
}: {
  points: Classification;
  percentage: Classification;
  overall: OverallClassification;
  basis: ClassificationBasis;
  method: ClassificationMethod;
  resolvedMethod: ClassificationMethod | null;
  methodsAgree: boolean;
  className?: string;
}) {
  const deciding = resolvedMethod ?? method;

  const cell = (
    which: ClassificationMethod,
    label: string,
    value: Classification,
  ) => {
    const isDeciding = which === deciding;
    return (
      <div
        className={cn(
          "rounded-lg border px-3 py-2",
          isDeciding
            ? "border-brand/40 bg-brand-tint"
            : "border-line bg-surface-muted",
        )}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            {label}
          </span>
          {isDeciding ? (
            <span className="rounded bg-brand px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
              decides
            </span>
          ) : null}
        </div>
        <ClassificationBadge value={value} size="sm" className="mt-1.5" />
      </div>
    );
  };

  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="grid grid-cols-2 gap-2.5">
        {cell("POINTS", "By points", points)}
        {cell("PERCENTAGE", "By percentage", percentage)}
      </div>

      <p className="text-xs leading-relaxed text-ink-muted">
        <span className="font-medium text-ink">
          {classificationLabel(overall)}
        </span>{" "}
        — {basisExplanation(basis, method, resolvedMethod)}
      </p>

      {!methodsAgree && basis !== "NONE" ? (
        <p className="text-xs leading-relaxed text-ink-muted">
          The other method ({methodLabel(deciding === "POINTS" ? "PERCENTAGE" : "POINTS")})
          would give{" "}
          <span className="font-medium text-ink">
            {classificationLabel(deciding === "POINTS" ? percentage : points)}
          </span>
          . It does not set the category for this instrument.
        </p>
      ) : null}
    </div>
  );
}
