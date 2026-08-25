import { z } from "zod";
import { FILTERABLE_CATEGORIES, parseCategoryFilter } from "@/lib/cpr/filter";
import { INSTRUMENTS } from "@/lib/instruments";
import { isISODate } from "@/lib/utils/date";

/**
 * Request validation (PRD §30).
 *
 * Instrument symbols are validated against the registry rather than a regex, so
 * a typo returns a 404 with the valid list instead of an empty result set that
 * looks like "no data".
 */

const SYMBOLS = INSTRUMENTS.map((i) => i.symbol) as [string, ...string[]];

export const instrumentSymbolSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.enum(SYMBOLS));

export const isoDateSchema = z
  .string()
  .refine(isISODate, { message: "Expected an ISO date in YYYY-MM-DD form" });

/** Windows offered by the comparison selector (PRD §15). */
export const COMPARISON_WINDOWS = [5, 10, 20, 30, 60, 90] as const;

/**
 * `category` filter: comma-separated, or `all`/omitted for no filter.
 *
 * An unknown value is a hard 400 rather than being ignored — silently returning
 * unfiltered data for `?category=NARWO` would look like "every session is
 * narrow".
 */
export const categoryFilterSchema = z
  .string()
  .optional()
  .superRefine((value, ctx) => {
    if (!value) return;
    const unknown = value
      .split(",")
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean)
      .filter(
        (part) =>
          part !== "ALL" &&
          !(FILTERABLE_CATEGORIES as readonly string[]).includes(part),
      );
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown category ${unknown.join(", ")}. Expected any of: ${FILTERABLE_CATEGORIES.join(", ")}, or "all".`,
      });
    }
  })
  .transform((value) => parseCategoryFilter(value));

export const cprQuerySchema = z.object({
  instrument: instrumentSymbolSchema,
  /** Omitted means "the default trading date" — see PRD §3. */
  date: isoDateSchema.optional(),
});

export const historyQuerySchema = z.object({
  instrument: instrumentSymbolSchema,
  days: z.coerce.number().int().min(1).max(90).default(10),
  before: isoDateSchema.optional(),
  category: categoryFilterSchema,
});

export const rangeQuerySchema = z
  .object({
    instrument: instrumentSymbolSchema,
    start: isoDateSchema,
    end: isoDateSchema,
    category: categoryFilterSchema,
  })
  .refine((v) => v.start <= v.end, {
    message: "start must be on or before end",
    path: ["start"],
  });

export const compareQuerySchema = z.object({
  date: isoDateSchema.optional(),
  category: categoryFilterSchema,
  /** Comma-separated symbols; defaults to every registered instrument. */
  instruments: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(z.enum(SYMBOLS)).min(1).max(20).optional()),
});

export const syncBodySchema = z.object({
  instruments: z.array(instrumentSymbolSchema).min(1).optional(),
  windowDays: z.number().int().min(1).max(365).optional(),
});

/** Flatten a Zod issue list into a single readable sentence. */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
