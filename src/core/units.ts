// Amount units for logging. Everything is stored in grams (SPEC §6); ml and fluid ounces
// convert through a density — exact when the food's portion data contains a fluid measure,
// otherwise a category/name heuristic, otherwise 1 g/ml with the assumption shown.
import type { Food } from './types';

export type AmountUnit = 'g' | 'ml' | 'oz' | 'floz';

export const UNIT_LABEL: Record<AmountUnit, string> = { g: 'g', ml: 'ml', oz: 'oz', floz: 'fl oz' };
export const G_PER_OZ = 28.3495;
export const ML_PER_FLOZ = 29.5735;

export interface Density {
  g_per_ml: number;
  /** Where the figure came from; 'assumed' means 1 g/ml with no evidence. */
  basis: 'food' | 'portion' | 'category' | 'assumed';
}

const LIQUID_CATEGORIES = /beverages|soups|dairy|fats and oils/i;
const OIL = /\boil\b|\bghee\b/i;
const DENSE = /\bhoney\b|\bsyrup\b|\bmolasses\b|condensed milk/i;
const DAIRY_DRINK =
  /\bmilk\b|\blatte\b|\bcappuccino\b|\bkefir\b|\bcream\b|\byogurt\b|\bshake\b|\bsmoothie\b/i;
const THIN =
  /\bwater\b|\bcoffee\b|\btea\b|\bjuice\b|\bsoda\b|\bcola\b|\bbeer\b|\bwine\b|\bbroth\b|\bstock\b|\bsoup\b|\bdrink\b|\bbeverage\b/i;

/** Density from the best available evidence. */
export function densityFor(
  food: Pick<Food, 'name' | 'category' | 'density_g_per_ml' | 'portions'>,
): Density {
  if (food.density_g_per_ml && food.density_g_per_ml > 0) {
    return { g_per_ml: food.density_g_per_ml, basis: 'food' };
  }
  // A fluid portion in the data is the most honest source: "1 fl oz = 30.5 g" → 1.03 g/ml.
  for (const p of food.portions) {
    const m = p.label.match(/^(\d+(?:\.\d+)?)\s*fl\s*oz\b/i);
    if (m && p.grams > 0)
      return { g_per_ml: p.grams / (Number(m[1]) * ML_PER_FLOZ), basis: 'portion' };
  }
  for (const p of food.portions) {
    const m = p.label.match(/^(\d+(?:\.\d+)?)\s*cup\b/i);
    if (m && p.grams > 0 && LIQUID_CATEGORIES.test(food.category ?? '')) {
      return { g_per_ml: p.grams / (Number(m[1]) * 236.6), basis: 'portion' };
    }
  }
  const text = `${food.name} ${food.category ?? ''}`;
  if (OIL.test(text)) return { g_per_ml: 0.92, basis: 'category' };
  if (DENSE.test(text)) return { g_per_ml: 1.4, basis: 'category' };
  if (DAIRY_DRINK.test(text)) return { g_per_ml: 1.03, basis: 'category' };
  if (THIN.test(text)) return { g_per_ml: 1.0, basis: 'category' };
  return { g_per_ml: 1.0, basis: 'assumed' };
}

/** Whether ml is the natural unit for this food (drinks, oils, dairy liquids). */
export function isLiquid(
  food: Pick<Food, 'name' | 'category' | 'portions' | 'density_g_per_ml'>,
): boolean {
  const text = `${food.name} ${food.category ?? ''}`;
  if (food.portions.some((p) => /fl\s*oz/i.test(p.label))) return true;
  if (/beverages/i.test(food.category ?? '')) return true;
  return OIL.test(text) || DAIRY_DRINK.test(text) || THIN.test(text);
}

export function toGrams(value: number, unit: AmountUnit, density: number): number {
  switch (unit) {
    case 'g':
      return value;
    case 'oz':
      return value * G_PER_OZ;
    case 'ml':
      return value * density;
    case 'floz':
      return value * ML_PER_FLOZ * density;
  }
}

export function fromGrams(grams: number, unit: AmountUnit, density: number): number {
  switch (unit) {
    case 'g':
      return grams;
    case 'oz':
      return grams / G_PER_OZ;
    case 'ml':
      return grams / density;
    case 'floz':
      return grams / density / ML_PER_FLOZ;
  }
}

/** Sensible rounding for display in a unit: whole g/ml, one decimal for ounces. */
export function roundIn(value: number, unit: AmountUnit): number {
  return unit === 'oz' || unit === 'floz' ? Math.round(value * 10) / 10 : Math.round(value);
}
