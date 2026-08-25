"use client";

import * as Switch from "@radix-ui/react-switch";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useTransition } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * A switch that stores its state in the URL.
 *
 * Used for "Show pivot levels" (PRD §14). Keeping it in the query string means
 * the preference survives a refresh and travels with a shared link, and the
 * server can render the correct markup on the first pass instead of the panel
 * popping in after hydration.
 */
export function ToggleLink({
  param,
  checked,
  label,
  className,
}: {
  param: string;
  checked: boolean;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const id = useId();

  function onChange(next: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set(param, "1");
    else params.delete(param);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2.5",
        isPending && "opacity-60",
        className,
      )}
    >
      <Switch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="relative h-6 w-11 shrink-0 rounded-full border border-line bg-surface-muted transition-colors data-[state=checked]:border-brand data-[state=checked]:bg-brand"
      >
        <Switch.Thumb className="block h-4 w-4 translate-x-1 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-6" />
      </Switch.Root>
      <label htmlFor={id} className="cursor-pointer text-sm text-ink">
        {label}
      </label>
    </div>
  );
}
