// SPEC §20 — live reads for training. useLiveQuery wrappers over the repos, exactly as
// useData.ts does for food: `undefined` means loading, `null` means loaded and absent.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import type { ExerciseDoc } from '@/core/exerciseSearch';
import { lastPerformance, personalRecords, type ExercisePR, type LastPerformance } from '@/core/pr';
import type { RestTimer } from '@/core/restTimer';
import type { Exercise, Routine, WeightUnit, WorkoutSession } from '@/core/types';
import { getExercise, getExercises, listExerciseDocs } from '@/db/repo/exercises';
import { getDailyTarget } from '@/db/repo/dailyTargets';
import { getSetting } from '@/db/repo/settings';
import {
  activeSession,
  getRoutine,
  getSession,
  listRoutines,
  listSessions,
} from '@/db/repo/workouts';
import { flatTargetFor } from '@/services/targets';
import { recentSessions, REST_TIMER_KEY, WEIGHT_UNIT_KEY } from '@/services/workouts';

/** The session being performed right now, or null when there is none. */
export function useActiveSession(): WorkoutSession | null | undefined {
  return useLiveQuery(async () => (await activeSession()) ?? null, []);
}

export function useSession(id: string | undefined): WorkoutSession | null | undefined {
  return useLiveQuery(async () => (id ? ((await getSession(id)) ?? null) : null), [id]);
}

export function useRoutines(): Routine[] | undefined {
  return useLiveQuery(listRoutines, []);
}

export function useRoutine(id: string | undefined): Routine | null | undefined {
  return useLiveQuery(async () => (id ? ((await getRoutine(id)) ?? null) : null), [id]);
}

export function useRecentSessions(limit = 20): WorkoutSession[] | undefined {
  return useLiveQuery(() => listSessions(limit), [limit]);
}

export function useExercise(id: string | undefined): Exercise | null | undefined {
  return useLiveQuery(async () => (id ? ((await getExercise(id)) ?? null) : null), [id]);
}

/**
 * The in-memory search index. 1,394 rows is small enough to hold and rescore on every
 * keystroke, the same reasoning as the food index.
 */
export function useExerciseDocs(): ExerciseDoc[] | undefined {
  return useLiveQuery(listExerciseDocs, []);
}

export function useWeightUnit(): WeightUnit {
  const v = useLiveQuery(() => getSetting<WeightUnit>(WEIGHT_UNIT_KEY), []);
  return v === 'lb' ? 'lb' : 'kg';
}

/**
 * The live rest timer.
 *
 * The stored value is only an end instant (core/restTimer.ts), so the interval here exists
 * purely to repaint — if it is throttled or stops entirely while the screen is locked, the
 * number shown on return is still correct, because it is recomputed rather than counted. The
 * tick stops once the rest is over, so a finished timer costs nothing.
 */
export function useRestTimer(): RestTimer | null {
  const stored = useLiveQuery(() => getSetting<RestTimer | null>(REST_TIMER_KEY), []);
  return stored ?? null;
}

/**
 * The current instant, as state rather than as a `Date.now()` call during render — which React
 * rightly treats as impure, since it makes a render's output depend on when it happened.
 *
 * Everything time-based here takes this as an argument (core/restTimer.ts already does), so the
 * clock has exactly one source and a missed tick only delays a repaint. It never changes what
 * the numbers are, because those are recomputed from stored instants rather than counted.
 */
export function useNow(active: boolean, ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, ms);
    // Returning from a locked screen is when the displayed value is most stale; repaint at once
    // rather than waiting up to a second for the next tick.
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [active, ms]);
  return now;
}

/** Seconds between an ISO instant and `now`, never negative. */
export function elapsedSince(iso: string, now: Date): number {
  return Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
}

/**
 * What was done last time, per exercise, for the session on screen. This is the number that
 * belongs beside every set — not a record, which may be years old, but the thing to beat today.
 */
export function useLastPerformances(
  exercise_ids: readonly string[],
  exclude_session_id?: string,
): Map<string, LastPerformance> | undefined {
  const key = [...exercise_ids].sort().join('|');
  return useLiveQuery(async () => {
    if (exercise_ids.length === 0) return new Map<string, LastPerformance>();
    const history = await recentSessions();
    const out = new Map<string, LastPerformance>();
    for (const id of new Set(exercise_ids)) {
      const last = lastPerformance(history, id, exclude_session_id);
      if (last) out.set(id, last);
    }
    return out;
  }, [key, exclude_session_id]);
}

/** The exercise rows behind a session's entries, for anything the entry itself does not carry
 *  — equipment, media, instructions. */
export function useExercisesByIds(ids: readonly string[]): Map<string, Exercise> | undefined {
  const key = [...new Set(ids)].sort().join('|');
  return useLiveQuery(async () => (key ? getExercises(key.split('|')) : new Map()), [key]);
}

/**
 * Whether §20.7 shifted this day's budget, and by how much. `undefined` while loading; a
 * `delta_kcal` of 0 means the bridge is off or had nothing to move.
 */
export function useEnergyBridgeDay(
  date: string,
): { delta_kcal: number; training: boolean } | undefined {
  // Only the stored kcal matters here, so depend on that rather than the whole row — otherwise
  // every unrelated write to the target re-runs the comparison.
  const storedKcal = useLiveQuery(async () => (await getDailyTarget(date))?.kcal, [date]);
  const [state, setState] = useState<{ delta_kcal: number; training: boolean } | undefined>();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const flat = await flatTargetFor(date);
      if (cancelled) return;
      if (!flat || storedKcal == null) {
        setState(undefined);
        return;
      }
      setState({ delta_kcal: storedKcal - flat.kcal, training: storedKcal > flat.kcal });
    })();
    return () => {
      cancelled = true;
    };
  }, [date, storedKcal]);
  return state;
}

export function useExercisePR(exercise_id: string | undefined): ExercisePR | undefined {
  return useLiveQuery(async () => {
    if (!exercise_id) return undefined;
    return personalRecords(await recentSessions(), exercise_id);
  }, [exercise_id]);
}

/** Every session that touched one exercise, newest first, for its history screen. */
export function useExerciseHistory(exercise_id: string | undefined): WorkoutSession[] | undefined {
  return useLiveQuery(async () => {
    if (!exercise_id) return [];
    const all = await recentSessions();
    return all.filter((s) => s.entries.some((e) => e.exercise_id === exercise_id)).reverse();
  }, [exercise_id]);
}
