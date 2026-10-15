// SPEC §20.7 — moving the week's calories toward the days you train.
//
// **The week's total never changes.** That is the whole design, and it is not a nicety: Kalib's
// TDEE is measured from intake against weight trend (§4.5), so the gym is already inside that
// number. Adding an estimate of what a session burned would double-count it and send the filter
// chasing its own tail. Every other tracker does exactly that, and gets away with it only
// because none of them measure expenditure in the first place.
//
// So nothing is added. The same weekly budget is simply distributed unevenly: more on the days
// you lift, less on the days you do not, summing to the identical total.
//
// **What this is, honestly.** The evidence says calorie cycling and flat intake produce the same
// weight change at an equal weekly deficit; carbohydrate intake has no independent effect on
// hypertrophy; and nutrient timing has little effect on fat loss or lean-mass retention. So this
// is not a metabolic trick and the app must not imply it is. It is an adherence feature: you are
// hungrier on training days, so it lets you eat more then without spending anything you had not
// already budgeted. If that makes the week easier to hold to, it helps — through adherence,
// which is the thing that actually decides outcomes.
//
// Protein stays flat every day, because the evidence that it should is much stronger than the
// evidence for any of the above. Carbohydrate takes the swing.
import type { MacroTotals } from './types';

export interface DayShape {
  date: string;
  training: boolean;
}

export interface DayBudget extends MacroTotals {
  date: string;
  training: boolean;
  /** Difference from the flat target, in kcal. Negative on rest days. */
  delta_kcal: number;
}

/**
 * How much more a training day carries than a rest day. The literature describes 200–300 kcal
 * between day types; 300 is the top of that, and the user can lower it.
 */
export const DEFAULT_DIFFERENCE_KCAL = 300;
export const MAX_DIFFERENCE_KCAL = 800;

export interface RedistributeInput {
  days: readonly DayShape[];
  /** The flat daily target the week would otherwise use. */
  base: MacroTotals;
  /** Training day minus rest day, before any clamping. */
  difference_kcal?: number;
  /** §3.5 calorie floor; a rest day is never pushed below it. */
  floor_kcal: number;
}

/**
 * Splits a week into training and rest budgets.
 *
 * Returns the days flat and unchanged when there is nothing to redistribute between — a week
 * with no training days, or one with nothing but. Both are correct: with no rest days there is
 * no day to take from.
 */
export function redistribute(o: RedistributeInput): DayBudget[] {
  const flat = (d: DayShape): DayBudget => ({
    date: d.date,
    training: d.training,
    delta_kcal: 0,
    kcal: o.base.kcal,
    protein_g: o.base.protein_g,
    carb_g: o.base.carb_g,
    fat_g: o.base.fat_g,
    fiber_g: o.base.fiber_g,
  });

  const t = o.days.filter((d) => d.training).length;
  const r = o.days.length - t;
  if (t === 0 || r === 0) return o.days.map(flat);

  const requested = Math.max(
    0,
    Math.min(MAX_DIFFERENCE_KCAL, o.difference_kcal ?? DEFAULT_DIFFERENCE_KCAL),
  );
  if (requested === 0) return o.days.map(flat);

  // `y` is what a rest day gives up, `x` what a training day gains. Conservation is t*x = r*y,
  // so the week's total is unchanged by construction rather than by arithmetic afterwards.
  const n = o.days.length;
  let y = (requested * t) / n;

  // Clamp once, here, against the tightest constraint a rest day faces. Clamping per day
  // afterwards would silently break conservation.
  y = Math.min(y, Math.max(0, o.base.kcal - o.floor_kcal));
  // Carbohydrate takes the whole swing, so it is the other limit: it cannot go below zero.
  y = Math.min(y, Math.max(0, o.base.carb_g) * 4);
  if (y <= 0) return o.days.map(flat);

  const x = (y * r) / t;

  // Round to whole kcal, then give the rounding residue back a kilocalorie at a time across the
  // training days, so the week sums exactly without one day visibly differing from its peers.
  const deltas = o.days.map((d) => Math.round(d.training ? x : -y));
  const training = o.days.flatMap((d, i) => (d.training ? [i] : []));
  let residue = deltas.reduce((a, b) => a + b, 0);
  for (let k = 0; residue !== 0 && training.length > 0; k++) {
    const i = training[k % training.length]!;
    const step = Math.sign(residue);
    deltas[i] = (deltas[i] ?? 0) - step;
    residue -= step;
  }

  return o.days.map((d, i) => {
    const delta = deltas[i] ?? 0;
    return {
      date: d.date,
      training: d.training,
      delta_kcal: delta,
      kcal: o.base.kcal + delta,
      // Protein and fat hold; only carbohydrate moves.
      protein_g: o.base.protein_g,
      fat_g: o.base.fat_g,
      fiber_g: o.base.fiber_g,
      carb_g: Math.max(0, Math.round(o.base.carb_g + delta / 4)),
    };
  });
}

/**
 * The weekdays someone usually trains, from what they actually did: 0 is Sunday.
 *
 * Inferred rather than configured, because a plan someone typed in once goes stale and a plan
 * derived from their behaviour cannot. A weekday counts when it was trained on at least half
 * the weeks observed, so an occasional extra session does not turn into a standing commitment.
 *
 * Returns empty until there is enough to go on, and an empty pattern means no redistribution —
 * the budget stays flat, which is the right behaviour for someone who has just started.
 */
/** The Monday of a date's own week, as a timestamp, for bucketing. */
function mondayOf(d: Date): number {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m.getTime();
}

export function inferTrainingWeekdays(
  trainedDates: readonly string[],
  now: Date = new Date(),
  weeks = 4,
): number[] {
  if (weeks < 1) return [];
  const since = new Date(now);
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - weeks * 7);

  const perWeekday = new Map<number, Set<number>>();
  const observedWeeks = new Set<number>();

  for (const key of trainedDates) {
    const d = new Date(`${key}T12:00:00`);
    if (Number.isNaN(d.getTime()) || d < since || d > now) continue;
    // Bucket by the Monday the date belongs to. Counting 7-day blocks from an arbitrary start
    // instead would put Monday and Wednesday of one week in different buckets, and a single
    // week of training would then look like two.
    observedWeeks.add(mondayOf(d));
    const set = perWeekday.get(d.getDay()) ?? new Set<number>();
    set.add(mondayOf(d));
    perWeekday.set(d.getDay(), set);
  }

  // One week of history is a sample of one; it would make every day you happened to train a
  // standing pattern.
  if (observedWeeks.size < 2) return [];

  const needed = observedWeeks.size / 2;
  return [...perWeekday.entries()]
    .filter(([, w]) => w.size >= needed)
    .map(([weekday]) => weekday)
    .sort((a, b) => a - b);
}

/**
 * Whether a given date counts as a training day: it already has a session, or its weekday is
 * part of the pattern. What actually happened always wins over what was expected.
 */
export function isTrainingDay(
  date: string,
  trainedDates: ReadonlySet<string>,
  pattern: readonly number[],
): boolean {
  if (trainedDates.has(date)) return true;
  const d = new Date(`${date}T12:00:00`);
  return !Number.isNaN(d.getTime()) && pattern.includes(d.getDay());
}
