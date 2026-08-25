"use client";

import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { formatDisplayDate, type ISODate } from "@/lib/utils/date";

/**
 * Date selector (PRD §6).
 *
 * Previous / next step across TRADING days — the server supplies the adjacent
 * session dates, so stepping never lands on a weekend or holiday and no calendar
 * rules are duplicated on the client.
 *
 * The picker is a native `<input type="date">`: it gets the platform's own date
 * UI on mobile (a significantly better experience than any JS calendar), and its
 * `min`/`max` enforce the 90-day window at the browser level as well as in the API.
 */
export function DateSelector({
  value,
  minDate,
  maxDate,
  previousDate,
  nextDate,
  defaultDate,
  className,
}: {
  value: ISODate;
  minDate: ISODate;
  maxDate: ISODate;
  previousDate: ISODate | null;
  nextDate: ISODate | null;
  defaultDate: ISODate;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function goTo(next: ISODate | null, clear = false) {
    if (!next && !clear) return;
    const params = new URLSearchParams(searchParams.toString());
    if (clear) params.delete("date");
    else params.set("date", next as string);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  const isDefault = value === defaultDate;

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        isPending && "opacity-60",
        className,
      )}
    >
      <Button
        size="icon"
        variant="outline"
        aria-label="Previous trading day"
        disabled={!previousDate}
        onClick={() => goTo(previousDate)}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </Button>

      <div className="relative min-w-0 flex-1">
        <input
          type="date"
          value={value}
          min={minDate}
          max={maxDate}
          aria-label="Select trading date"
          onChange={(event) => {
            const next = event.target.value;
            // An empty value means the user cleared the field.
            if (next) goTo(next as ISODate);
          }}
          className="h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm font-medium text-ink [color-scheme:light] focus:border-brand dark:[color-scheme:dark]"
        />
        <span className="sr-only" aria-live="polite">
          {formatDisplayDate(value)}
        </span>
      </div>

      <Button
        size="icon"
        variant="outline"
        aria-label="Next trading day"
        disabled={!nextDate}
        onClick={() => goTo(nextDate)}
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Button>

      {!isDefault ? (
        <Button
          size="icon"
          variant="ghost"
          aria-label="Back to the default trading day"
          title="Back to the default trading day"
          onClick={() => goTo(null, true)}
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
