// SPEC §20.18 — the balance of the routines, and applying a fix to one.
//
// Orchestration only. The arithmetic is core/balance.ts; this gathers what it needs — the
// routines, the exercises in them, and the strength library a fix may choose from — and writes
// a chosen fix back to the routine with a way to take it back.
import {
  applyTo,
  planBalance,
  suggestFixes,
  type BalanceExercise,
  type BalanceFix,
  type BalanceReport,
  type Frequency,
} from '@/core/balance';
import { cycleFrequency } from '@/core/schedule';
import type { Routine } from '@/core/types';
import { getExercises, listStrengthExercises } from '@/db/repo/exercises';
import { getRoutine, listRoutines, updateRoutine } from '@/db/repo/workouts';
import { getCycle, getPlan } from './schedule';

export interface Balance {
  report: BalanceReport;
  fixes: BalanceFix[];
  /** Whether routines were counted by a real schedule, or once a week each for want of one. */
  scheduled: boolean;
}

/**
 * How often each routine comes round in a week, from the training plan and the cycle (§20.17):
 * a four-routine cycle on three days is 0.75 a week each.
 *
 * Without a number of days, each routine is counted once a week — the honest default for a list
 * of routines with no days attached.
 */
export async function routineFrequency(
  routines?: readonly Routine[],
): Promise<Frequency | undefined> {
  const [plan, cycle] = await Promise.all([getPlan(), getCycle(routines)]);
  return cycleFrequency(cycle, plan.per_week);
}

/** Everything a fix may be chosen from, plus whatever the routines already use. */
async function catalogueFor(routines: readonly Routine[]): Promise<Map<string, BalanceExercise>> {
  const ids = [...new Set(routines.flatMap((r) => r.items.map((i) => i.exercise_id)))];
  const [known, strength] = await Promise.all([getExercises(ids), listStrengthExercises()]);
  const out = new Map<string, BalanceExercise>();
  for (const e of strength) out.set(e.id, e);
  // The routines' own exercises count whatever their category: a plank filed as stretching
  // still trains the abs it is in a routine for.
  for (const [id, e] of known) out.set(id, e);
  return out;
}

/** The planned balance of every routine, and the fixes worth offering. */
export async function balance(perWeek?: Frequency): Promise<Balance> {
  const routines = await listRoutines();
  const freq = perWeek ?? (await routineFrequency());
  const catalogue = await catalogueFor(routines);
  return {
    report: planBalance(routines, catalogue, freq),
    fixes: suggestFixes(routines, catalogue, freq ? { perWeek: freq } : {}),
    scheduled: freq != null,
  };
}

/** One routine on its own, as if done once a week: what that day trains. */
export async function routineBalance(routine_id: string): Promise<BalanceReport | undefined> {
  const r = await getRoutine(routine_id);
  if (!r) return undefined;
  return planBalance([r], await catalogueFor([r]));
}

/**
 * Writes a fix into its routine and returns the undo.
 *
 * Refuses when the routine has moved on since the fix was worked out: a swap whose slot now
 * holds a different exercise, or an add of something already there. Applying either anyway
 * would swap out the wrong thing or double an exercise.
 */
export async function applyFix(fix: BalanceFix): Promise<() => Promise<void>> {
  const r = await getRoutine(fix.routine_id);
  if (!r) throw new Error('That routine is no longer there.');
  if (fix.kind === 'swap' && r.items[fix.index]?.exercise_id !== fix.out.exercise_id) {
    throw new Error('That routine has changed since. Open it to swap by hand.');
  }
  if (fix.kind === 'add' && r.items.some((i) => i.exercise_id === fix.item.exercise_id)) {
    throw new Error(`${fix.item.name} is already in ${r.name}.`);
  }
  const previous = r.items;
  await updateRoutine(r.id, { items: applyTo(previous, fix) });
  return async () => {
    await updateRoutine(r.id, { items: previous });
  };
}
