/**
 * Calendar arithmetic in the browser's own timezone, because "today" and "this week"
 * are what the person looking at the screen means by them, not UTC.
 */

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

/** Weeks start on Monday, as they do in Brazilian agendas. */
export function startOfWeek(date: Date): Date {
  const copy = startOfDay(date);
  const weekday = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - weekday);
  return copy;
}

export function endOfWeek(date: Date): Date {
  return endOfDay(addDays(startOfWeek(date), 6));
}

export function startOfMonth(date: Date): Date {
  const copy = startOfDay(date);
  copy.setDate(1);
  return copy;
}

export function endOfMonth(date: Date): Date {
  const copy = startOfMonth(date);
  copy.setMonth(copy.getMonth() + 1);
  copy.setDate(0);
  return endOfDay(copy);
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function addMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** The six-week grid a month view needs, always starting on a Monday. */
export function monthGridDays(month: Date): Date[] {
  const first = startOfWeek(startOfMonth(month));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(date));
}

export function formatDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(date),
  );
}

export function formatTime(date: Date | string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(new Date(date));
}

export function formatMonth(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
}

export function formatWeekday(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date);
}

export function formatDayHeading(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(date);
}

/** `datetime-local` inputs speak local time with no zone, so both directions are explicit. */
export function toDateTimeInput(value: string | Date): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function fromDateTimeInput(value: string): string {
  return new Date(value).toISOString();
}
