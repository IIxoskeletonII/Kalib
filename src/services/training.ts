// SPEC §20.8 — turning the rules into the two answers a screen needs.
//
// Orchestration only. The rules live in core/progression.ts and core/trainingLoad.ts; this
// assembles the history, the rep ranges and the exercise catalogue they need, because none of
// those live on a logged session itself.
import { nextPrescription, performances, type Prescription } from '@/core/progression';
import { musclesCovered, trainingLoad, type LoadReport, type MuscleMap } from '@/core/trainingLoad';
import type { Exercise, Routine, WorkoutSession } from '@/core/types';
import { getExercises } from '@/db/repo/exercises';
import { getRoutine, listRoutines } from '@/db/repo/workouts';
import { recentSessions } from './workouts';

/** Days of history a prescription may look back over. Older than this and the lift has moved on. */
const HISTORY_DAYS = 180;

/** Enough to cover the current week whatever day it is asked on. */
const WEEK_LOOKBACK_DAYS = 14;

function muscleMap(exercises: ReadonlyMap<string, Exercise>): Map<string, MuscleMap> {
  const out = new Map<string, MuscleMap>();
  for (const [id, e] of exercises) {
    out.set(id, { primary_muscle: e.primary_muscle, secondary_muscles: e.secondary_muscles });
  }
  return out;
}

/**
 * What to do next on every exercise in a session.
 *
 * The rep range is the one thing a logged entry does not carry: it lives on the routine the
 * session came from. A session started from nothing therefore has no range to progress inside,
 * and `nextPrescription` says so rather than inventing one.
 */
export async function prescriptionsFor(
  session: Pick<WorkoutSession, 'id' | 'routine_id' | 'entries'>,
): Promise<Map<string, Prescription>> {
  const history = await recentSessions(HISTORY_DAYS);
  const routine = session.routine_id ? await getRoutine(session.routine_id) : undefined;

  const ranges = new Map<string, { rep_low?: number; rep_high?: number }>();
  for (const item of routine?.items ?? []) {
    ranges.set(item.exercise_id, {
      ...(item.rep_low != null ? { rep_low: item.rep_low } : {}),
      ...(item.rep_high != null ? { rep_high: item.rep_high } : {}),
    });
  }

  const out = new Map<string, Prescription>();
  for (const entry of session.entries) {
    if (out.has(entry.exercise_id)) continue;
    out.set(
      entry.exercise_id,
      nextPrescription(performances(history, entry.exercise_id, session.id), {
        load_type: entry.load_type,
        ...(ranges.get(entry.exercise_id) ?? {}),
      }),
    );
  }
  return out;
}

/**
 * This week's hard sets per muscle, against what the person's own routines mean to cover.
 *
 * The routines supply `expected` so that "untrained" means a gap in your own plan rather than a
 * gap against all nineteen muscles, which would flag a lifetime of them at anyone sensible.
 */
export async function weeklyLoad(): Promise<LoadReport> {
  const [sessions, routines] = await Promise.all([
    recentSessions(WEEK_LOOKBACK_DAYS),
    listRoutines(),
  ]);
  const ids = new Set<string>();
  for (const s of sessions) for (const e of s.entries) ids.add(e.exercise_id);
  for (const r of routines) for (const i of r.items) ids.add(i.exercise_id);

  const map = muscleMap(await getExercises([...ids]));
  const expected = musclesCovered(
    routines.flatMap((r: Routine) => r.items),
    map,
  );
  return trainingLoad(sessions, map, { expected });
}
