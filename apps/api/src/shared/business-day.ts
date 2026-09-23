import { getEnv } from '../config/env.js';

/**
 * "Today", "overdue" and "due on" are calendar words, and a calendar day only exists in
 * a time zone. These helpers measure them in `APP_TIMEZONE` - the zone the agency works
 * in - rather than in UTC, whose day ends at 21:00 in São Paulo: a UTC boundary dropped
 * every post scheduled for the evening out of "today" and made a deadline lapse three
 * hours before the day it names was over.
 */

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function wallClock(instant: Date, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** How far the zone's wall clock is ahead of UTC at `instant` (negative west of Greenwich). */
function offsetMs(instant: Date, timeZone: string): number {
  const clock = wallClock(instant, timeZone);
  const asIfUtc = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant a calendar date begins in `timeZone`. */
function zonedMidnight(date: CalendarDate, timeZone: string): Date {
  const utcMidnight = Date.UTC(date.year, date.month - 1, date.day);
  // Corrected once with the offset at the first guess, which only differs from the
  // offset at UTC midnight on a day the zone changes its clocks.
  const firstGuess = utcMidnight - offsetMs(new Date(utcMidnight), timeZone);
  return new Date(utcMidnight - offsetMs(new Date(firstGuess), timeZone));
}

export function businessDateOf(instant: Date): CalendarDate {
  const { year, month, day } = wallClock(instant, getEnv().APP_TIMEZONE);
  return { year, month, day };
}

/** Where today starts and ends, as instants, for comparing `timestamptz` columns. */
export function businessDayBounds(now = new Date()): {
  startOfToday: Date;
  startOfTomorrow: Date;
} {
  const timeZone = getEnv().APP_TIMEZONE;
  const today = businessDateOf(now);
  // Date.UTC normalises day + 1 across month and year ends.
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));

  return {
    startOfToday: zonedMidnight(today, timeZone),
    startOfTomorrow: zonedMidnight(
      {
        year: tomorrow.getUTCFullYear(),
        month: tomorrow.getUTCMonth() + 1,
        day: tomorrow.getUTCDate(),
      },
      timeZone,
    ),
  };
}

/**
 * Today's calendar date the way a `date` column stores one - midnight UTC - so a
 * deadline compares against the day it names rather than against an instant.
 */
export function businessToday(now = new Date()): Date {
  const { year, month, day } = businessDateOf(now);
  return new Date(Date.UTC(year, month - 1, day));
}

export function isSameBusinessDay(first: Date, second: Date): boolean {
  const a = businessDateOf(first);
  const b = businessDateOf(second);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}
