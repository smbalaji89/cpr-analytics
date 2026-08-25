import type { OverallClassification } from "./types";

/**
 * CPR category filtering.
 *
 * One definition shared by the API validators, the database query, the in-memory
 * fallback and the UI chips, so the filter cannot mean one thing in the query
 * string and another in SQL.
 */

/** Categories a user can filter on, in display order. */
export const FILTERABLE_CATEGORIES = [
  "NARROW",
  "MIXED",
  "WIDER",
  "UNCLASSIFIED",
] as const satisfies readonly OverallClassification[];

export type FilterableCategory = (typeof FILTERABLE_CATEGORIES)[number];

/** `null` means "no filter" — show everything. */
export type CategoryFilter = FilterableCategory[] | null;

export function isFilterableCategory(
  value: string,
): value is FilterableCategory {
  return (FILTERABLE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Parse a comma-separated `category` query value.
 *
 * Returns `null` for absent, empty, or "all" — and, deliberately, also when the
 * selection covers every category, so an all-selected filter does not add a
 * pointless SQL predicate.
 */
export function parseCategoryFilter(
  value: string | null | undefined,
): CategoryFilter {
  if (!value) return null;

  const raw = value
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);

  if (raw.length === 0 || raw.includes("ALL")) return null;

  const valid = [...new Set(raw.filter(isFilterableCategory))];
  if (valid.length === 0 || valid.length === FILTERABLE_CATEGORIES.length) {
    return null;
  }
  return valid;
}

/** Serialise back to a query value. `null` -> undefined (omit the param). */
export function serializeCategoryFilter(
  filter: CategoryFilter,
): string | undefined {
  return filter && filter.length > 0 ? filter.join(",") : undefined;
}

export function matchesCategoryFilter(
  classification: OverallClassification,
  filter: CategoryFilter,
): boolean {
  return !filter || filter.includes(classification as FilterableCategory);
}

/** Apply the filter to any list of records carrying an overall classification. */
export function filterByCategory<
  T extends { overallClassification: OverallClassification },
>(records: T[], filter: CategoryFilter): T[] {
  if (!filter) return records;
  return records.filter((r) =>
    matchesCategoryFilter(r.overallClassification, filter),
  );
}
