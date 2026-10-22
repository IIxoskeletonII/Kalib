// Words for the week (§20.17), shared by Train, the schedule and the routine page so a day or a
// routine reads the same wherever it appears.
import { addDays, fromDateKey } from '@/core/dates';
import { MUSCLE_LABEL } from '@/core/muscles';
import type { SplitKind } from '@/core/schedule';
import type { Muscle } from '@/core/types';

export const KIND_LABEL: Record<SplitKind, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  upper: 'Upper body',
  full: 'Full body',
  core: 'Core',
  other: '',
};

/** "Today", "Tomorrow", "Yesterday", or "Wed 21 Oct". */
export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  return fromDateKey(date).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** "Today", "Tomorrow", or "Mon 26": short enough for a column beside a name. */
export function shortDayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  const d = fromDateKey(date);
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()}`;
}

/** "Wednesday", or "Wednesday 28 Oct" once it is beyond this week's horizon. */
export function weekdayLong(date: string, today: string): string {
  const d = fromDateKey(date);
  const far = date > addDays(today, 6);
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    ...(far ? { day: 'numeric', month: 'short' } : {}),
  });
}

/** "Chest, Triceps and Shoulders". */
export function musclesText(muscles: readonly Muscle[]): string {
  const names = muscles.map((m) => MUSCLE_LABEL[m]);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** "6 exercises · 18 sets · about 55 min". */
export function sizeText(f: { exercises: number; sets: number; minutes: number }): string {
  const parts = [`${f.exercises} ${f.exercises === 1 ? 'exercise' : 'exercises'}`];
  if (f.sets > 0) parts.push(`${f.sets} ${f.sets === 1 ? 'set' : 'sets'}`);
  if (f.minutes > 0) parts.push(`about ${f.minutes} min`);
  return parts.join(' · ');
}
