import type { MealSlot } from './types';

/** Local calendar day as YYYY-MM-DD. All "which day does this belong to" logic goes through here. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now);
}

export function addDays(key: string, n: number): string {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: string, b: string): number {
  const ms = fromDateKey(b).getTime() - fromDateKey(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** Inclusive list of day keys from `from` to `to`. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const n = diffDays(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

export function ageOn(birthDate: string, on: string): number {
  const b = fromDateKey(birthDate);
  const d = fromDateKey(on);
  let age = d.getFullYear() - b.getFullYear();
  const beforeBirthday =
    d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate());
  if (beforeBirthday) age--;
  return age;
}

export function mealSlotForTime(d: Date): MealSlot {
  const h = d.getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 18) return 'snack';
  if (h < 22) return 'dinner';
  return 'snack';
}

export function formatDayLabel(key: string, today: string = todayKey()): string {
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  if (key === addDays(today, 1)) return 'Tomorrow';
  return fromDateKey(key).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
