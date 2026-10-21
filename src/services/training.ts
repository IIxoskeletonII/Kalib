// SPEC §20.8 — turning the rules into the two answers a screen needs.
//
// Orchestration only. The rules live in core/progression.ts and core/trainingLoad.ts; this
// assembles the history, the rep ranges and the exercise catalogue they need, because none of
// those live on a logged session itself.
import { blockState, isEasyDay, liftSignals, withoutEasy, type BlockState } from '@/core/block';
import { todayKey, toDateKey } from '@/core/dates';
import {
  easyPrescription,
  nextPrescription,
  performances,
  type Prescription,
} from '@/core/progression';
import { musclesCovered, trainingLoad, type LoadReport, type MuscleMap } from '@/core/trainingLoad';
import type { Exercise, Routine, WorkoutSession } from '@/core/types';
import { getExercises } from '@/db/repo/exercises';
import { getSetting } from '@/db/repo/settings';
import { getRoutine, listRoutines } from '@/db/repo/workouts';
import { BLOCK_RESET_KEY, getEasyWeeks } from './block';
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
  session: Pick<WorkoutSession, 'id' | 'routine_id' | 'entries'> & { started_at?: string },
): Promise<Map<string, Prescription>> {
  // Easier-week sessions are invisible to progression (§20.12): their short sets are what was
  // asked, not a stall, and the week after resumes from the training before it.
  const weeks = await getEasyWeeks();
  const history = withoutEasy(await recentSessions(HISTORY_DAYS), weeks);
  const day = session.started_at ? toDateKey(new Date(session.started_at)) : todayKey();
  const easy = isEasyDay(day, weeks);
  const rule = easy ? easyPrescription : nextPrescription;
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
      rule(performances(history, entry.exercise_id, session.id), {
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

/** Rep ranges by exercise, from every routine; the first routine to name an exercise wins. */
function allRanges(
  routines: readonly Routine[],
): Map<string, { rep_low?: number; rep_high?: number }> {
  const out = new Map<string, { rep_low?: number; rep_high?: number }>();
  for (const r of routines) {
    for (const i of r.items) {
      if (out.has(i.exercise_id)) continue;
      out.set(i.exercise_id, {
        ...(i.rep_low != null ? { rep_low: i.rep_low } : {}),
        ...(i.rep_high != null ? { rep_high: i.rep_high } : {}),
      });
    }
  }
  return out;
}

/** Where you are in a block, and whether an easier week is due (§20.12). */
export async function currentBlock(today = todayKey()): Promise<BlockState> {
  const [sessions, routines, easyWeeks, resetOn] = await Promise.all([
    recentSessions(),
    listRoutines(),
    getEasyWeeks(),
    getSetting<string | null>(BLOCK_RESET_KEY),
  ]);
  const signals = liftSignals(withoutEasy(sessions, easyWeeks), allRanges(routines), today);
  return blockState({
    sessions,
    easyWeeks,
    signals,
    today,
    ...(resetOn ? { resetOn } : {}),
  });
}
