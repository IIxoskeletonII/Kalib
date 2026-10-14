// SPEC §20.6 — what a session cost, and why that number is never spent.
//
// Read this before using the figure anywhere: **it is not added to the day's food budget.**
// Kalib's TDEE is measured from intake against weight trend (§4.5), which means the gym is
// already inside it. Adding an estimate on top would double-count and make the Kalman filter
// chase its own tail. Training changes *when* the week's calories are eaten (§20.7), never how
// many there are.
//
// The number is shown because people want it, and because it sizes that redistribution. It is
// deliberately presented as a range: a 2018 validation of seven devices found none met a 10%
// accuracy threshold for resistance training, and wrist trackers correlate with indirect
// calorimetry at r = 0.10–0.34 for lifting. Anyone printing a single confident figure for this
// is inventing precision.
import { isWorkingSet } from './sets';
import type { WorkoutEntry } from './types';

/**
 * The Adult Compendium of Physical Activities for resistance training: 3.5 light, 5.0 moderate,
 * 6.0 vigorous. These are population averages for the *activity*, not measurements of a person.
 */
export const MET_LIGHT = 3.5;
export const MET_VIGOROUS = 6.0;

/** A session left running overnight should not claim three thousand calories. */
export const MAX_COUNTED_SEC = 3 * 3600;

export interface WorkoutEnergyEstimate {
  /** Midpoint, rounded to the nearest 5 kcal: the data does not support a final digit. */
  kcal: number;
  /** The light-effort end, MET 3.5. */
  low: number;
  /** The vigorous end, MET 6.0. */
  high: number;
  /** The MET the midpoint used, from how densely the session was worked. */
  met: number;
  /** Minutes actually counted, after the overnight cap. */
  minutes: number;
}

/** 1 MET is roughly 1 kcal per kilogram per hour, which is the whole of the arithmetic. */
function kcalFor(met: number, bodyweight_kg: number, minutes: number): number {
  return met * bodyweight_kg * (minutes / 60);
}

/**
 * Energy for a finished session.
 *
 * Intensity comes from how densely it was worked — sets per minute — rather than from the
 * weight on the bar, because the cost of a set is dominated by how much of the hour was spent
 * moving rather than resting. Someone doing twenty sets in forty minutes is working near the
 * vigorous end; the same twenty sets across ninety minutes is not.
 */
export function workoutEnergy(o: {
  duration_sec: number;
  bodyweight_kg: number;
  entries: readonly WorkoutEntry[];
}): WorkoutEnergyEstimate {
  const seconds = Math.max(0, Math.min(MAX_COUNTED_SEC, o.duration_sec));
  const minutes = seconds / 60;
  if (minutes <= 0 || !(o.bodyweight_kg > 0)) {
    return { kcal: 0, low: 0, high: 0, met: MET_LIGHT, minutes: 0 };
  }

  let working = 0;
  for (const e of o.entries) for (const s of e.sets) if (isWorkingSet(s)) working++;

  // 0.15 sets a minute is a long-rest strength session; 0.40 is a brisk hypertrophy one.
  const density = working / minutes;
  const t = Math.min(1, Math.max(0, (density - 0.15) / (0.4 - 0.15)));
  const met = MET_LIGHT + t * (MET_VIGOROUS - MET_LIGHT);

  const round5 = (n: number) => Math.round(n / 5) * 5;
  return {
    kcal: round5(kcalFor(met, o.bodyweight_kg, minutes)),
    low: round5(kcalFor(MET_LIGHT, o.bodyweight_kg, minutes)),
    high: round5(kcalFor(MET_VIGOROUS, o.bodyweight_kg, minutes)),
    met: Math.round(met * 10) / 10,
    minutes: Math.round(minutes),
  };
}

/** "≈ 310 kcal, likely 250–430" — the honest way to show it. */
export function describeEnergy(e: WorkoutEnergyEstimate): string {
  return `${e.kcal} kcal, likely ${e.low}–${e.high}`;
}
