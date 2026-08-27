/**
 * Date helpers for metric windows.
 *
 * Commitment dates are stored as plain `date` columns (YYYY-MM-DD) which means
 * they are already calendar days in the client's world, with no timezone
 * arithmetic needed. ISO date strings also sort lexicographically, so window
 * filtering is a pure string comparison — no Date objects, no DST surprises.
 */

export type IsoDate = string; // YYYY-MM-DD

const DAY_MS = 86_400_000;

export function toIsoDate(value: Date | string): IsoDate {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

/**
 * Today's calendar date in a given IANA timezone.
 *
 * Coaching days are local days: a commitment made at 11pm belongs to that
 * evening, not to the next UTC day. The 'en-CA' locale is used because it
 * formats as YYYY-MM-DD.
 */
export function todayIn(timezone: string, now: Date = new Date()): IsoDate {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** The local hour (0–23) in a given timezone, used to bucket planning time. */
export function hourIn(timezone: string, now: Date = new Date()): number {
  try {
    const hour = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).format(now);
    return Number.parseInt(hour, 10) % 24;
  } catch {
    return now.getUTCHours();
  }
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const ms = Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}


/** Whole days from one calendar date to another. Negative when `to` is earlier. */
export function daysBetweenDates(from: IsoDate, to: IsoDate): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS,
  );
}

export interface DateWindow {
  start: IsoDate; // inclusive
  end: IsoDate; // inclusive
}

/** The N-day window ending on (and including) `end`. */
export function lastNDays(end: IsoDate, days: number): DateWindow {
  return { start: addDays(end, -(days - 1)), end };
}

/** The N-day window immediately before `lastNDays(end, days)`. */
export function previousNDays(end: IsoDate, days: number): DateWindow {
  const current = lastNDays(end, days);
  return { start: addDays(current.start, -days), end: addDays(current.start, -1) };
}

export function isWithin(date: IsoDate, window: DateWindow): boolean {
  const d = date.slice(0, 10);
  return d >= window.start && d <= window.end;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. Matches Postgres `isodow`. */
export function isoWeekday(date: IsoDate): number {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

export function isWeekend(date: IsoDate): boolean {
  return isoWeekday(date) >= 6;
}


export type TimeBucket = 'morning' | 'afternoon' | 'evening' | 'late_night';


export function timeBucket(hour: number): TimeBucket {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'late_night';
}
