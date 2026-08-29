"use client";

import { Activity, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils/cn";

/**
 * Primary navigation (PRD §4) — inline on desktop, hamburger on mobile.
 *
 * Settings is omitted for unprivileged visitors. That is presentation only:
 * the page itself 404s independently, so hiding the link is convenience, not
 * the control.
 */

const PUBLIC_NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/history", label: "Historical Data" },
  { href: "/instruments", label: "Instruments" },
] as const;

const PRIVILEGED_NAV = [
  ...PUBLIC_NAV,
  { href: "/settings", label: "Settings" },
] as const;

export function SiteNav({ privileged }: { privileged: boolean }) {
  const NAV = privileged ? PRIVILEGED_NAV : PUBLIC_NAV;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the menu on navigation, otherwise it stays open over the new page.
  useEffect(() => setOpen(false), [pathname]);

  // Prevent the page behind the open menu from scrolling.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface-raised/95 backdrop-blur supports-[backdrop-filter]:bg-surface-raised/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-on-brand">
            <Activity className="h-4 w-4" aria-hidden />
          </span>
          <span className="text-sm tracking-tight sm:text-base">
            CPR Analytics
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "bg-brand-tint text-brand"
                  : "text-ink-muted hover:bg-surface-muted hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          ))}
          <ThemeToggle className="ml-1" />
        </nav>

        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink"
          >
            {open ? (
              <X className="h-5 w-5" aria-hidden />
            ) : (
              <Menu className="h-5 w-5" aria-hidden />
            )}
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Primary"
          className="border-t border-line bg-surface-raised md:hidden"
        >
          <ul className="px-2 py-2">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center rounded-lg px-3 text-sm font-medium",
                    isActive(item.href)
                      ? "bg-brand-tint text-brand"
                      : "text-ink hover:bg-surface-muted",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
