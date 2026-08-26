import { describe, expect, it } from "vitest";
import { clampToRange, type ISODate } from "@/lib/utils/date";

/**
 * Date-picker range clamping.
 *
 * `min`/`max` on `<input type="date">` are constraint validation, not a
 * constraint: they mark the field `:invalid` but never stop a value being set,
 * and the date selector submits no form. Desktop pickers grey out-of-range days
 * out, which hid this — iOS Safari's wheel offers every date regardless, so a
 * user could pick a future date that has no CPR and land on an error state.
 */

const MIN = "2026-05-29" as ISODate; // 90-day retention floor
const MAX = "2026-08-27" as ISODate; // furthest date a completed session supports

describe("clampToRange", () => {
  it("leaves an in-range date untouched and reports no clamping", () => {
    for (const d of ["2026-05-29", "2026-07-01", "2026-08-27"] as ISODate[]) {
      expect(clampToRange(d, MIN, MAX)).toEqual({ date: d, clamped: null });
    }
  });

  it("pulls a future pick back to the furthest available date", () => {
    // The reported case: choosing tomorrow-plus on an iPhone.
    expect(clampToRange("2026-08-28" as ISODate, MIN, MAX)).toEqual({
      date: MAX,
      clamped: "MAX",
    });
    expect(clampToRange("2027-01-01" as ISODate, MIN, MAX)).toEqual({
      date: MAX,
      clamped: "MAX",
    });
  });

  it("pulls a pick below the retention floor up to the earliest kept date", () => {
    expect(clampToRange("2026-05-28" as ISODate, MIN, MAX)).toEqual({
      date: MIN,
      clamped: "MIN",
    });
    expect(clampToRange("2019-03-04" as ISODate, MIN, MAX)).toEqual({
      date: MIN,
      clamped: "MIN",
    });
  });

  it("treats both bounds as inclusive", () => {
    expect(clampToRange(MIN, MIN, MAX).clamped).toBeNull();
    expect(clampToRange(MAX, MIN, MAX).clamped).toBeNull();
  });

  it("compares lexically, which is ordering for ISO dates", () => {
    // Guards against a refactor to Date arithmetic, where a timezone offset
    // could shift a boundary date by a day.
    expect(clampToRange("2026-09-02" as ISODate, MIN, MAX).date).toBe(MAX);
    expect(clampToRange("2026-08-09" as ISODate, MIN, MAX).clamped).toBeNull();
  });

  it("collapses to the single date when the range is one day wide", () => {
    expect(clampToRange("2026-08-28" as ISODate, MAX, MAX)).toEqual({
      date: MAX,
      clamped: "MAX",
    });
  });
});
