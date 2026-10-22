// SPEC §20.17 — the training plan, stored once and read everywhere.
//
// Two settings, both synced: the days (`training:plan`) and the cycle (`training:cycle`). They
// are kept apart so a change of days on one phone and a change of cycle on another both survive
// last-write-wins sync.
//
// The days are the one number of the app's training: choosing Monday, Wednesday and Friday sets
// the streak's weekly aim to three from this week on (§20.15, which keeps the history so weeks
// already over are never rewritten), and through it the circle's planned days (§21); and the
// energy bridge (§20.7) leans toward those weekdays instead of guessing them. Nothing else holds
// its own copy.
import { todayKey, toDateKey } from '@/core/dates';
import { nextRoutine, type NextRoutine } from '@/core/rotation';
import {
  alternatingCycle,
  cleanCycle,
  cleanPlan,
  effectiveCycle,
  EMPTY_PLAN,
  flexiblePlan,
  isDefaultCycle,
  missedMove,
  mondayOfKey,
  projectSchedule,
  splitKind,
  storeCycle,
  upcomingSlots,
  type ScheduleDay,
  type SplitKind,
  type StoredCycle,
  type TrainingPlan,
} from '@/core/schedule';
import { estimateMinutes, routineMuscles, totalSets } from '@/core/routineSummary';
import { aimSetFor } from '@/core/streak';
import type { Muscle, Routine } from '@/core/types';
import { getExercises } from '@/db/repo/exercises';
import { getSetting, setSetting } from '@/db/repo/settings';
import { listRoutines, listSessions } from '@/db/repo/workouts';
import { getAims, setAim } from './momentum';
import { defaultRestSec } from './workouts';

export const TRAINING_PLAN_KEY = 'training:plan';
export const CYCLE_KEY = 'training:cycle';

/** Two weeks: this one, and the next, so Friday can see Monday. */
export const SCHEDULE_DAYS = 14;

/**
 * The plan in force. Someone who set a weekly aim before there were days to choose (§20.15)
 * has that aim as a count with no fixed days, so nothing they chose is lost.
 */
export async function getPlan(today = todayKey()): Promise<TrainingPlan> {
  const stored = await getSetting<unknown>(TRAINING_PLAN_KEY);
  if (stored != null) return cleanPlan(stored);
  const aim = aimSetFor(mondayOfKey(today), await getAims());
  return aim == null ? EMPTY_PLAN : flexiblePlan(aim);
}

/**
 * Stores the plan, and the aim with it: fixed days or a count set the aim from this week, Auto
 * hands it back to the app. Weeks already over keep the aim they had.
 */
export async function setPlan(plan: TrainingPlan, today = todayKey()): Promise<void> {
  const clean = cleanPlan(plan);
  await setSetting(TRAINING_PLAN_KEY, clean);
  await setAim(clean.per_week, today);
}

export async function getStoredCycle(): Promise<StoredCycle | undefined> {
  return cleanCycle(await getSetting<unknown>(CYCLE_KEY));
}

/** The routines' ids in the order they come round, for the routines there are now. */
export async function getCycle(routines?: readonly Routine[]): Promise<string[]> {
  return effectiveCycle(await getStoredCycle(), routines ?? (await listRoutines()));
}

export async function setCycle(slots: readonly string[]): Promise<void> {
  await setSetting(CYCLE_KEY, storeCycle(slots, await listRoutines()));
}

/** Back to the list in order, each once: the cycle as if never edited. */
export async function resetCycle(): Promise<void> {
  await setSetting(CYCLE_KEY, null);
}

/** Puts a stored cycle back exactly, for an Undo. */
export async function restoreCycle(stored: StoredCycle | undefined): Promise<void> {
  await setSetting(CYCLE_KEY, stored ?? null);
}

/** What a routine card on Train says about a routine, without opening it. */
export interface RoutineFacts {
  /** Primary muscles, most sets first, at most three. */
  muscles: Muscle[];
  exercises: number;
  sets: number;
  minutes: number;
  /** The first few exercises' pictures, to put a face on the routine. */
  thumbs: { media: string; name: string }[];
  /** The day it was last finished, from the sessions themselves. */
  last_done?: string;
}

export interface Schedule {
  plan: TrainingPlan;
  routines: Routine[];
  /** Routine ids in the order they come round. */
  cycle: string[];
  /** Whether that is just the list in order. */
  cycle_is_default: boolean;
  /** Fourteen days from this week's Monday, with what happened and what is expected. */
  days: ScheduleDay[];
  /** The next few routines, for a plan with no fixed days. */
  upcoming: { index: number; routine_id: string }[];
  next?: NextRoutine;
  missed?: { missed: string; moved_to: string; routine_id: string };
  /** What kind of day each routine is, for labelling and for the suggestion. */
  kinds: Record<string, SplitKind>;
  /** A cycle that alternates variants (§20.17), when it differs from the one in force. */
  suggestion?: string[];
  facts: Record<string, RoutineFacts>;
  today: string;
}

export async function schedule(today = todayKey()): Promise<Schedule> {
  const [plan, routines, sessions, stored, rest] = await Promise.all([
    getPlan(today),
    listRoutines(),
    listSessions(),
    getStoredCycle(),
    defaultRestSec(),
  ]);
  const cycle = effectiveCycle(stored, routines);
  const exercises = await getExercises(routines.flatMap((r) => r.items.map((i) => i.exercise_id)));
  const primaryOf = (id: string) => exercises.get(id)?.primary_muscle;
  const kinds: Record<string, SplitKind> = {};
  for (const r of routines) kinds[r.id] = splitKind(r.items, primaryOf);

  const lastDone = new Map<string, string>();
  for (const s of sessions) {
    if (!s.routine_id) continue;
    const day = toDateKey(new Date(s.started_at));
    if ((lastDone.get(s.routine_id) ?? '') < day) lastDone.set(s.routine_id, day);
  }
  const facts: Record<string, RoutineFacts> = {};
  for (const r of routines) {
    const thumbs: { media: string; name: string }[] = [];
    for (const i of r.items) {
      const e = exercises.get(i.exercise_id);
      if (e?.media && !thumbs.some((t) => t.media === e.media)) {
        thumbs.push({ media: e.media, name: e.name });
      }
      if (thumbs.length === 4) break;
    }
    const last = lastDone.get(r.id);
    facts[r.id] = {
      muscles: routineMuscles(r.items, primaryOf)
        .slice(0, 3)
        .map((m) => m.muscle),
      exercises: r.items.length,
      sets: totalSets(r.items),
      minutes: estimateMinutes(r.items, rest),
      thumbs,
      ...(last ? { last_done: last } : {}),
    };
  }

  const days = projectSchedule({
    cycle,
    weekdays: plan.weekdays,
    sessions,
    from: mondayOfKey(today),
    days: SCHEDULE_DAYS,
    today,
  });
  const suggested = alternatingCycle(routines, (id) => kinds[id] ?? 'other');
  const differs =
    suggested != null &&
    (suggested.length !== cycle.length || suggested.some((id, i) => cycle[i] !== id));
  const next = nextRoutine(routines, sessions, new Date(`${today}T12:00:00`), cycle);
  const missed = missedMove(days, today);

  return {
    plan,
    routines,
    cycle,
    cycle_is_default: isDefaultCycle(cycle, routines),
    days,
    upcoming: upcomingSlots(cycle, sessions, Math.max(3, Math.min(6, cycle.length))),
    ...(next ? { next } : {}),
    ...(missed ? { missed } : {}),
    kinds,
    ...(differs ? { suggestion: suggested } : {}),
    facts,
    today,
  };
}
