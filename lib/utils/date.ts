/**
 * Date helpers.
 *
 * Every date in this application is an ISO calendar date string, `YYYY-MM-DD`,
 * interpreted in the *exchange's* timezone — never a `Date` passed around and
 * re-interpreted in whatever timezone the server happens to run in. Vercel
 * functions run in UTC while NSE trades in IST; treating "today" as a UTC
 * instant would roll the trading day over at 05:30 IST.
 *
 * All arithmetic below goes through `Date.UTC`, which has no DST, so adding a
 * day is always exactly 86,400,000 ms.
 */

export type ISODate = string;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  // Reject rolled-over values such as "2026-02-31" -> 2026-03-03.
  return new Date(ms).toISOString().slice(0, 10) === value;
}

export function assertISODate(value: string): ISODate {
  if (!isISODate(value)) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return value;
}

/** Midnight UTC for an ISO date. Used only as an arithmetic anchor. */
export function isoToUTC(date: ISODate): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function utcToISO(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

/** Calendar date "now" in a given IANA timezone. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): ISODate {
  // `en-CA` formats as YYYY-MM-DD, which is exactly the shape we want.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = isoToUTC(date);
  d.setUTCDate(d.getUTCDate() + days);
  return utcToISO(d);
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function diffDays(from: ISODate, to: ISODate): number {
  const ms = isoToUTC(to).getTime() - isoToUTC(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: ISODate): number {
  return isoToUTC(date).getUTCDay();
}

export function isWeekend(date: ISODate): boolean {
  const d = dayOfWeek(date);
  return d === 0 || d === 6;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

/** Unix seconds for midnight UTC of an ISO date. */
export function isoToUnixSeconds(date: ISODate): number {
  return Math.floor(isoToUTC(date).getTime() / 1000);
}

/** Calendar date of a unix timestamp, resolved in the given timezone. */
export function unixSecondsToISO(seconds: number, timeZone: string): ISODate {
  return todayInTimeZone(timeZone, new Date(seconds * 1000));
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-08-25" -> "25 Aug 2026" (PRD §7 display format). */
export function formatDisplayDate(date: ISODate): string {
  if (!isISODate(date)) return date;
  const [y, m, d] = date.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** "2026-08-25" -> "Aug 25" (compact table format). */
export function formatShortDate(date: ISODate): string {
  if (!isISODate(date)) return date;
  const [, m, d] = date.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/** "2026-08-25" -> "Tuesday". */
export function formatWeekday(date: ISODate): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
  }).format(isoToUTC(date));
}
