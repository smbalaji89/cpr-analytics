"use client";

import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import {
  instrumentsByCategory,
  type Instrument,
} from "@/lib/instruments";
import { cn } from "@/lib/utils/cn";

/**
 * Instrument selector (PRD §5).
 *
 * Selection lives in the URL so a view is shareable and the back button works.
 * Changing it navigates, and the server re-renders with the new data.
 *
 * The trading DATE is intentionally dropped on change: instruments have
 * different calendars, so carrying a NIFTY date onto a COMEX instrument can
 * land on a non-session. Clearing it re-resolves that instrument's own default.
 */
export function InstrumentSelector({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const groups = instrumentsByCategory();
  const selected: Instrument | undefined = groups
    .flatMap((g) => g.instruments)
    .find((i) => i.symbol === value);

  function onChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("instrument", next);
    params.delete("date");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger
        aria-label="Select instrument"
        className={cn(
          "inline-flex h-11 min-w-0 items-center justify-between gap-2 rounded-lg border border-line bg-surface-raised px-3 text-sm font-medium text-ink transition-colors hover:bg-brand-tint data-[state=open]:border-brand",
          isPending && "opacity-60",
          className,
        )}
      >
        <span className="truncate">
          <Select.Value placeholder="Select instrument" />
        </span>
        <Select.Icon>
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-[70vh] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-surface-raised shadow-lg"
        >
          <Select.Viewport className="p-1">
            {groups.map((group, index) => (
              <Select.Group key={group.category}>
                {index > 0 ? (
                  <div className="my-1 h-px bg-line" role="presentation" />
                ) : null}
                <Select.Label className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  {group.label}
                </Select.Label>
                {group.instruments.map((instrument) => (
                  <Select.Item
                    key={instrument.symbol}
                    value={instrument.symbol}
                    className="relative flex h-10 cursor-pointer select-none items-center gap-2 rounded-md px-2 pr-8 text-sm text-ink outline-none data-[highlighted]:bg-brand-tint data-[highlighted]:text-ink"
                  >
                    <Select.ItemText>{instrument.name}</Select.ItemText>
                    <span className="text-[11px] text-ink-muted">
                      {instrument.currency}
                    </span>
                    <Select.ItemIndicator className="absolute right-2">
                      <Check className="h-4 w-4 text-brand" aria-hidden />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Group>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>

      {/* Announce the current selection for assistive tech without visual noise. */}
      <span className="sr-only" aria-live="polite">
        {selected ? `${selected.name} selected` : ""}
      </span>
    </Select.Root>
  );
}
