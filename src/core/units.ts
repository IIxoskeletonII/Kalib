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

/** Weight or volume words: a portion labelled with one of these tells the user nothing new. */
const WEIGHT_ONLY =
  /^(\d+(?:\.\d+)?\s*)?(g|gram|grams|kg|oz|ounce|ounces|lb|pound|pounds|ml|millilitre|milliliter|l|litre|liter|fl\s*oz|fluid\s*ounce)s?$/i;

export function isWeightLabel(label: string): boolean {
  return WEIGHT_ONLY.test(label.trim());
}

/**
 * USDA portion labels are written for a database, not a button: "1 small or thin/very thin
 * slice". Drop the leading "1", and where a label offers alternatives keep the first one, so
 * the chip reads "small slice" while the full text stays available underneath.
 */
export function shortPortionLabel(label: string): string {
  let s = label.trim().replace(/^1\s+/, '');
  // "small or thin/very thin slice" → "small slice"; "cup or bowl" → "cup".
  s = s.replace(/\s+or\s+[^,]*?(\s+(?=\S+$))/i, '$1');
  s = s.replace(/\s+or\s+\S+$/i, '');
  return s.trim();
}

export interface Portion {
  label: string;
  grams: number;
}

/** The portions of a food that are worth offering as a unit to count. */
export function usablePortions(portions: readonly Portion[]): Portion[] {
  const seen = new Set<string>();
  const out: Portion[] = [];
  for (const p of portions) {
    const label = shortPortionLabel(p.label);
    if (p.grams <= 0 || !label || isWeightLabel(label) || seen.has(label)) continue;
    seen.add(label);
    out.push(p);
  }
  return out;
}

const NAME_STOP = /(raw|cooked|nfs|ns as to|prepared|without|with|added|from|fresh)/gi;
function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(NAME_STOP, ' ')
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2);
}

/**
 * Only a fifth of USDA Foundation foods carry a portion anyone counts in ("1 egg"), yet they
 * rank first. When the chosen food has none, the best same-subject food that does lends its
 * own — shown as an approximation, because it comes from a neighbouring row (§2.4).
 */
export function bestPortionDonor<T extends { name: string; portions: readonly Portion[] }>(
  food: { name: string },
  candidates: readonly T[],
): T | undefined {
  const head = food.name.split(',')[0]!.trim().toLowerCase();
  if (!head) return undefined;
  const want = new Set(nameWords(food.name));
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (c.name.split(',')[0]!.trim().toLowerCase() !== head) continue;
    if (usablePortions(c.portions).length === 0) continue;
    const words = nameWords(c.name);
    const shared = words.filter((w) => want.has(w)).length;
    // A word the donor has and the food does not is a different food ("duck" lending its egg
    // to a hen's); that costs far more than a word it simply lacks.
    const extra = words.filter((w) => !want.has(w)).length;
    const score = shared * 100 - extra * 30 - c.name.length / 1000;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
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
