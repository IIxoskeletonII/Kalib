// SPEC §20.17 — what a routine is, before you start it.
//
// Tapping a routine used to start it. A routine is a plan, and a plan is read before it is
// begun: what is in it, how long it will take, what it works, what you did last time. These are
// the figures that page and the routine cards on Train are built from.
import type { LoadType, Muscle, RoutineItem, WeightUnit, WorkoutSet } from './types';
import { formatWeight } from './weightUnit';

/** Seconds of work in a set, on average: a set of eight to twelve at a controlled tempo. */
export const WORK_SEC_PER_SET = 40;
/** Moving between exercises: setting up the bench, loading the bar, finding the dumbbells. */
export const CHANGEOVER_SEC = 60;
/** Rest when the routine does not say, matching the session screen's default. */
export const DEFAULT_REST_SEC = 90;

/**
 * Minutes, to the nearest five: the honest resolution of an estimate made before anyone has
 * picked up a weight (§2.4).
 *
 * Every set is worked and every set but the last of an exercise is rested; a superset rests once
 * per round, after its last exercise, because that is what a superset is for. Each exercise adds
 * a changeover.
 */
export function estimateMinutes(
  items: readonly Pick<RoutineItem, 'sets' | 'rest_sec' | 'superset'>[],
  defaultRestSec: number = DEFAULT_REST_SEC,
): number {
  let sec = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const sets = Math.max(0, Math.round(it.sets));
    if (sets === 0) continue;
    const rest = Math.max(0, it.rest_sec ?? defaultRestSec);
    sec += sets * WORK_SEC_PER_SET + CHANGEOVER_SEC;
    // Inside a superset only the group's last member rests, and it rests after every round.
    const nextSameGroup = it.superset != null && items[i + 1]?.superset === it.superset;
    const prevSameGroup = it.superset != null && items[i - 1]?.superset === it.superset;
    if (nextSameGroup) continue;
    sec += (prevSameGroup ? sets : sets - 1) * rest;
  }
  if (sec === 0) return 0;
  return Math.max(5, Math.round(sec / 60 / 5) * 5);
}

/** Working sets in the routine. */
export function totalSets(items: readonly Pick<RoutineItem, 'sets'>[]): number {
  return items.reduce((n, it) => n + Math.max(0, Math.round(it.sets)), 0);
}

/**
 * The muscles a routine trains, most sets first, by each exercise's primary muscle. Primary
 * only: a bench press is a chest exercise that also uses triceps, and counting the triceps as
 * trained by it would list them on every pressing day. Ties keep the routine's own order.
 */
export function routineMuscles(
  items: readonly Pick<RoutineItem, 'exercise_id' | 'sets'>[],
  primaryOf: (exercise_id: string) => Muscle | undefined,
): { muscle: Muscle; sets: number }[] {
  const sets = new Map<Muscle, number>();
  for (const it of items) {
    const m = primaryOf(it.exercise_id);
    if (!m || m === 'cardio') continue;
    sets.set(m, (sets.get(m) ?? 0) + Math.max(0, Math.round(it.sets)));
  }
  return [...sets.entries()]
    .filter(([, n]) => n > 0)
    .map(([muscle, n]) => ({ muscle, sets: n }))
    .sort((a, b) => b.sets - a.sets);
}

/** "3 × 8–12", "4 × 10", "3 sets" when there is no range to show. */
export function describeTarget(item: Pick<RoutineItem, 'sets' | 'rep_low' | 'rep_high'>): string {
  const sets = Math.max(0, Math.round(item.sets));
  const lo = item.rep_low;
  const hi = item.rep_high;
  if (lo == null && hi == null) return `${sets} ${sets === 1 ? 'set' : 'sets'}`;
  const reps = lo != null && hi != null && lo !== hi ? `${lo}–${hi}` : String(lo ?? hi);
  return `${sets} × ${reps}`;
}

/** "1:30 rest", "2 min rest". */
export function describeRest(sec: number | undefined): string | undefined {
  if (sec == null || sec <= 0) return undefined;
  if (sec % 60 === 0) return `${sec / 60} min rest`;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} rest`;
}

/**
 * Consecutive items grouped by superset letter, for drawing the group's rule. Items without a
 * letter are groups of one; a letter that is not adjacent to its partner starts a new group, as
 * `normaliseSupersets` already guarantees on save.
 */
export function groupSupersets<T extends Pick<RoutineItem, 'superset'>>(
  items: readonly T[],
): { superset?: string; items: { item: T; index: number }[] }[] {
  const out: { superset?: string; items: { item: T; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const prev = out[out.length - 1];
    if (item.superset != null && prev?.superset === item.superset) {
      prev.items.push({ item, index });
    } else {
      out.push({
        ...(item.superset != null ? { superset: item.superset } : {}),
        items: [{ item, index }],
      });
    }
  });
  return out;
}

/**
 * Last time's working sets in one line, the way a lifter says them: "60 kg × 8, 8, 7" when the
 * weight held, "60 kg × 8, 62.5 kg × 6" when it moved; reps alone for bodyweight; "+10 kg × 8"
 * for a belt; seconds for a hold. Undefined when there is nothing to say.
 */
export function describeSets(
  sets: readonly Pick<WorkoutSet, 'weight_kg' | 'reps' | 'seconds' | 'distance_m'>[],
  load_type: LoadType,
  unit: WeightUnit,
): string | undefined {
  if (sets.length === 0) return undefined;
  if (load_type === 'time') {
    const secs = sets.map((s) => s.seconds).filter((x): x is number => x != null);
    return secs.length ? secs.map((x) => `${Math.round(x)} s`).join(', ') : undefined;
  }
  if (load_type === 'distance_time') {
    const ms = sets.map((s) => s.distance_m).filter((x): x is number => x != null);
    return ms.length ? ms.map((x) => `${Math.round(x)} m`).join(', ') : undefined;
  }
  const reps = sets.map((s) => s.reps).filter((x): x is number => x != null);
  if (reps.length === 0) return undefined;
  if (load_type === 'bodyweight_reps') return `${reps.join(', ')} reps`;

  const weights = sets.map((s) => s.weight_kg);
  const prefix = load_type === 'weighted_bodyweight' ? '+' : '';
  const w = (kg: number | undefined) =>
    kg == null || (prefix && kg === 0) ? 'Body weight' : `${prefix}${formatWeight(kg, unit)}`;
  const same = weights.every((x) => x === weights[0]);
  if (same) return `${w(weights[0])} × ${reps.join(', ')}`;
  return sets
    .filter((s) => s.reps != null)
    .map((s) => `${w(s.weight_kg)} × ${s.reps}`)
    .join(', ');
}
