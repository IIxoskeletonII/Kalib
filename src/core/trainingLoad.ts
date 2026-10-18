// SPEC §20.8 — where the week is short.
//
// Progression answers "what do I do on this lift". This answers the question you cannot see
// from inside a single session: whether the week as a whole covers you. Hard sets per muscle per
// week is the dose that the hypertrophy literature actually measures, which makes it the honest
// unit here — not tonnage, which rewards squatting over pressing for reasons of leverage, and
// not session count, which says nothing about what was trained.
//
// Two numbers decide whether a muscle is covered: how many hard sets it got, and across how many
// days. Ten to twenty sets a week is the band where the evidence clusters, and spreading them
// over at least two days beats putting them all in one.
//
// Like everything else here, work that cannot be attributed is reported rather than dropped. An
// exercise the catalogue does not know is counted as unknown, not as zero.
import { toDateKey } from './dates';
import { isWorkingSet } from './sets';
import { weekStart } from './trainingWeek';
import type { Muscle, WorkoutSession } from './types';

/** Below this, a muscle is being maintained rather than trained. */
export const MIN_SETS = 10;

/** Above this the returns have flattened and the fatigue has not. */
export const MAX_SETS = 20;

/** Sets in a week want spreading over at least this many days. */
export const MIN_DAYS = 2;

/**
 * What a set counts for a muscle that assists rather than leads it.
 *
 * A row trains the lats directly and the biceps incidentally; counting both as one whole set
 * would have every pulling day reading as a full arm session. Half is the convention, and it is
 * a convention rather than a measurement, which is why the direct count is kept alongside it.
 */
export const SECONDARY_WEIGHT = 0.5;

/** What the catalogue knows about an exercise, which a logged entry does not carry itself. */
export interface MuscleMap {
  primary_muscle: Muscle;
  secondary_muscles?: Muscle[];
}

export interface MuscleLoad {
  muscle: Muscle;
  /** Primary sets plus half of the assisting ones. */
  sets: number;
  /** Sets where this muscle was the point of the exercise. */
  direct_sets: number;
  /** Separate calendar days it was trained. */
  days: number;
}

export interface LoadReport {
  /** The Monday the week is counted from, as a local calendar day. */
  from: string;
  /** Every muscle that got work, most worked first. */
  muscles: MuscleLoad[];
  /** Trained, but under the band. */
  under: Muscle[];
  /** Over the band. */
  over: Muscle[];
  /** Enough sets, but all crammed into too few days. */
  concentrated: Muscle[];
  /** Expected by the caller and not trained at all this week. */
  untrained: Muscle[];
  /** Working sets whose exercise is not in the catalogue, so they count towards nothing. */
  unknown_sets: number;
}

export interface LoadOptions {
  from?: Date;
  /**
   * Muscles the caller believes should be covered — normally the ones the person's own routines
   * target. Without it nothing is reported as untrained, because flagging all nineteen muscles
   * at someone who only ever meant to train five is noise, not advice.
   */
  expected?: readonly Muscle[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Hard sets per muscle for the week beginning `from`, from finished sessions only.
 *
 * A session still running is left out for the same reason the week totals leave it out: half a
 * session is not a session, and the figures should not move while you are standing in the gym
 * looking at them.
 */
export function trainingLoad(
  sessions: readonly WorkoutSession[],
  muscleOf: ReadonlyMap<string, MuscleMap>,
  opts: LoadOptions = {},
): LoadReport {
  const from = opts.from ?? weekStart();
  const since = from.getTime();

  const direct = new Map<Muscle, number>();
  const weighted = new Map<Muscle, number>();
  const days = new Map<Muscle, Set<string>>();
  let unknown_sets = 0;

  const bump = (m: Map<Muscle, number>, k: Muscle, n: number) => m.set(k, (m.get(k) ?? 0) + n);
  const trainedOn = (k: Muscle, day: string) => {
    const seen = days.get(k) ?? new Set<string>();
    seen.add(day);
    days.set(k, seen);
  };

  for (const session of sessions) {
    if (!session.ended_at) continue;
    const started = new Date(session.started_at);
    if (started.getTime() < since) continue;
    const day = toDateKey(started);

    for (const entry of session.entries) {
      const working = entry.sets.filter(isWorkingSet).length;
      if (working === 0) continue;
      const known = muscleOf.get(entry.exercise_id);
      if (!known) {
        unknown_sets += working;
        continue;
      }
      // Cardio is in the muscle union so an exercise can declare it, but it is not a muscle you
      // can give ten hard sets to, and counting it would put a rowing machine in a coverage gap.
      if (known.primary_muscle !== 'cardio') {
        bump(direct, known.primary_muscle, working);
        bump(weighted, known.primary_muscle, working);
        trainedOn(known.primary_muscle, day);
      }
      for (const m of known.secondary_muscles ?? []) {
        if (m === 'cardio' || m === known.primary_muscle) continue;
        bump(weighted, m, working * SECONDARY_WEIGHT);
        trainedOn(m, day);
      }
    }
  }

  const muscles: MuscleLoad[] = [...weighted.entries()]
    .map(([muscle, sets]) => ({
      muscle,
      sets: round1(sets),
      direct_sets: direct.get(muscle) ?? 0,
      days: days.get(muscle)?.size ?? 0,
    }))
    .sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle));

  const under = muscles.filter((m) => m.sets < MIN_SETS).map((m) => m.muscle);
  const over = muscles.filter((m) => m.sets > MAX_SETS).map((m) => m.muscle);
  const concentrated = muscles
    .filter((m) => m.sets >= MIN_SETS && m.days < MIN_DAYS)
    .map((m) => m.muscle);
  const trained = new Set(muscles.map((m) => m.muscle));
  const untrained = (opts.expected ?? []).filter((m) => m !== 'cardio' && !trained.has(m));

  return { from: toDateKey(from), muscles, under, over, concentrated, untrained, unknown_sets };
}

/** The muscles a set of routines means to cover, for `expected`. */
export function musclesCovered(
  items: readonly { exercise_id: string }[],
  muscleOf: ReadonlyMap<string, MuscleMap>,
): Muscle[] {
  const out = new Set<Muscle>();
  for (const it of items) {
    const known = muscleOf.get(it.exercise_id);
    if (known && known.primary_muscle !== 'cardio') out.add(known.primary_muscle);
  }
  return [...out].sort();
}
