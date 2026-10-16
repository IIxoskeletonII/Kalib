// Scaling per-100 g data to a logged amount, summing a day, and the §7.4 provenance metrics.
import { MICRO_KEYS } from './nutrients';
import type { Confidence, Food, MacroTotals, MicroKey, Micros, Per100g } from './types';

export interface ScaledFood extends MacroTotals {
  micros: Micros;
}

/**
 * A food that can be weighed: everything except a menu item published without a weight (§21).
 *
 * Narrowing through this rather than reaching for `!` is deliberate. The compiler then names
 * every place that has to decide what an unweighable food means there, which is how the recipe,
 * planner and coach paths came to exclude them explicitly instead of by accident.
 */
export type Weighable<T extends { per_100g?: Per100g }> = T & { per_100g: Per100g };

export function isWeighable<T extends { per_100g?: Per100g }>(food: T): food is Weighable<T> {
  return food.per_100g != null;
}

function scaleBy(basis: Per100g, micros: Micros, factor: number): ScaledFood {
  const out: Micros = {};
  for (const k of MICRO_KEYS) {
    const v = micros[k];
    if (typeof v === 'number') out[k] = v * factor;
  }
  return {
    kcal: basis.kcal * factor,
    protein_g: basis.protein * factor,
    carb_g: basis.carb * factor,
    fat_g: basis.fat * factor,
    fiber_g: basis.fiber * factor,
    micros: out,
  };
}

export function scaleFood(
  food: Weighable<Pick<Food, 'per_100g' | 'micros'>>,
  grams: number,
): ScaledFood {
  return scaleBy(food.per_100g, food.micros, grams / 100);
}

/**
 * The composition of `count` whole items, for a food sold as a thing rather than by weight.
 *
 * Its micros are per item for the same reason its macros are: nobody published a weight to
 * divide them by.
 */
export function scaleItems(food: { per_item: Per100g; micros: Micros }, count: number): ScaledFood {
  return scaleBy(food.per_item, food.micros, count);
}

export const EMPTY_TOTALS: MacroTotals = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0 };

export function dayTotals(entries: readonly (MacroTotals & { micros?: Micros })[]): ScaledFood {
  const t: ScaledFood = { ...EMPTY_TOTALS, micros: {} };
  for (const e of entries) {
    t.kcal += e.kcal;
    t.protein_g += e.protein_g;
    t.carb_g += e.carb_g;
    t.fat_g += e.fat_g;
    t.fiber_g += e.fiber_g;
    if (e.micros) {
      for (const k of MICRO_KEYS) {
        const v = e.micros[k];
        if (typeof v === 'number') t.micros[k] = (t.micros[k] ?? 0) + v;
      }
    }
  }
  return t;
}

/** §7.4 — fraction of the day's kcal from high-confidence entries. null when nothing is logged. */
export function calorieConfidence(
  entries: readonly { kcal: number; confidence: Confidence }[],
): number | null {
  let total = 0;
  let high = 0;
  for (const e of entries) {
    total += e.kcal;
    if (e.confidence === 'high') high += e.kcal;
  }
  return total > 0 ? high / total : null;
}

/**
 * §7.4 per nutrient — fraction of the day's kcal from entries that carry a value for `key`.
 * A food with 8 of 22 nutrients recorded must not read as zero on the other 14.
 */
export function nutrientCoverage(
  entries: readonly { kcal: number; micros?: Micros | undefined }[],
  key: MicroKey,
): number | null {
  let total = 0;
  let covered = 0;
  for (const e of entries) {
    total += e.kcal;
    if (typeof e.micros?.[key] === 'number') covered += e.kcal;
  }
  return total > 0 ? covered / total : null;
}

export function hasAnyMicros(micros: Micros | undefined): boolean {
  if (!micros) return false;
  for (const k of MICRO_KEYS) if (typeof micros[k] === 'number') return true;
  return false;
}

/** §7.4 — fraction of the day's kcal that carried any micronutrient data. null when empty. */
export function microCoverage(
  entries: readonly { kcal: number; micros?: Micros | undefined }[],
): number | null {
  let total = 0;
  let covered = 0;
  for (const e of entries) {
    total += e.kcal;
    if (hasAnyMicros(e.micros)) covered += e.kcal;
  }
  return total > 0 ? covered / total : null;
}
