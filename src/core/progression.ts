// SPEC §20.8 — what to do next.
//
// The Session screen already shows what you did last time, which tells you what to beat but not
// how. This turns it into an instruction. The rule is **double progression**: inside a rep range
// you add reps until every working set reaches the top of it, and only then add load and drop
// back to the bottom. Load and reps each go up, but never at the same time, so a session only
// ever asks one new thing of you.
//
// It is the right rule to automate because the evidence does not prefer either lever. Trials
// comparing load-increase with rep-increase find near-identical growth over eight weeks, so the
// choice is one of bookkeeping rather than of physiology — which is exactly the kind of choice a
// program should make for you.
//
// Nothing here guesses. Where the inputs do not support an instruction — a plank, a session with
// no rep range, an exercise never done before — it says so rather than inventing one.
import { isWorkingSet } from './sets';
import type { LoadType, WorkoutSet } from './types';

/**
 * Reps you mean to leave in the tank. Two sits inside the 0-3 band where the hypertrophy
 * evidence clusters, and far enough from failure that the next set is not compromised.
 */
export const TARGET_RIR = 2;

/** The smallest jump most gyms can actually make: two 1.25 kg plates. */
export const DEFAULT_INCREMENT_KG = 2.5;

/** Sessions stuck at one load, having never reached the top of the range, before backing off. */
export const STALL_SESSIONS = 3;

/** How far a deload drops the bar. Enough to feel easy, not so far the week is wasted. */
export const DELOAD_FRACTION = 0.1;

/** RIR this far above target means the set was stopped early: effort, not load, is the limit. */
export const SANDBAGGING_RIR = TARGET_RIR + 2;

export type ProgressionKind =
  'first_time' | 'add_load' | 'add_reps' | 'hold' | 'deload' | 'no_advice';

export type ProgressionReason =
  | 'no_history'
  | 'cleared_range'
  | 'inside_range'
  | 'missed_range'
  | 'left_reps_in_reserve'
  | 'stalled'
  | 'not_a_lift'
  | 'no_rep_range';

export interface Prescription {
  kind: ProgressionKind;
  reason: ProgressionReason;
  /** What to load, where there is a load to choose. */
  weight_kg?: number;
  /** Reps to reach on every working set. */
  reps?: number;
  /** What it was before, so a screen can show the change rather than just the answer. */
  from_weight_kg?: number;
  /** Only on a deload: how many sessions sat at the same load without clearing the range. */
  stalled_sessions?: number;
}

export interface ProgressionOptions {
  load_type: LoadType;
  rep_low?: number;
  rep_high?: number;
  target_rir?: number;
  increment_kg?: number;
}

/** One session's sets for one exercise. Callers pass sessions newest first. */
export type Performance = readonly WorkoutSet[];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Loads are chosen in whole increments; half a plate does not exist. */
function toIncrement(kg: number, increment: number): number {
  if (increment <= 0) return round2(kg);
  return round2(Math.round(kg / increment) * increment);
}

/**
 * The load the session was actually worked at.
 *
 * Not the heaviest set, because a top set followed by two back-offs would then be judged on a
 * weight only one set used. The modal weight is what "the working weight" means in practice,
 * and ties go to the heavier of them.
 */
export function workingLoad(sets: Performance): number | undefined {
  const counts = new Map<number, number>();
  for (const s of sets) {
    if (!isWorkingSet(s) || s.weight_kg == null) continue;
    counts.set(s.weight_kg, (counts.get(s.weight_kg) ?? 0) + 1);
  }
  let best: number | undefined;
  let bestCount = 0;
  for (const [kg, n] of counts) {
    if (n > bestCount || (n === bestCount && best != null && kg > best)) {
      best = kg;
      bestCount = n;
    }
  }
  return best;
}

/** The working sets performed at the working load — the ones the rule is judged on. */
function setsAtLoad(sets: Performance, load: number | undefined): WorkoutSet[] {
  return sets.filter((s) => isWorkingSet(s) && (load == null || s.weight_kg === load));
}

/**
 * Whether the top of the range was reached on every working set — the condition for adding load.
 * Every set, not the best one: clearing the range once and falling short twice is a session that
 * has not been earned yet.
 */
function cleared(sets: readonly WorkoutSet[], rep_high: number): boolean {
  return sets.length > 0 && sets.every((s) => (s.reps ?? 0) >= rep_high);
}

function lowestReps(sets: readonly WorkoutSet[]): number {
  return sets.reduce((m, s) => Math.min(m, s.reps ?? 0), Infinity);
}

/** The fewest reps left in the tank across the set, where it was recorded at all. */
function minRir(sets: readonly WorkoutSet[]): number | undefined {
  const rirs = sets.map((s) => s.rir).filter((r): r is number => r != null);
  return rirs.length ? Math.min(...rirs) : undefined;
}

/**
 * How many consecutive recent sessions were worked at `load` without ever clearing the range.
 * A session at a different load ends the run: the lift moved, so it is not stuck.
 */
function stalledFor(recent: readonly Performance[], load: number, rep_high: number): number {
  let n = 0;
  for (const perf of recent) {
    const at = workingLoad(perf);
    if (at !== load) break;
    if (cleared(setsAtLoad(perf, at), rep_high)) break;
    n++;
  }
  return n;
}

/**
 * What to do next for one exercise, from its recent sessions newest first.
 *
 * `recent` holds each session's sets for this exercise. Only working sets are considered, so a
 * caller may pass entries whole rather than filtering first.
 */
export function nextPrescription(
  recent: readonly Performance[],
  opts: ProgressionOptions,
): Prescription {
  const { load_type, rep_low, rep_high } = opts;
  const increment = opts.increment_kg ?? DEFAULT_INCREMENT_KG;

  // A plank and a row on an erg have no load-and-reps to trade off, so the rule does not reach
  // them. Saying so is better than pretending a time is a rep.
  if (load_type === 'time' || load_type === 'distance_time') {
    return { kind: 'no_advice', reason: 'not_a_lift' };
  }
  if (rep_low == null || rep_high == null || rep_high < rep_low) {
    return { kind: 'no_advice', reason: 'no_rep_range' };
  }

  const history = recent.filter((p) => p.some((s) => isWorkingSet(s)));
  const last = history[0];
  if (!last) return { kind: 'first_time', reason: 'no_history' };

  const load = workingLoad(last);
  const at = setsAtLoad(last, load);
  if (at.length === 0) return { kind: 'first_time', reason: 'no_history' };

  const hasLoad = load != null;
  const didClear = cleared(at, rep_high);

  // Stuck at one load for long enough that pushing again is unlikely to work. Backing off is the
  // way forward, so it is offered before the ordinary rules get a chance to say "hold" again.
  if (hasLoad && !didClear) {
    const stuck = stalledFor(history, load, rep_high);
    if (stuck >= STALL_SESSIONS) {
      return {
        kind: 'deload',
        reason: 'stalled',
        weight_kg: toIncrement(load * (1 - DELOAD_FRACTION), increment),
        reps: rep_low,
        from_weight_kg: load,
        stalled_sessions: stuck,
      };
    }
  }

  if (didClear) {
    // Bodyweight work has no bar to add to, so the range is the only lever there is: keep the
    // reps climbing rather than inventing a load the exercise cannot carry.
    if (!hasLoad || load_type === 'bodyweight_reps') {
      return { kind: 'add_reps', reason: 'cleared_range', reps: lowestReps(at) + 1 };
    }
    return {
      kind: 'add_load',
      reason: 'cleared_range',
      weight_kg: toIncrement(load + increment, increment),
      reps: rep_low,
      from_weight_kg: load,
    };
  }

  const low = lowestReps(at);
  const rir = minRir(at);
  // Short of the range while stopping well clear of failure is not a load problem. Dropping the
  // weight here would solve the wrong thing.
  const sandbagged = rir != null && rir >= SANDBAGGING_RIR;

  if (low >= rep_low) {
    return {
      kind: 'add_reps',
      reason: sandbagged ? 'left_reps_in_reserve' : 'inside_range',
      ...(hasLoad ? { weight_kg: load } : {}),
      reps: Math.min(rep_high, low + 1),
    };
  }

  return {
    kind: 'hold',
    reason: sandbagged ? 'left_reps_in_reserve' : 'missed_range',
    ...(hasLoad ? { weight_kg: load } : {}),
    reps: rep_low,
  };
}

/** Whether a prescription asks for more than last time, for a screen that wants to say so. */
export function isStepUp(p: Prescription): boolean {
  return p.kind === 'add_load' || p.kind === 'add_reps';
}
