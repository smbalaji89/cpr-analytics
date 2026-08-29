"use client";

import { Check, ListFilter } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { classificationLabel } from "@/lib/cpr/classification";
import {
  FILTERABLE_CATEGORIES,
  type FilterableCategory,
} from "@/lib/cpr/filter";
import { cn } from "@/lib/utils/cn";

/**
 * CPR category filter.
 *
 * Multi-select chips. State lives in the `category` query param so the filtered
 * view is shareable and the server renders it directly — the table never flashes
 * unfiltered content before the filter applies.
 *
 * Selecting every category is equivalent to selecting none, so the component
 * clears the param in that case rather than encoding a no-op filter.
 */

const CHIP_STYLES: Record<FilterableCategory, string> = {
  NARROW:
    "data-[on=true]:border-cls-narrow data-[on=true]:bg-cls-narrow/10 data-[on=true]:text-cls-narrow",
  MIXED:
    "data-[on=true]:border-cls-mixed data-[on=true]:bg-cls-mixed/10 data-[on=true]:text-cls-mixed",
  WIDER:
    "data-[on=true]:border-cls-wider data-[on=true]:bg-cls-wider/10 data-[on=true]:text-cls-wider",
  UNCLASSIFIED:
    "data-[on=true]:border-cls-unclassified data-[on=true]:bg-cls-unclassified/10 data-[on=true]:text-cls-unclassified",
};

export function CategoryFilterChips({
  selected,
  className,
  label = "CPR category",
}: {
  /** `null` means no filter — every chip renders unselected. */
  selected: FilterableCategory[] | null;
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const active = new Set(selected ?? []);

  function apply(next: FilterableCategory[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.length === 0 || next.length === FILTERABLE_CATEGORIES.length) {
      params.delete("category");
    } else {
      params.set("category", next.join(","));
    }
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function toggle(category: FilterableCategory) {
    const next = new Set(active);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    // Preserve the canonical display order rather than click order.
    apply(FILTERABLE_CATEGORIES.filter((c) => next.has(c)));
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        isPending && "opacity-60",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 eyebrow text-ink-muted">
        <ListFilter className="h-3.5 w-3.5" aria-hidden />
        {label}
      </span>

      <div
        role="group"
        aria-label="Filter by CPR category"
        className="flex flex-wrap items-center gap-1.5"
      >
        <button
          type="button"
          onClick={() => apply([])}
          aria-pressed={selected === null}
          data-on={selected === null}
          className={cn(
            "inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-surface-raised px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-brand-tint",
            "data-[on=true]:border-brand data-[on=true]:bg-brand data-[on=true]:text-white",
          )}
        >
          All
        </button>

        {FILTERABLE_CATEGORIES.map((category) => {
          const on = active.has(category);
          return (
            <button
              key={category}
              type="button"
              onClick={() => toggle(category)}
              aria-pressed={on}
              data-on={on}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-surface-raised px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-brand-tint",
                CHIP_STYLES[category],
              )}
            >
              {on ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <span
                  aria-hidden
                  className={cn(
                    "inline-block h-2 w-2 rounded-full",
                    category === "NARROW" && "bg-cls-narrow",
                    category === "MIXED" && "bg-cls-mixed",
                    category === "WIDER" && "bg-cls-wider",
                    category === "UNCLASSIFIED" && "bg-cls-unclassified",
                  )}
                />
              )}
              {classificationLabel(category)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Message shown when a filter hides everything.
 *
 * States the filter is the reason and how many rows exist without it, so an
 * empty table is never mistaken for missing data (PRD §29).
 */
export function FilteredEmptyState({
  totalBeforeFilter,
  noun = "sessions",
}: {
  totalBeforeFilter: number;
  noun?: string;
}) {
  return (
    <p className="px-4 py-8 text-center text-sm text-ink-muted">
      No {noun} match the selected CPR category.
      {totalBeforeFilter > 0 ? (
        <>
          {" "}
          <span className="text-ink">{totalBeforeFilter}</span> {noun} are
          available without the filter.
        </>
      ) : null}
    </p>
  );
}
