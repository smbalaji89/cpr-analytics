"use client";

import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import {
  clampToRange,
  formatDisplayDate,
  type ISODate,
} from "@/lib/utils/date";

/**
 * Date selector (PRD §6).
 *
 * Previous / next step across TRADING days — the server supplies the adjacent
 * session dates, so stepping never lands on a weekend or holiday and no calendar
 * rules are duplicated on the client.
 *
 * The picker is a native `<input type="date">`: it gets the platform's own date
 * UI on mobile, which is a significantly better experience than any JS calendar.
 *
 * `min`/`max` are NOT a constraint here. They are constraint *validation*: they
 * flag the field `:invalid` but never prevent a value being set, and nothing on
 * this page submits a form. Desktop pickers grey out-of-range days out, so the
 * attributes look like they are enforcing something — but iOS Safari's wheel
 * offers every date regardless, and typing bypasses the picker everywhere. The
 * value is therefore clamped explicitly, and the reason is shown rather than the
 * date silently moving.
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

  // The input is driven locally so an out-of-range pick can be pulled back even
  // when clamping lands on the date already shown — in that case the URL does
  // not change, so no re-render would otherwise correct the field.
  const [draft, setDraft] = useState<string>(value);
  // The notice is tied to the date it explains, so it survives the navigation
  // that clamping triggers but is dropped by any other move (arrows, reset).
  const [notice, setNotice] = useState<{ date: ISODate; text: string } | null>(
    null,
  );
  useEffect(() => {
    setDraft(value);
    setNotice((current) => (current?.date === value ? current : null));
  }, [value]);

  function goTo(next: ISODate | null, clear = false) {
    if (!next && !clear) return;
    const params = new URLSearchParams(searchParams.toString());
    if (clear) params.delete("date");
    else params.set("date", next as string);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  const isDefault = value === defaultDate;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className={cn("flex items-center gap-2", isPending && "opacity-60")}>
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
            value={draft}
            min={minDate}
            max={maxDate}
            aria-label="Select trading date"
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              // An empty value means the user cleared or is mid-edit.
              if (!next) return;

              const { date, clamped } = clampToRange(
                next as ISODate,
                minDate,
                maxDate,
              );
              setDraft(date);
              setNotice(
                clamped === null
                  ? null
                  : {
                      date,
                      text:
                        clamped === "MAX"
                          ? `A CPR needs a completed session, so none exists past ${formatDisplayDate(maxDate)} yet. Showing that date instead.`
                          : `${formatDisplayDate(minDate)} is the earliest date kept. Showing that instead.`,
                    },
              );
              if (date !== value) goTo(date);
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

      {notice ? (
        <p role="status" className="text-xs text-ink-muted">
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
