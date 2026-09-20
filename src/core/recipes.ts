// SPEC §8.2 — recipes. Pure: ingredient totals, the materialised food's per-100 g values,
// portion arithmetic. The yield (cooked weight) divides the totals; until it is known the raw
// ingredient weight stands in.
import { MICRO_KEYS, microCoverageOf } from './nutrients';
import { dayTotals, scaleFood, type ScaledFood } from './nutrition';
import type { Food, Micros, Recipe, RecipeItem } from './types';

/** Sum of the ingredients as bought, in grams. */
export function rawWeight(items: readonly RecipeItem[]): number {
  return items.reduce((a, i) => a + i.grams, 0);
}

/** The weight the per-100 g figure is computed against. */
export function effectiveYield(recipe: Pick<Recipe, 'items' | 'yield_g'>): number {
  return recipe.yield_g && recipe.yield_g > 0 ? recipe.yield_g : rawWeight(recipe.items);
}

export function portionGrams(recipe: Pick<Recipe, 'items' | 'yield_g' | 'portions'>): number {
  const y = effectiveYield(recipe);
  return recipe.portions > 0 ? y / recipe.portions : y;
}

/** Whole-recipe totals; ingredients whose food is missing contribute nothing. */
export function recipeTotals(
  items: readonly RecipeItem[],
  foods: ReadonlyMap<string, Pick<Food, 'per_100g' | 'micros'>>,
): ScaledFood {
  const parts: ScaledFood[] = [];
  for (const it of items) {
    const f = foods.get(it.food_id);
    if (f) parts.push(scaleFood(f, it.grams));
  }
  return dayTotals(parts);
}

/** Micronutrient coverage of the recipe: the ingredient-weight-weighted share that has data. */
export function recipeMicroCoverage(
  items: readonly RecipeItem[],
  foods: ReadonlyMap<string, Pick<Food, 'micros'>>,
): number {
  let weighted = 0;
  let total = 0;
  for (const it of items) {
    const f = foods.get(it.food_id);
    if (!f) continue;
    total += it.grams;
    weighted += it.grams * microCoverageOf(f.micros);
  }
  return total > 0 ? weighted / total : 0;
}

/** Fields of the custom food that stands for the recipe (SPEC §8.2). */
export function recipeFoodFields(
  recipe: Pick<Recipe, 'name' | 'items' | 'yield_g' | 'portions'>,
  foods: ReadonlyMap<string, Pick<Food, 'per_100g' | 'micros'>>,
): Pick<Food, 'name' | 'per_100g' | 'micros' | 'micro_coverage' | 'portions' | 'verified'> {
  const y = effectiveYield(recipe);
  const t = recipeTotals(recipe.items, foods);
  const f = y > 0 ? 100 / y : 0;
  const micros: Micros = {};
  for (const k of MICRO_KEYS) {
    const v = t.micros[k];
    if (typeof v === 'number') micros[k] = round2(v * f);
  }
  const portion = portionGrams(recipe);
  return {
    name: recipe.name.trim() || 'Recipe',
    per_100g: {
      kcal: round2(t.kcal * f),
      protein: round2(t.protein_g * f),
      carb: round2(t.carb_g * f),
      fat: round2(t.fat_g * f),
      fiber: round2(t.fiber_g * f),
    },
    micros,
    micro_coverage: recipeMicroCoverage(recipe.items, foods),
    portions: portion > 0 ? [{ label: '1 portion', grams: Math.round(portion) }] : [],
    verified: false,
  };
}

/** Portions a logged amount represents, to a quarter portion. */
export function servingsOf(grams: number, portion_g: number): number {
  if (portion_g <= 0) return 1;
  return Math.max(0.25, Math.round((grams / portion_g) * 4) / 4);
}

/** "3 left", "2½ left", "¼ left" */
export function formatPortions(n: number): string {
  const whole = Math.floor(n);
  const frac = n - whole;
  const glyph = frac >= 0.75 ? '¾' : frac >= 0.5 ? '½' : frac >= 0.25 ? '¼' : '';
  if (whole === 0 && glyph === '') return '0';
  return `${whole > 0 ? whole : ''}${glyph}`;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
