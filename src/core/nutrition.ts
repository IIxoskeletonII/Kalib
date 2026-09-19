// Scaling per-100 g data to a logged amount, summing a day, and the §7.4 provenance metrics.
import { MICRO_KEYS } from './nutrients';
import type { Confidence, Food, MacroTotals, Micros } from './types';

export interface ScaledFood extends MacroTotals {
  micros: Micros;
}

export function scaleFood(food: Pick<Food, 'per_100g' | 'micros'>, grams: number): ScaledFood {
  const f = grams / 100;
  const micros: Micros = {};
  for (const k of MICRO_KEYS) {
    const v = food.micros[k];
    if (typeof v === 'number') micros[k] = v * f;
  }
  return {
    kcal: food.per_100g.kcal * f,
    protein_g: food.per_100g.protein * f,
    carb_g: food.per_100g.carb * f,
    fat_g: food.per_100g.fat * f,
    fiber_g: food.per_100g.fiber * f,
    micros,
  };
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

export function hasAnyMicros(micros: Micros | undefined): boolean {
  if (!micros) return false;
  for (const k of MICRO_KEYS) if (typeof micros[k] === 'number') return true;
  return false;
}

/** §7.4 — fraction of the day's kcal that carried any micronutrient data. null when empty. */
export function microCoverage(
  entries: readonly { kcal: number; micros?: Micros }[],
): number | null {
  let total = 0;
  let covered = 0;
  for (const e of entries) {
    total += e.kcal;
    if (hasAnyMicros(e.micros)) covered += e.kcal;
  }
  return total > 0 ? covered / total : null;
}
