import { addDays, utcToISO, type ISODate } from "@/lib/utils/date";

/**
 * Market holiday rules (PRD §24).
 *
 * ── What is authoritative here, and what is not ────────────────────────────
 *
 * Only holidays that can be derived from an EXACT, stable rule live in this
 * file. Nothing is guessed:
 *
 *   • fixed calendar dates      (26 Jan, 4 Jul, 25 Dec, …)
 *   • nth-weekday-of-month      (3rd Monday of January, last Monday of May, …)
 *   • Good Friday               (Computus — exact for any Gregorian year)
 *
 * Holidays that track the lunar/lunisolar calendars — Diwali, Holi, Eid,
 * Muharram, Ganesh Chaturthi, Dussehra, Guru Nanak Jayanti and the rest of the
 * NSE/BSE festival list — CANNOT be derived by rule and are NOT invented here.
 * They must be loaded from the exchange's published circular into
 * `EXTRA_HOLIDAYS` below (see README, "Market calendar").
 *
 * This gap is why the calendar treats provider-observed sessions as the
 * authority for the past and only falls back to these rules when projecting
 * forward. A projected date is always labelled as such in the API and the UI,
 * so an unlisted festival holiday can never be silently presented as fact.
 */

/**
 * Manually maintained holidays, keyed by market id.
 *
 * Populate from the exchange circular each year, e.g.
 *   NSE: ["2027-03-22", "2027-11-05", …]
 *
 * Entries are additive — rule-derived holidays above still apply.
 */
export const EXTRA_HOLIDAYS: Record<string, ISODate[]> = {
  NSE: [],
  BSE: [],
  COMEX: [],
  NYMEX: [],
};

/** Easter Sunday for a Gregorian year (Anonymous Gregorian Computus). */
export function easterSunday(year: number): ISODate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcToISO(new Date(Date.UTC(year, month - 1, day)));
}

export function goodFriday(year: number): ISODate {
  return addDays(easterSunday(year), -2);
}

/** `n`th `weekday` of a month. `weekday` is 0=Sun … 6=Sat. */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  n: number,
): ISODate {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utcToISO(new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7)));
}

/** Last `weekday` of a month. */
export function lastWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
): ISODate {
  const last = new Date(Date.UTC(year, month, 0)); // day 0 of next month
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return utcToISO(
    new Date(Date.UTC(year, month - 1, last.getUTCDate() - offset)),
  );
}

function fixed(year: number, month: number, day: number): ISODate {
  return utcToISO(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * US "observed" shift: a holiday falling on Saturday is observed the preceding
 * Friday, one falling on Sunday the following Monday.
 */
function observed(date: ISODate): ISODate {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (dow === 6) return addDays(date, -1);
  if (dow === 0) return addDays(date, 1);
  return date;
}

/**
 * Indian exchange holidays derivable by rule.
 *
 * Incomplete by design — see the file header. Festival holidays must be added
 * to `EXTRA_HOLIDAYS`.
 */
export function indianRuleHolidays(year: number): ISODate[] {
  return [
    fixed(year, 1, 26), // Republic Day
    fixed(year, 4, 14), // Dr. B. R. Ambedkar Jayanti
    goodFriday(year),
    fixed(year, 5, 1), // Maharashtra Day
    fixed(year, 8, 15), // Independence Day
    fixed(year, 10, 2), // Mahatma Gandhi Jayanti
    fixed(year, 12, 25), // Christmas
  ];
}

/**
 * CME Group (COMEX / NYMEX) full-closure holidays.
 *
 * Every entry is rule-derived and complete for these venues. Shortened sessions
 * (e.g. the day after Thanksgiving) are NOT listed: the exchange still settles a
 * session, so a bar exists and a CPR is valid.
 */
export function usRuleHolidays(year: number): ISODate[] {
  return [
    observed(fixed(year, 1, 1)), // New Year's Day
    nthWeekdayOfMonth(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekdayOfMonth(year, 2, 1, 3), // Presidents' Day
    goodFriday(year),
    lastWeekdayOfMonth(year, 5, 1), // Memorial Day
    observed(fixed(year, 6, 19)), // Juneteenth
    observed(fixed(year, 7, 4)), // Independence Day
    nthWeekdayOfMonth(year, 9, 1, 1), // Labor Day
    nthWeekdayOfMonth(year, 11, 4, 4), // Thanksgiving
    observed(fixed(year, 12, 25)), // Christmas
  ];
}
