// SPEC §20.11 — is this lift going up? One number per session, drawn over time.
//
// Records (§20.5) answer "what is the best I have done"; they cannot answer "am I still getting
// stronger", because a record set in March looks the same in October whether everything since
// has crept up or slid back. The line answers that, from the same history, and stores nothing.
import { toDateKey } from './dates';
import { bestE1rm, isWorkingSet } from './sets';
import type { LoadType, WorkoutEntry, WorkoutSession } from './types';

/**
 * What is drawn depends on what the exercise is. A loaded lift is compared by estimated 1RM,
 * which puts a set of 5 and a set of 10 on one scale. Bodyweight work is compared by the most
 * reps in a set, and a hold by its longest time. Distance work has no single number that means
 * "better" without knowing whether the goal was pace or distance, so it gets no line.
 */
export type ProgressMetric = 'e1rm' | 'reps' | 'seconds';

export interface ProgressPoint {
  /** The session's start, ISO. */
  at: string;
  date: string;
  value: number;
  /** Beats every point before it. The first point never is, as with records (§20.5). */
  record: boolean;
}

export interface Progress {
  metric: ProgressMetric;
  /** Oldest first, one per session. */
  points: ProgressPoint[];
  first: ProgressPoint;
  latest: ProgressPoint;
  /** The highest point; the earliest of them when tied, since that is when it was first done. */
  best: ProgressPoint;
}

/** A line needs two points; one dot says nothing about direction. */
export const MIN_PROGRESS_POINTS = 2;

/**
 * Which number to draw. Belted bodyweight work is drawn by estimated 1RM of lifter plus belt
 * once a belt has ever been used and bodyweight is known; until then, reps, because a person
 * doing twenty push-ups is not doing a one-rep-max exercise and the estimate refuses past 12.
 */
export function progressMetric(
  load_type: LoadType,
  entries: readonly WorkoutEntry[],
  knowsBodyweight: boolean,
): ProgressMetric | undefined {
  switch (load_type) {
    case 'weight_reps':
      return 'e1rm';
    case 'weighted_bodyweight': {
      const belted = entries.some((e) =>
        e.sets.some((s) => isWorkingSet(s) && (s.weight_kg ?? 0) > 0),
      );
      return belted && knowsBodyweight ? 'e1rm' : 'reps';
    }
    case 'bodyweight_reps':
      return 'reps';
    case 'time':
      return 'seconds';
    case 'distance_time':
      return undefined;
  }
}

function valueOf(
  entry: WorkoutEntry,
  metric: ProgressMetric,
  bodyweight_kg: number | undefined,
): number | undefined {
  if (metric === 'e1rm') return bestE1rm(entry, bodyweight_kg);
  let best: number | undefined;
  for (const s of entry.sets) {
    if (!isWorkingSet(s)) continue;
    const v = metric === 'reps' ? s.reps : s.seconds;
    if (v != null && v > 0 && (best == null || v > best)) best = v;
  }
  return best;
}

/**
 * Bodyweight on a day: the last weigh-in on or before it, else the first one after. Using
 * today's weight for a session from last spring would make someone who lost ten kilos look
 * weaker on every bodyweight lift, when they have only become lighter.
 */
export function bodyweightOn(
  weighIns: readonly { date: string; weight_kg: number }[],
  date: string,
): number | undefined {
  let before: { date: string; weight_kg: number } | undefined;
  let after: { date: string; weight_kg: number } | undefined;
  for (const w of weighIns) {
    if (w.date <= date) {
      if (!before || w.date > before.date) before = w;
    } else if (!after || w.date < after.date) {
      after = w;
    }
  }
  return (before ?? after)?.weight_kg;
}

/**
 * One point per finished session that trained the exercise, oldest first. A session that did
 * the exercise twice counts its best entry once. Undefined when there is nothing to draw.
 */
export function progressSeries(
  sessions: readonly WorkoutSession[],
  exercise_id: string,
  load_type: LoadType,
  weighIns: readonly { date: string; weight_kg: number }[] = [],
): Progress | undefined {
  const done = sessions
    .filter((s) => s.ended_at && !s.deleted_at)
    .map((s) => ({ s, entries: s.entries.filter((e) => e.exercise_id === exercise_id) }))
    .filter((x) => x.entries.length > 0)
    .sort((a, b) => (a.s.started_at < b.s.started_at ? -1 : 1));

  const metric = progressMetric(
    load_type,
    done.flatMap((x) => x.entries),
    weighIns.length > 0,
  );
  if (!metric) return undefined;

  const points: ProgressPoint[] = [];
  let top: number | undefined;
  for (const { s, entries } of done) {
    const date = toDateKey(new Date(s.started_at));
    const bw = bodyweightOn(weighIns, date);
    let value: number | undefined;
    for (const e of entries) {
      const v = valueOf(e, metric, bw);
      if (v != null && (value == null || v > value)) value = v;
    }
    if (value == null) continue;
    points.push({ at: s.started_at, date, value, record: top != null && value > top });
    if (top == null || value > top) top = value;
  }
  if (points.length < MIN_PROGRESS_POINTS) return undefined;

  let best = points[0]!;
  for (const p of points) if (p.value > best.value) best = p;
  return { metric, points, first: points[0]!, latest: points[points.length - 1]!, best };
}

/**
 * The sentence under the line: where it is now, against where it started, and the best if that
 * is neither. `format` turns a value into what is printed, and the comparison is made on
 * what is printed, so a rise too small to show never reads as "up from" the same number.
 */
export function describeProgress(p: Progress, format: (v: number) => string): string {
  const day = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const now = format(p.latest.value);
  const was = format(p.first.value);
  const trend =
    now === was
      ? `the same as on ${day(p.first.date)}`
      : `${p.latest.value > p.first.value ? 'up' : 'down'} from ${was} on ${day(p.first.date)}`;
  const best = format(p.best.value);
  // Said once: a best that is the first or the latest point is already in the sentence.
  const tail = best === now || p.best === p.first ? '' : ` Best ${best} on ${day(p.best.date)}.`;
  return `${now} last time, ${trend}.${tail}`;
}
