import { describe, expect, it } from "vitest";
import { getCalendar } from "@/lib/market-data/calendar";
import {
  easterSunday,
  goodFriday,
  lastWeekdayOfMonth,
  nthWeekdayOfMonth,
  usRuleHolidays,
} from "@/lib/market-data/holidays";
import {
  addDays,
  diffDays,
  formatDisplayDate,
  formatShortDate,
  isISODate,
  todayInTimeZone,
} from "@/lib/utils/date";

describe("ISO date helpers", () => {
  it("rejects malformed and rolled-over dates", () => {
    expect(isISODate("2026-08-25")).toBe(true);
    expect(isISODate("2026-2-5")).toBe(false);
    expect(isISODate("2026-13-01")).toBe(false);
    // Would silently become 2026-03-03 via Date parsing.
    expect(isISODate("2026-02-31")).toBe(false);
    expect(isISODate("not-a-date")).toBe(false);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    // 2028 is a leap year.
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("computes whole-day differences", () => {
    expect(diffDays("2026-08-25", "2026-11-23")).toBe(90);
    expect(diffDays("2026-08-25", "2026-08-25")).toBe(0);
    expect(diffDays("2026-08-25", "2026-08-24")).toBe(-1);
  });

  it("formats dates for display", () => {
    expect(formatDisplayDate("2026-08-25")).toBe("25 Aug 2026");
    expect(formatShortDate("2026-08-24")).toBe("Aug 24");
  });

  it("resolves the calendar day in the exchange timezone, not the server's", () => {
    // 2026-08-24 20:30 UTC is already 2026-08-25 in IST (+05:30) but still
    // 2026-08-24 in New York (-04:00). A server running in UTC must not roll
    // the NSE trading day over at the wrong moment.
    const instant = new Date("2026-08-24T20:30:00Z");
    expect(todayInTimeZone("Asia/Kolkata", instant)).toBe("2026-08-25");
    expect(todayInTimeZone("America/New_York", instant)).toBe("2026-08-24");
    expect(todayInTimeZone("UTC", instant)).toBe("2026-08-24");
  });
});

describe("holiday rules", () => {
  it("computes Easter and Good Friday exactly", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(goodFriday(2026)).toBe("2026-04-03");
    // Independently checkable reference years.
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2027)).toBe("2027-03-28");
  });

  it("computes nth and last weekday of a month", () => {
    expect(nthWeekdayOfMonth(2026, 1, 1, 3)).toBe("2026-01-19"); // 3rd Mon Jan
    expect(nthWeekdayOfMonth(2026, 11, 4, 4)).toBe("2026-11-26"); // 4th Thu Nov
    expect(lastWeekdayOfMonth(2026, 5, 1)).toBe("2026-05-25"); // last Mon May
  });

  it("applies the US observed-day shift", () => {
    // 4 July 2026 falls on a Saturday, so it is observed on Friday 3 July.
    const holidays = usRuleHolidays(2026);
    expect(holidays).toContain("2026-07-03");
    expect(holidays).not.toContain("2026-07-04");
  });
});

describe("TradingCalendar — NSE", () => {
  const nse = getCalendar("NSE");

  it("closes at weekends", () => {
    expect(nse.isTradingDay("2026-08-22")).toBe(false); // Saturday
    expect(nse.isTradingDay("2026-08-23")).toBe(false); // Sunday
    expect(nse.closureReason("2026-08-22")).toBe("WEEKEND");
  });

  it("rolls Friday forward to Monday (PRD §3)", () => {
    // Confirmed against real provider data: sessions exist on 21 and 24 Aug
    // 2026 and none in between.
    expect(nse.nextTradingDay("2026-08-21")).toBe("2026-08-24");
  });

  it("skips a rule-derived holiday", () => {
    // 26 Jan 2026 (Republic Day) is a Monday.
    expect(nse.isTradingDay("2026-01-26")).toBe(false);
    expect(nse.closureReason("2026-01-26")).toBe("HOLIDAY");
    expect(nse.nextTradingDay("2026-01-23")).toBe("2026-01-27");
  });

  it("skips a holiday that abuts a weekend", () => {
    // Good Friday 2026 is 3 April; the next session is Monday 6 April.
    expect(nse.isTradingDay("2026-04-03")).toBe(false);
    expect(nse.nextTradingDay("2026-04-02")).toBe("2026-04-06");
  });

  it("walks backwards over a weekend", () => {
    expect(nse.previousTradingDay("2026-08-24")).toBe("2026-08-21");
  });

  it("honours the inclusive flag", () => {
    expect(nse.nextTradingDay("2026-08-24", true)).toBe("2026-08-24");
    expect(nse.nextTradingDay("2026-08-24", false)).toBe("2026-08-25");
    expect(nse.previousTradingDay("2026-08-22", true)).toBe("2026-08-21");
  });

  it("returns the last N trading days newest-first, skipping non-sessions", () => {
    const days = nse.lastNTradingDays("2026-08-24", 5);
    expect(days).toEqual([
      "2026-08-24",
      "2026-08-21",
      "2026-08-20",
      "2026-08-19",
      "2026-08-18",
    ]);
  });

  it("snaps a weekend selection back to the prior session and says so", () => {
    expect(nse.resolveSelectedDate("2026-08-23")).toEqual({
      date: "2026-08-21",
      adjusted: true,
      reason: "WEEKEND",
    });
    expect(nse.resolveSelectedDate("2026-08-24")).toEqual({
      date: "2026-08-24",
      adjusted: false,
      reason: null,
    });
  });

  it("reports its holiday coverage as partial", () => {
    // Lunar-calendar festival holidays are not rule-derivable, and the app must
    // not pretend otherwise.
    expect(nse.holidayCoverage).toBe("PARTIAL");
  });
});

describe("TradingCalendar — COMEX", () => {
  const comex = getCalendar("COMEX");

  it("uses the US holiday schedule, not the Indian one", () => {
    // Thanksgiving closes COMEX; NSE trades normally that day.
    expect(comex.isTradingDay("2026-11-26")).toBe(false);
    expect(getCalendar("NSE").isTradingDay("2026-11-26")).toBe(true);
  });

  it("trades on Indian holidays", () => {
    // 26 Jan 2026 is a Monday: closed in India, open on COMEX.
    expect(comex.isTradingDay("2026-01-26")).toBe(true);
  });

  it("observes the shifted Independence Day", () => {
    expect(comex.isTradingDay("2026-07-03")).toBe(false);
    expect(comex.nextTradingDay("2026-07-02")).toBe("2026-07-06");
  });

  it("has complete rule-derived holiday coverage", () => {
    expect(comex.holidayCoverage).toBe("COMPLETE");
  });
});

describe("TradingCalendar — crypto", () => {
  const crypto = getCalendar("CRYPTO");

  it("trades every calendar day including weekends", () => {
    expect(crypto.isTradingDay("2026-08-22")).toBe(true); // Saturday
    expect(crypto.isTradingDay("2026-08-23")).toBe(true); // Sunday
    expect(crypto.isTradingDay("2026-12-25")).toBe(true);
  });

  it("advances by exactly one calendar day", () => {
    expect(crypto.nextTradingDay("2026-08-21")).toBe("2026-08-22");
    expect(crypto.previousTradingDay("2026-08-24")).toBe("2026-08-23");
  });

  it("never adjusts a selected date", () => {
    expect(crypto.resolveSelectedDate("2026-08-23")).toEqual({
      date: "2026-08-23",
      adjusted: false,
      reason: null,
    });
  });

  it("returns consecutive days for the last N", () => {
    expect(crypto.lastNTradingDays("2026-08-24", 3)).toEqual([
      "2026-08-24",
      "2026-08-23",
      "2026-08-22",
    ]);
  });
});

describe("calendars are independent per instrument (PRD §24)", () => {
  it("does not apply the NIFTY calendar to every instrument", () => {
    const saturday = "2026-08-22";
    expect(getCalendar("NSE").isTradingDay(saturday)).toBe(false);
    expect(getCalendar("COMEX").isTradingDay(saturday)).toBe(false);
    expect(getCalendar("CRYPTO").isTradingDay(saturday)).toBe(true);
  });
});
