// SPEC §20.4 — what a set is worth.
//
// Two numbers come out of a logged set: the volume it added, and what it implies about a
// one-rep max. Both are used everywhere downstream — progression, PRs, the weekly muscle
// totals, the leaderboard — so both live here, pure and tested, rather than being recomputed
// slightly differently in three screens.
import type { LoadType, WorkoutEntry, WorkoutSession, WorkoutSet } from './types';

/**
 * Warm-ups are logged so the session reads correctly, but they are not work: counting them
 * would inflate volume by whatever someone's ramp happens to be, which varies far more between
 * people than their actual training does.
 */
export function isWorkingSet(s: WorkoutSet): boolean {
  return s.done && s.kind !== 'warmup';
}

/**
 * Kilograms moved by one set, or undefined when it cannot be known. Bodyweight work needs the
 * lifter's weight to mean anything, and "0" would be a lie rather than a gap — a set of twelve
 * pull-ups is not zero work. `sessionVolume` reports those separately instead of hiding them.
 */
export function setVolume(
  s: WorkoutSet,
  load_type: LoadType,
  bodyweight_kg?: number,
): number | undefined {
  if (!isWorkingSet(s)) return 0;
  const reps = s.reps ?? 0;
  switch (load_type) {
    case 'weight_reps':
      return (s.weight_kg ?? 0) * reps;
    case 'bodyweight_reps':
      return bodyweight_kg == null ? undefined : bodyweight_kg * reps;
    case 'weighted_bodyweight':
      return bodyweight_kg == null ? undefined : (bodyweight_kg + (s.weight_kg ?? 0)) * reps;
    // Time and distance carry no load, so they add nothing to a tonnage figure. They are not
    // "unknown" — they are genuinely zero kilograms.
    case 'time':
    case 'distance_time':
      return 0;
  }
}

export interface VolumeTotal {
  kg: number;
  /** Working sets whose load could not be known, because bodyweight was not supplied. */
  unknown_sets: number;
  working_sets: number;
  reps: number;
}

export function entryVolume(e: WorkoutEntry, bodyweight_kg?: number): VolumeTotal {
  let kg = 0;
  let unknown_sets = 0;
  let working_sets = 0;
  let reps = 0;
  for (const s of e.sets) {
    if (!isWorkingSet(s)) continue;
    working_sets++;
    reps += s.reps ?? 0;
    const v = setVolume(s, e.load_type, bodyweight_kg);
    if (v == null) unknown_sets++;
    else kg += v;
  }
  return { kg, unknown_sets, working_sets, reps };
}

export function sessionVolume(
  session: Pick<WorkoutSession, 'entries'>,
  bodyweight_kg?: number,
): VolumeTotal {
  const total: VolumeTotal = { kg: 0, unknown_sets: 0, working_sets: 0, reps: 0 };
  for (const e of session.entries) {
    const v = entryVolume(e, bodyweight_kg);
    total.kg += v.kg;
    total.unknown_sets += v.unknown_sets;
    total.working_sets += v.working_sets;
    total.reps += v.reps;
  }
  return total;
}

/**
 * Beyond about twelve reps a set stops predicting a one-rep max and starts measuring endurance:
 * the formulas disagree with each other by more than the number is worth, and Brzycki's
 * denominator heads for zero at 37. Above this, no estimate is offered rather than a bad one.
 */
export const E1RM_MAX_REPS = 12;

/**
 * Estimated one-rep max, as the mean of Epley and Brzycki.
 *
 * They are the two most validated formulas and they err in opposite directions — Epley reads
 * high at low reps, Brzycki low at high reps — so averaging is closer than either alone and,
 * more usefully, the gap between them is a live warning that the estimate is soft. A single
 * rep needs no formula: it is the max, and Epley would otherwise claim 103% of it.
 */
export function e1rm(weight_kg: number, reps: number): number | undefined {
  if (!Number.isFinite(weight_kg) || weight_kg <= 0) return undefined;
  if (!Number.isInteger(reps) || reps < 1 || reps > E1RM_MAX_REPS) return undefined;
  if (reps === 1) return weight_kg;
  const epley = weight_kg * (1 + reps / 30);
  const brzycki = (weight_kg * 36) / (37 - reps);
  return (epley + brzycki) / 2;
}

/** The best one-rep max any working set in an entry implies, if any of them can. */
export function bestE1rm(e: WorkoutEntry): number | undefined {
  // A plank has no one-rep max, and neither does a row on an erg. Without this guard a timed
  // set carrying leftover weight and reps fields would quietly produce one.
  if (e.load_type === 'time' || e.load_type === 'distance_time') return undefined;
  let best: number | undefined;
  for (const s of e.sets) {
    if (!isWorkingSet(s) || s.weight_kg == null || s.reps == null) continue;
    const est = e1rm(s.weight_kg, s.reps);
    if (est != null && (best == null || est > best)) best = est;
  }
  return best;
}

/** Seconds a session took, from its own timestamps rather than from a running clock. */
export function sessionDuration(s: Pick<WorkoutSession, 'started_at' | 'ended_at'>): number {
  if (!s.ended_at) return 0;
  const ms = new Date(s.ended_at).getTime() - new Date(s.started_at).getTime();
  return ms > 0 ? Math.round(ms / 1000) : 0;
}

/** A set with nothing in it yet: the row exists so it can be ticked, but it logged nothing. */
export function isEmptySet(s: WorkoutSet, load_type: LoadType): boolean {
  switch (load_type) {
    case 'weight_reps':
    case 'weighted_bodyweight':
      return (s.reps ?? 0) === 0 && (s.weight_kg ?? 0) === 0;
    case 'bodyweight_reps':
      return (s.reps ?? 0) === 0;
    case 'time':
      return (s.seconds ?? 0) === 0;
    case 'distance_time':
      return (s.seconds ?? 0) === 0 && (s.distance_m ?? 0) === 0;
  }
}
