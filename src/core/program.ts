// SPEC §20.9 — building a week.
//
// Progression (§20.8) answers what to do on a lift you already train, and training load says
// where the week is short. This writes the week in the first place.
//
// The shape of a split is usually argued about as taste. It is not entirely: **frequency is the
// part the evidence is clear on**, and a muscle trained twice a week beats the same number of
// sets trained once. That single fact decides most of what follows, and it is why three days
// here is three full-body days rather than push/pull/legs. PPL on three days is the common
// default and it gives every muscle exactly one session a week, which is the thing the evidence
// says not to do. On six days PPL is right, because then it is twice.
//
// Volume follows frequency: a weekly target per muscle, inside the 10-20 band §20.8 uses,
// divided across the days that muscle appears on.
//
// Exercises are then chosen greedily — the movement that closes the most of the day's remaining
// deficit wins, which naturally puts compounds first and leaves isolation to fill what they
// miss, because that is what compounds do rather than because they were hardcoded to rank
// higher.
import { MUSCLE_REGIONS } from './muscles';
import type { ExerciseCategory, ExerciseDifficulty, LoadType, Muscle, RoutineItem } from './types';

/** Inside §20.8's band, and the dose most general programs land on. */
export const WEEKLY_SETS = 12;

/** Every muscle, every week, at least this often. The whole shape of the split follows. */
export const MIN_FREQUENCY = 2;

/** Working sets per exercise. Three is the figure almost every program converges on. */
export const SETS_PER_EXERCISE = 3;

/** An assisting muscle gets half credit, exactly as `trainingLoad` counts it. */
const SECONDARY_WEIGHT = 0.5;

/**
 * How many assisting muscles one exercise may be paid for.
 *
 * Without this the generator picks whatever the library has described most generously. A
 * strongman car flip lists six assisting muscles and therefore outscored a bench press by
 * half again, which is how it ended up in a beginner's full-body day. Two is as many as a
 * movement meaningfully trains alongside its own; past that the list is describing anatomy
 * rather than training.
 */
const MAX_SECONDARY_CREDIT = 2;

/**
 * Secondary muscles that make a movement a compound, for reps and rest.
 *
 * It cannot be "has any", because only 30 of the library's 1,394 exercises have none — a
 * barbell curl lists the forearms. Two is the line where it is genuinely a multi-joint lift.
 */
const COMPOUND_SECONDARIES = 2;

/** Beyond this a session stops being a session and starts being an afternoon. */
export const MAX_EXERCISES_PER_DAY = 9;

/** Sets one exercise may be given once leftover volume is distributed. */
export const MAX_SETS_PER_EXERCISE = 5;

/**
 * The kit a program may assume, in preference order.
 *
 * The library has 1,394 exercises across 25 kinds of equipment, and the tail of it is a tyre,
 * a bosu ball and a skierg. These nine cover 1,229 of them and are what a gym actually has, so
 * they are the default; anything else is available by asking for it. Order matters only as a
 * tie-break, for when two movements are worth the same and one of them needs a sled.
 */
export const STAPLE_EQUIPMENT: readonly string[] = [
  'barbell',
  'dumbbell',
  'cable',
  'leverage machine',
  'body weight',
  'smith machine',
  'ez barbell',
  'kettlebell',
  'band',
];

/**
 * Filed as strength, and not something to put in a program. The library's boxing drills list
 * shoulders as their primary muscle, so on a body-weight week a left hook was written in as the
 * shoulder work.
 */
const NOT_PROGRAMMED = /\bboxing\b/i;

const DIFFICULTY_RANK: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };

const REGION = Object.fromEntries(MUSCLE_REGIONS.map((r) => [r.label, r.muscles])) as Record<
  'Push' | 'Pull' | 'Legs' | 'Core',
  readonly Muscle[]
>;

/**
 * The muscles a general program trains **on purpose**.
 *
 * Deliberately not all nineteen. Forearms, traps, lower back, obliques, adductors and
 * abductors are all trained by movements that already appear — a row works the traps, a squat
 * and a deadlift work the lower back and the adductors — and programming them directly is a
 * choice someone makes, not a default a generator should impose. Neck and cardio are not
 * hypertrophy targets at all.
 *
 * The list matters because it is what the frequency guarantee is made over, and a guarantee
 * made over muscles nobody programs directly is one that fails for the wrong reason: a
 * full-body day owing fourteen muscles cannot honour it in a session anyone would finish.
 */
export const PROGRAMMED: readonly Muscle[] = [
  'chest',
  'shoulders',
  'triceps',
  'lats',
  'upper back',
  'biceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'abs',
];

const inProgram = (m: Muscle) => PROGRAMMED.includes(m);
const UPPER = [...REGION.Push, ...REGION.Pull].filter(inProgram);
const LOWER = [...REGION.Legs, ...REGION.Core].filter(inProgram);

interface DayPlan {
  name: string;
  muscles: readonly Muscle[];
}

const FULL: DayPlan = { name: 'Full body', muscles: PROGRAMMED };
const DAY = {
  upper: { name: 'Upper', muscles: UPPER } as DayPlan,
  lower: { name: 'Lower', muscles: LOWER } as DayPlan,
  push: { name: 'Push', muscles: REGION.Push.filter(inProgram) } as DayPlan,
  pull: { name: 'Pull', muscles: REGION.Pull.filter(inProgram) } as DayPlan,
  legs: { name: 'Legs', muscles: LOWER } as DayPlan,
};

/**
 * Which days a week looks like, at each number of sessions.
 *
 * Every one of these gives every programmed muscle at least `MIN_FREQUENCY` sessions. That is
 * the constraint these were built against, not an accident of taste.
 */
const SPLITS: Record<number, readonly DayPlan[]> = {
  2: [FULL, FULL],
  3: [FULL, FULL, FULL],
  4: [DAY.upper, DAY.lower, DAY.upper, DAY.lower],
  5: [DAY.upper, DAY.lower, DAY.push, DAY.pull, DAY.legs],
  6: [DAY.push, DAY.pull, DAY.legs, DAY.push, DAY.pull, DAY.legs],
};

/**
 * The movements a program is actually written from.
 *
 * This list is the hardest-won part of the module and the least clever. The catalogue has
 * 1,394 exercises and no notion of which of them anyone programs: difficulty does not
 * separate a bench press from a boxing uppercut, and equipment does not separate a squat from
 * a groin kick. Scored on muscles covered alone, the generator reliably picked the library's
 * oddest entries, because an exercise that claims six assisting muscles outscores one that
 * claims two. The first honest output of this module was a full-body day opening with a
 * strongman car flip.
 *
 * So the staples are named. Three or four per muscle, every one of them a movement someone
 * would recognise, all verified present in the library. They are a preference rather than a
 * filter: restrict the equipment far enough and the generator falls back to scoring the rest
 * of the catalogue, which is the right behaviour for a hotel gym and the wrong default.
 *
 * A generated program remains a starting point. It is written into editable routines on
 * purpose, and swapping a movement is two taps.
 */
export const STAPLES: Partial<Record<Muscle, readonly string[]>> = {
  chest: ['Barbell Bench Press', 'Dumbbell Bench Press', 'Barbell Incline Bench Press', 'Push-Up'],
  lats: [
    'Pull-Up',
    'Cable Bar Lateral Pulldown',
    'Barbell Bent Over Row',
    'Dumbbell One Arm Bent-Over Row',
  ],
  'upper back': ['Cable Seated Row', 'Lever Seated Row', 'Dumbbell Reverse Fly'],
  shoulders: [
    'Barbell Standing Overhead Press',
    'Dumbbell Seated Shoulder Press',
    'Dumbbell Lateral Raise',
  ],
  triceps: ['Cable Pushdown', 'Dumbbell Lying Triceps Extension', 'Triceps Dip'],
  biceps: ['Barbell Curl', 'Dumbbell Biceps Curl', 'Cable Curl'],
  quads: ['Barbell Full Squat', 'Dumbbell Goblet Squat', 'Lever Leg Extension'],
  hamstrings: ['Barbell Romanian Deadlift', 'Lever Lying Leg Curl', 'Lever Seated Leg Curl'],
  glutes: ['Barbell Glute Bridge', 'Barbell Lunge', 'Dumbbell Lunge'],
  calves: ['Lever Standing Calf Raise', 'Lever Seated Calf Raise', 'Dumbbell Standing Calf Raise'],
  abs: ['Hanging Leg Raise', 'Cable Kneeling Crunch', '3/4 Sit-Up'],
};

/**
 * The same, for a floor and a doorframe.
 *
 * A second tier rather than more entries in the first: in a full gym a body-weight squat must
 * never edge out a goblet squat on a tie-break, and in a living room the alternative to these
 * was the fallback scoring, which wrote "One Arm Against Wall" in as the leg work and "Kick Out
 * Sit" as the quads. Every name verified present and not marked advanced.
 *
 * Shoulders and biceps have one entry each and both need a band, and that is not an oversight.
 * The library has no pike push-up, and nothing body-weight-only that trains either muscle as
 * its own movement; rather than name the least bad option as though it were a staple, the
 * program reports those muscles as `improvised` and the screen says so.
 */
export const HOME_STAPLES: Partial<Record<Muscle, readonly string[]>> = {
  chest: ['Push-Up', 'Incline Push-Up', 'Decline Push-Up'],
  lats: ['Chin-Up', 'Band Assisted Pull-Up'],
  'upper back': ['Inverted Row', 'Band One Arm Standing Low Row'],
  shoulders: ['Band Shoulder Press'],
  triceps: ['Triceps Dip', 'Diamond Push-Up', 'Close-Grip Push-Up'],
  biceps: ['Band Alternating Biceps Curl'],
  quads: ['Quads (bodyweight Squat)', 'Split Squats'],
  hamstrings: [
    'Self Assisted Inverse Leg Curl (Hands on Bench)',
    'Inverse Leg Curl (bench Support)',
  ],
  glutes: ['Forward Lunge', 'Low Glute Bridge On Floor'],
  calves: ['Bodyweight Standing Calf Raise'],
  abs: ['Crunch Floor', 'Reverse Crunch'],
};

const namesOf = (t: Partial<Record<Muscle, readonly string[]>>) =>
  new Set(
    Object.values(t)
      .flat()
      .map((n) => (n as string).toLowerCase()),
  );
const STAPLE_NAMES = namesOf(STAPLES);
const HOME_STAPLE_NAMES = namesOf(HOME_STAPLES);

/** Whether this is one of the named movements, rather than merely something that scores. */
export function isStaple(e: { name: string }): boolean {
  return STAPLE_NAMES.has(e.name.toLowerCase());
}

/** 2 for a gym staple, 1 for a home one, 0 for anything the scoring found on its own. */
export function stapleTier(e: { name: string }): number {
  const n = e.name.toLowerCase();
  return STAPLE_NAMES.has(n) ? 2 : HOME_STAPLE_NAMES.has(n) ? 1 : 0;
}

/**
 * What someone has to train with, as three answers rather than nine switches.
 *
 * Nine equipment toggles is 511 combinations, and the only ones anyone has checked the output
 * of are these. A person knows whether they are in a gym, at home with dumbbells, or on a
 * floor; they do not know whether their week depends on the smith machine.
 */
export type Kit = 'gym' | 'dumbbells' | 'bodyweight';

export const KITS: Record<Kit, { label: string; equipment: readonly string[] }> = {
  gym: { label: 'Gym', equipment: STAPLE_EQUIPMENT },
  dumbbells: { label: 'Dumbbells', equipment: ['dumbbell', 'body weight', 'band'] },
  bodyweight: { label: 'Body weight', equipment: ['body weight'] },
};

export const MIN_DAYS = 2;
export const MAX_DAYS = 6;

/** What the catalogue must tell us about an exercise for it to be programmable. */
export interface ProgramExercise {
  id: string;
  name: string;
  primary_muscle: Muscle;
  secondary_muscles?: Muscle[];
  equipment: string;
  load_type: LoadType;
  category: ExerciseCategory;
  difficulty?: ExerciseDifficulty;
}

export interface ProgramDay {
  /** 'Full body A', 'Upper B' — lettered only when the same day appears more than once. */
  name: string;
  items: RoutineItem[];
  /** The muscles this day actually trains, assisting ones included. */
  muscles: Muscle[];
}

export interface Program {
  days: ProgramDay[];
  /** Planned sets per muscle for the week, so the result can be checked against §20.8's band. */
  weekly: { muscle: Muscle; sets: number }[];
  /** Programmed muscles the catalogue could not cover with the equipment allowed. */
  uncovered: Muscle[];
  /**
   * Covered, but only by a movement the scoring found rather than one that was named — worth
   * a look before the first session, because that is where "Kick Out Sit" comes from.
   */
  improvised: Muscle[];
}

export interface ProgramOptions {
  /** Sessions a week, 2 to 6. */
  days: number;
  /** Equipment to use. Omitted means everything the catalogue has. */
  equipment?: readonly string[];
  /** Weekly sets per muscle. Defaults to `WEEKLY_SETS`. */
  weeklySets?: number;
  /**
   * Include movements the library marks advanced. Off by default: a generated program is the
   * one nobody chose exercise by exercise, so it should not open with a muscle-up.
   */
  advanced?: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Lexicographic, higher wins at the first key that differs. */
function isBetter(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (Math.abs(x - y) > 1e-9) return x > y;
  }
  return false;
}

/** A compound earns longer rest and lower reps; an isolation does not need either. */
function prescriptionFor(
  e: ProgramExercise,
): Pick<RoutineItem, 'rep_low' | 'rep_high' | 'rest_sec'> {
  const compound = (e.secondary_muscles ?? []).length >= COMPOUND_SECONDARIES;
  return compound
    ? { rep_low: 6, rep_high: 10, rest_sec: 180 }
    : { rep_low: 10, rep_high: 15, rest_sec: 90 };
}

/** What one exercise contributes, per muscle, if it is given `SETS_PER_EXERCISE` sets. */
function contribution(e: ProgramExercise): Map<Muscle, number> {
  const out = new Map<Muscle, number>([[e.primary_muscle, SETS_PER_EXERCISE]]);
  for (const m of e.secondary_muscles ?? []) {
    if (m === e.primary_muscle || out.size > MAX_SECONDARY_CREDIT) continue;
    out.set(m, SETS_PER_EXERCISE * SECONDARY_WEIGHT);
  }
  return out;
}

/**
 * A week of sessions covering every programmed muscle.
 *
 * Deterministic: the same catalogue and options give the same program, so it can be tested and
 * so regenerating does not silently reshuffle someone's training.
 */
export function buildProgram(catalogue: readonly ProgramExercise[], opts: ProgramOptions): Program {
  const days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(opts.days)));
  const target = opts.weeklySets ?? WEEKLY_SETS;
  const allowed = new Set((opts.equipment ?? STAPLE_EQUIPMENT).map((s) => s.toLowerCase()));
  const rank = (e: ProgramExercise) => {
    const kit = STAPLE_EQUIPMENT.indexOf(e.equipment.toLowerCase());
    return (DIFFICULTY_RANK[e.difficulty ?? 'intermediate'] ?? 1) * 100 + (kit < 0 ? 99 : kit);
  };

  // Only strength work is programmed. A stretch is not a set, and a program that offered one
  // in place of a row would be covering a muscle on paper only.
  const usable = catalogue
    .filter((e) => e.category === 'strength')
    .filter((e) => opts.advanced === true || e.difficulty !== 'advanced')
    .filter((e) => !NOT_PROGRAMMED.test(e.name))
    .filter((e) => allowed.has(e.equipment.toLowerCase()))
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const plans = SPLITS[days] ?? SPLITS[3]!;

  // How often each muscle comes round, so a weekly target can be split across its days.
  const appearances = new Map<Muscle, number>();
  for (const p of plans) {
    for (const m of p.muscles) appearances.set(m, (appearances.get(m) ?? 0) + 1);
  }

  // 'Full body' three times over is 'Full body A/B/C'; 'Upper' once is just 'Upper'.
  const seen = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const p of plans) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);

  const weekly = new Map<Muscle, number>();
  const usedThisWeek = new Map<string, number>();
  const out: ProgramDay[] = [];

  for (const plan of plans) {
    const n = (seen.get(plan.name) ?? 0) + 1;
    seen.set(plan.name, n);
    const name =
      (counts.get(plan.name) ?? 1) > 1 ? `${plan.name} ${String.fromCharCode(64 + n)}` : plan.name;

    // What this day owes each of its muscles.
    const owed = new Map<Muscle, number>();
    for (const m of plan.muscles) owed.set(m, target / (appearances.get(m) ?? 1));

    const items: RoutineItem[] = [];
    const usedToday = new Set<string>();
    const hitToday = new Set<Muscle>();
    const primariesToday = new Set<Muscle>();

    // One movement per muscle the day trains, taking whichever muscle is furthest behind for
    // the week first. Ranking on muscles-touched instead looks clever and is not: a bench
    // press and a pulldown between them touch all six upper-body muscles, so the day stopped
    // at two exercises and left the biceps on four sets a week. Incidental work is not
    // training, and a muscle wants a movement of its own.
    while (items.length < MAX_EXERCISES_PER_DAY) {
      let best: ProgramExercise | undefined;
      let bestKey: number[] | undefined;

      for (const e of usable) {
        if (usedToday.has(e.id)) continue;
        const m = e.primary_muscle;
        if (!owed.has(m) || primariesToday.has(m)) continue;
        const behind = target - (weekly.get(m) ?? 0);
        if (behind <= 0) continue;

        let value = 0;
        for (const [mm, c] of contribution(e)) if (owed.has(mm)) value += c;

        // Lexicographic, most significant first: a named movement, then the muscle furthest
        // behind for the week, then a gym staple over a home one, then how much of the day it
        // closes, then the movement seen least this week, then the plainest kit. Each only
        // decides what the last left tied.
        //
        // Named-at-all comes before neediness but the tier comes after it. With the tier first,
        // a dumbbell week never reached the lats: their only staple there is a chin-up, a home
        // one, and every gym staple outranked it however far behind the lats had fallen.
        const tier = stapleTier(e);
        const key = [
          tier > 0 ? 1 : 0,
          behind,
          tier,
          value,
          -(usedThisWeek.get(e.id) ?? 0),
          -rank(e),
        ];
        if (bestKey === undefined || isBetter(key, bestKey)) {
          best = e;
          bestKey = key;
        }
      }

      if (!best) break;
      usedToday.add(best.id);
      usedThisWeek.set(best.id, (usedThisWeek.get(best.id) ?? 0) + 1);
      primariesToday.add(best.primary_muscle);
      for (const [m, c] of contribution(best)) {
        if (owed.has(m)) owed.set(m, (owed.get(m) ?? 0) - c);
        weekly.set(m, (weekly.get(m) ?? 0) + c);
        hitToday.add(m);
      }
      items.push({
        exercise_id: best.id,
        name: best.name,
        load_type: best.load_type,
        sets: SETS_PER_EXERCISE,
        ...prescriptionFor(best),
      });
    }

    // Volume still owed becomes sets on what is already there. A muscle short of its share
    // wants more of the movement chosen for it, not a second movement for the same muscle.
    for (const item of items) {
      const m = usable.find((e) => e.id === item.exercise_id)?.primary_muscle;
      if (m == null) continue;
      const short = owed.get(m) ?? 0;
      if (short <= 0) continue;
      const extra = Math.min(Math.ceil(short / 1), MAX_SETS_PER_EXERCISE - item.sets);
      if (extra > 0) {
        item.sets += extra;
        owed.set(m, short - extra);
        weekly.set(m, (weekly.get(m) ?? 0) + extra);
      }
    }

    out.push({ name, items, muscles: [...hitToday].sort() });
  }

  const uncovered = PROGRAMMED.filter((m) => (weekly.get(m) ?? 0) <= 0);

  const byId = new Map(usable.map((e) => [e.id, e]));
  const named = new Set<Muscle>();
  const given = new Set<Muscle>();
  for (const day of out) {
    for (const item of day.items) {
      const e = byId.get(item.exercise_id);
      if (!e) continue;
      given.add(e.primary_muscle);
      if (stapleTier(e) > 0) named.add(e.primary_muscle);
    }
  }
  const improvised = PROGRAMMED.filter((m) => given.has(m) && !named.has(m));

  return {
    days: out,
    weekly: [...weekly.entries()]
      .map(([muscle, sets]) => ({ muscle, sets: round1(sets) }))
      .sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle)),
    uncovered,
    improvised,
  };
}

/**
 * Sessions per week each muscle gets.
 *
 * The property worth checking, and the one the splits were chosen for: nothing programmed
 * should come round fewer than `MIN_FREQUENCY` times.
 */
export function frequencyOf(program: Program): Map<Muscle, number> {
  const out = new Map<Muscle, number>();
  for (const day of program.days) {
    for (const m of day.muscles) out.set(m, (out.get(m) ?? 0) + 1);
  }
  return out;
}

/**
 * The week in one line's worth of numbers: how often the least-trained muscle comes round, and
 * the range of weekly sets. Over the programmed muscles only, because those are what the
 * program promises; a forearm getting four incidental sets is not a shortfall.
 */
export function summarise(program: Program): {
  minFrequency: number;
  minSets: number;
  maxSets: number;
} {
  const freq = frequencyOf(program);
  const sets = new Map(program.weekly.map((w) => [w.muscle, w.sets]));
  const covered = PROGRAMMED.filter((m) => !program.uncovered.includes(m));
  if (covered.length === 0) return { minFrequency: 0, minSets: 0, maxSets: 0 };
  return {
    minFrequency: Math.min(...covered.map((m) => freq.get(m) ?? 0)),
    minSets: Math.min(...covered.map((m) => sets.get(m) ?? 0)),
    maxSets: Math.max(...covered.map((m) => sets.get(m) ?? 0)),
  };
}
