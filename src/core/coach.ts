// SPEC §16 — gap-aware recommendations. Pure: takes day summaries and a food list, returns
// the leading gap and foods that close it. The UI decides when and how to show it.
import { MICRO_DEFS, MICRO_KEYS } from './nutrients';
import { nutrientCoverage } from './nutrition';
import type { Confidence, Food, MacroTotals, MicroKey, Micros, Sex } from './types';

export type GapNutrient = 'protein_g' | 'fiber_g' | MicroKey;

export interface DaySummary {
  date: string;
  totals: MacroTotals & { micros: Micros };
  target: MacroTotals;
  /** Entries for §7.4 coverage and confidence; only needed when judging micronutrients. */
  entries?: readonly { kcal: number; micros?: Micros | undefined; confidence?: Confidence }[];
}

export interface Gap {
  nutrient: GapNutrient;
  label: string;
  unit: string;
  /** 7-day average over complete days. */
  average: number;
  target: number;
  /** average / target, 0–1. */
  ratio: number;
  /** Complete days that contributed. */
  days: number;
}

export interface Recommendation {
  food: Food;
  /** Portion the message is written for. */
  grams: number;
  /** Amount of the gap nutrient in that portion, in the gap's unit. */
  adds: number;
  kcal: number;
  /** Nutrient per 100 kcal — the ranking key. */
  density: number;
  familiar: boolean;
}

export const COACH_WINDOW_DAYS = 7;
export const COACH_MIN_COMPLETE_DAYS = 4;
export const COMPLETE_DAY_RATIO = 0.6;
export const GAP_RATIO = 0.85;
export const MICRO_COVERAGE_FLOOR = 0.7;

export function isCompleteDay(d: DaySummary): boolean {
  return d.target.kcal > 0 && d.totals.kcal >= COMPLETE_DAY_RATIO * d.target.kcal;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Gaps over the trailing window, largest shortfall first. Protein and fiber are judged on every
 * complete day; micronutrients only on complete days with enough coverage (§7.4).
 */
export function findGaps(days: readonly DaySummary[], sex: Sex): Gap[] {
  const complete = days.filter(isCompleteDay);
  if (complete.length < COACH_MIN_COMPLETE_DAYS) return [];
  const gaps: Gap[] = [];

  const macro = (key: 'protein_g' | 'fiber_g', label: string) => {
    const avg = mean(complete.map((d) => d.totals[key]));
    const target = mean(complete.map((d) => d.target[key]));
    if (target > 0 && avg < GAP_RATIO * target) {
      gaps.push({
        nutrient: key,
        label,
        unit: 'g',
        average: avg,
        target,
        ratio: avg / target,
        days: complete.length,
      });
    }
  };
  macro('protein_g', 'Protein');
  macro('fiber_g', 'Fiber');

  for (const k of MICRO_KEYS) {
    const def = MICRO_DEFS[k];
    const target = def.rda?.[sex];
    if (!target) continue;
    // Judged only on days whose food actually carried this nutrient (§7.4, per nutrient).
    const covered = complete.filter((d) => {
      if (!d.entries) return false;
      const c = nutrientCoverage(d.entries, k);
      return c != null && c >= MICRO_COVERAGE_FLOOR;
    });
    if (covered.length >= COACH_MIN_COMPLETE_DAYS) {
      const avg = mean(covered.map((d) => d.totals.micros[k] ?? 0));
      if (avg < GAP_RATIO * target) {
        gaps.push({
          nutrient: k,
          label: def.label,
          unit: def.unit,
          average: avg,
          target,
          ratio: avg / target,
          days: covered.length,
        });
      }
    }
  }

  // Protein and fiber lead (§16.1); micronutrients follow, each group by shortfall.
  const isMacro = (g: Gap) => g.nutrient === 'protein_g' || g.nutrient === 'fiber_g';
  return gaps.sort((a, b) => Number(isMacro(b)) - Number(isMacro(a)) || a.ratio - b.ratio);
}

function amountPer100g(food: Food, nutrient: GapNutrient): number | undefined {
  if (nutrient === 'protein_g') return food.per_100g.protein;
  if (nutrient === 'fiber_g') return food.per_100g.fiber;
  return food.micros[nutrient];
}

/** Food groups a person can actually eat more of. Everything else (spices, oils, sweets,
 * sauces, drinks, snacks, processed meats) never earns a coach suggestion. */
export const DISH_CATEGORIES = new Set([
  'Vegetables and Vegetable Products',
  'Fruits and Fruit Juices',
  'Legumes and Legume Products',
  'Cereal Grains and Pasta',
  'Breakfast Cereals',
  'Nut and Seed Products',
  'Dairy and Egg Products',
  'Finfish and Shellfish Products',
  'Poultry Products',
  'Beef Products',
  'Pork Products',
  'Lamb, Veal, and Game Products',
  'Baked Products',
]);
/** Ingredients and by-products that still slip through a category filter. */
const NOT_A_DISH =
  /\b(bran|gums?|crude|dehydrated|freeze-dried|powder|extract|flour|meal|isolate|concentrate|yeast|leavening|baking|psyllium|cocoa|carob|chicory|fungi|seaweed|kelp|spirulina|unprepared|uncooked|peel|rind|zest|juice|0% moisture)\b/i;
/** Legumes and grains are only edible cooked; the raw/dry entries are what the database lists first. */
const NEEDS_COOKING =
  /^(beans|lentils|chickpeas|peas|rice|oats|barley|quinoa|pasta|spaghetti|macaroni|bulgur|farro|wheat|sorghum|millet|buckwheat|cornmeal|noodles|couscous)\b/i;

export function isPlausibleDish(food: Food, familiar = false): boolean {
  const name = food.name;
  // Database foods must come from an edible group; the user's own / scanned foods count when
  // they already eat them.
  if (food.category ? !DISH_CATEGORIES.has(food.category) : !familiar) return false;
  if (NOT_A_DISH.test(name)) return false;
  if (NEEDS_COOKING.test(name) && !/\bcooked\b|\bcanned\b|\bboiled\b/i.test(name)) return false;
  return true;
}

/** One realistic serving: the database portion when sensible, else by energy density. */
export function realisticPortion(food: Food): number {
  const listed = food.portions.find((p) => p.grams >= 20 && p.grams <= 300);
  if (listed) return listed.grams;
  const kcal100 = food.per_100g.kcal;
  if (kcal100 >= 350) return 30; // nuts, seeds
  if (kcal100 < 60) return 150; // vegetables, berries
  return 100;
}

/**
 * Foods that close a gap. Ranked by what one realistic portion adds against its calorie cost —
 * a portion of lentils beats a leaf of kale even though kale is denser per calorie. Foods the
 * user already logs form the top tier; Foundation (everyday whole foods) are preferred over SR.
 * `exclude` removes what was already suggested or dismissed.
 */
export function recommendFoods(
  gap: Gap,
  foods: readonly Food[],
  opts: {
    familiarIds?: ReadonlySet<string>;
    exclude?: ReadonlySet<string>;
    limit?: number;
    /** Daily kcal target; a suggestion may not cost more than 18 % of it. */
    kcalTarget?: number;
    /** Serving overrides in grams (the coach repertoire's sensible portions). */
    serving?: ReadonlyMap<string, number>;
  } = {},
): Recommendation[] {
  const limit = opts.limit ?? 3;
  const meaningful = 0.12 * gap.target;
  const kcalCap = (opts.kcalTarget ?? 2000) * 0.18;
  const scored: (Recommendation & { score: number })[] = [];
  for (const food of foods) {
    if (opts.exclude?.has(food.id)) continue;
    const kcal100 = food.per_100g.kcal;
    if (kcal100 < 20 || kcal100 > 600) continue; // water, spices, oils, pure sweeteners
    const familiar = opts.familiarIds?.has(food.id) ?? false;
    if (!isPlausibleDish(food, familiar)) continue;
    const per100 = amountPer100g(food, gap.nutrient);
    if (per100 == null || per100 <= 0) continue;
    const grams = opts.serving?.get(food.id) ?? realisticPortion(food);
    const adds = (per100 * grams) / 100;
    const kcal = (kcal100 * grams) / 100;
    if (adds < meaningful || kcal > kcalCap) continue;
    const density = (per100 / kcal100) * 100;
    const score =
      (adds / (kcal + 80)) * (food.source === 'usda_foundation' ? 1.3 : 1) + (familiar ? 1000 : 0);
    scored.push({ food, grams, adds, kcal, density, familiar, score });
  }
  scored.sort((a, b) => b.score - a.score);
  // One suggestion per head noun ("Beans, black" and "Beans, kidney" are the same advice).
  const seen = new Set<string>();
  const out: Recommendation[] = [];
  for (const s of scored) {
    const head = s.food.name.split(',')[0]!.trim().toLowerCase();
    if (seen.has(head)) continue;
    seen.add(head);
    const { score: _score, ...rec } = s;
    void _score;
    out.push(rec);
    if (out.length === limit) break;
  }
  return out;
}

/** True when a previously flagged nutrient now meets its target — the one-time "on target" note. */
export function gapClosed(previous: Gap | undefined, current: Gap[]): boolean {
  return previous != null && !current.some((g) => g.nutrient === previous.nutrient);
}
