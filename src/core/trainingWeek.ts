// SPEC §20.5 — the week's training, as the figures that belong at the top of the Train screen.
//
// The house rule is that numbers sit on the page and cards are for things you tap. Training has
// three numbers worth that position: how many times you went, how many working sets that came
// to, and how much was moved. Everything else — which routine, how long, what was lifted on
// what — is a card you open.
import { toDateKey } from './dates';
import { sessionVolume } from './sets';
import type { WorkoutSession } from './types';

export interface TrainingWeek {
  sessions: number;
  working_sets: number;
  volume_kg: number;
  /** Working sets whose load could not be priced, because bodyweight was unknown. */
  unknown_sets: number;
  /** Local calendar days trained, so a week strip can mark them. */
  days: string[];
}

/** Monday of the week containing `on`. Weeks start on Monday here, as §5's banking does. */
export function weekStart(on: Date = new Date()): Date {
  const d = new Date(on);
  d.setHours(0, 0, 0, 0);
  // getDay: 0 is Sunday, so Sunday belongs to the week that began six days earlier.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/**
 * Totals the finished sessions that started on or after `from`. A session in progress is left
 * out: counting it would make the figures move while someone is standing in the gym looking
 * at them, and half a session is not a session.
 */
export function trainingWeek(
  sessions: readonly WorkoutSession[],
  from: Date = weekStart(),
  bodyweight_kg?: number,
): TrainingWeek {
  const since = from.getTime();
  const days = new Set<string>();
  let working_sets = 0;
  let volume_kg = 0;
  let unknown_sets = 0;
  let count = 0;

  for (const s of sessions) {
    if (s.ended_at == null) continue;
    const started = new Date(s.started_at);
    if (!(started.getTime() >= since)) continue;
    count++;
    days.add(toDateKey(started));
    const v = sessionVolume(s, bodyweight_kg);
    working_sets += v.working_sets;
    volume_kg += v.kg;
    unknown_sets += v.unknown_sets;
  }

  return { sessions: count, working_sets, volume_kg, unknown_sets, days: [...days].sort() };
}
