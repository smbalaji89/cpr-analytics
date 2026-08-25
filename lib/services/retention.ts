import { addDays, type ISODate } from "@/lib/utils/date";
import { readEnvInt } from "@/lib/utils/env";

/**
 * Retention window (PRD §21, §6, §30).
 *
 * One definition of "90 days" shared by the cleanup job, the date-picker bounds
 * and the API validators — so the picker can never offer a date the database has
 * already deleted.
 */

export const DEFAULT_RETENTION_DAYS = 90;

export function retentionDays(): number {
  return readEnvInt("DATA_RETENTION_DAYS", DEFAULT_RETENTION_DAYS);
}

/**
 * Oldest selectable/retained trading date.
 *
 * Rows strictly older than this are deleted, and dates before it are rejected by
 * the API and disabled in the picker.
 */
export function retentionCutoff(today: ISODate, days = retentionDays()): ISODate {
  return addDays(today, -days);
}

export function isWithinRetention(
  date: ISODate,
  today: ISODate,
  days = retentionDays(),
): boolean {
  return date >= retentionCutoff(today, days);
}
