import { describe, expect, it } from "vitest";
import { GET as getHistory } from "@/app/api/cpr/history/route";
import { GET as getRange } from "@/app/api/cpr/range/route";
import {
  FILTERABLE_CATEGORIES,
  filterByCategory,
  matchesCategoryFilter,
  parseCategoryFilter,
  serializeCategoryFilter,
} from "@/lib/cpr/filter";
import type { OverallClassification } from "@/lib/cpr/types";

/** CPR category filter. */

describe("parseCategoryFilter", () => {
  it("treats absent, empty and 'all' as no filter", () => {
    expect(parseCategoryFilter(undefined)).toBeNull();
    expect(parseCategoryFilter(null)).toBeNull();
    expect(parseCategoryFilter("")).toBeNull();
    expect(parseCategoryFilter("all")).toBeNull();
    expect(parseCategoryFilter("ALL")).toBeNull();
  });

  it("parses a single category", () => {
    expect(parseCategoryFilter("NARROW")).toEqual(["NARROW"]);
  });

  it("parses a comma-separated list, case- and space-insensitively", () => {
    expect(parseCategoryFilter(" narrow , WIDER ")).toEqual([
      "NARROW",
      "WIDER",
    ]);
  });

  it("de-duplicates repeated values", () => {
    expect(parseCategoryFilter("NARROW,NARROW,MIXED")).toEqual([
      "NARROW",
      "MIXED",
    ]);
  });

  it("collapses an all-selected filter back to no filter", () => {
    // Selecting everything is not a filter; it must not add a SQL predicate.
    expect(parseCategoryFilter(FILTERABLE_CATEGORIES.join(","))).toBeNull();
  });

  it("drops unknown values rather than matching them", () => {
    expect(parseCategoryFilter("NARROW,CONFLICTING")).toEqual(["NARROW"]);
    expect(parseCategoryFilter("NOPE")).toBeNull();
  });
});

describe("serializeCategoryFilter", () => {
  it("round-trips a filter", () => {
    const filter = parseCategoryFilter("NARROW,WIDER");
    const serialized = serializeCategoryFilter(filter);
    expect(serialized).toBe("NARROW,WIDER");
    expect(parseCategoryFilter(serialized)).toEqual(filter);
  });

  it("omits the param when there is no filter", () => {
    expect(serializeCategoryFilter(null)).toBeUndefined();
  });
});

describe("matchesCategoryFilter", () => {
  it("matches everything when there is no filter", () => {
    for (const category of FILTERABLE_CATEGORIES) {
      expect(matchesCategoryFilter(category, null)).toBe(true);
    }
  });

  it("matches only the selected categories", () => {
    const filter = parseCategoryFilter("NARROW,WIDER");
    expect(matchesCategoryFilter("NARROW", filter)).toBe(true);
    expect(matchesCategoryFilter("WIDER", filter)).toBe(true);
    expect(matchesCategoryFilter("MIXED", filter)).toBe(false);
    expect(matchesCategoryFilter("UNCLASSIFIED", filter)).toBe(false);
  });
});

describe("filterByCategory", () => {
  const records = (
    ["NARROW", "MIXED", "WIDER", "NARROW", "UNCLASSIFIED"] as const
  ).map((overallClassification, i) => ({
    id: i,
    overallClassification: overallClassification as OverallClassification,
  }));

  it("returns the input untouched when there is no filter", () => {
    expect(filterByCategory(records, null)).toBe(records);
  });

  it("keeps only matching records, preserving order", () => {
    const filtered = filterByCategory(records, parseCategoryFilter("NARROW"));
    expect(filtered.map((r) => r.id)).toEqual([0, 3]);
  });

  it("can return an empty list", () => {
    const only = filterByCategory(
      records.filter((r) => r.overallClassification === "MIXED"),
      parseCategoryFilter("WIDER"),
    );
    expect(only).toEqual([]);
  });
});

describe("API category validation", () => {
  const origin = "http://localhost";

  async function body(response: Response) {
    return (await response.json()) as {
      ok: boolean;
      error?: { code: string; message: string };
    };
  }

  it("rejects an unknown category rather than ignoring it", async () => {
    // Silently returning unfiltered rows for a typo would read as
    // "every session is narrow".
    const response = await getHistory(
      new Request(
        `${origin}/api/cpr/history?instrument=NIFTY50&category=NARWO`,
      ),
    );
    expect(response.status).toBe(400);
    const json = await body(response);
    expect(json.error!.message).toContain("Unknown category NARWO");
  });

  it("rejects a removed category value", async () => {
    // CONFLICTING is no longer produced under the per-instrument rule.
    const response = await getHistory(
      new Request(
        `${origin}/api/cpr/history?instrument=NIFTY50&category=CONFLICTING`,
      ),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an unknown category on the range endpoint too", async () => {
    const response = await getRange(
      new Request(
        `${origin}/api/cpr/range?instrument=NIFTY50&start=2026-08-01&end=2026-08-24&category=BOGUS`,
      ),
    );
    expect(response.status).toBe(400);
  });

  it("accepts 'all' as an explicit no-op filter", async () => {
    const response = await getRange(
      new Request(
        `${origin}/api/cpr/range?instrument=NIFTY50&start=1999-01-01&end=2026-08-24&category=all`,
      ),
    );
    // Fails on the retention window, NOT on the category — proving `all` parsed.
    const json = await body(response);
    expect(json.error!.code).toBe("OUT_OF_RANGE");
  });
});
