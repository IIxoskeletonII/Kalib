// SPEC §18.6 — recipe suggestions. Pure: validate the model's JSON into typed suggestions,
// turn a suggestion's ingredients into the items the §9.4 grounding understands, and read a
// budget against a shopping list.
import type { EstimateItem } from './estimate';
import type { ShoppingList } from './planner';

export interface SuggestedIngredient {
  name: string;
  search_term: string;
  /** For the whole recipe, as bought. */
  grams: number;
  per_100g: { kcal: number; protein: number; carb: number; fat: number; fiber: number };
  /** The model's typical local price; an estimate until the user enters one. */
  price_per_kg: number;
}

export interface Suggestion {
  name: string;
  blurb: string;
  tags: string[];
  portions: number;
  time_min: number;
  oven_c?: number | undefined;
  ingredients: SuggestedIngredient[];
  steps: string[];
  /** The published dish title the model drew its theme from, when it did (§18.6). */
  inspiration?: string | undefined;
  /** Came from the shared bank of recipes people kept, not from the model. */
  from_bank?: boolean | undefined;
}

/** The preference cards, in the order they are shown. Ids match the Worker's prompt table. */
export const DISCOVER_TAGS: { id: string; label: string; hint: string }[] = [
  { id: 'fakeaway', label: 'Fakeaway', hint: 'takeaway food, made to fit' },
  { id: 'trending', label: 'Trending now', hint: 'what people are cooking' },
  { id: 'high-protein', label: 'High protein', hint: '35 g+ a portion' },
  { id: 'high-volume', label: 'Big plate', hint: 'filling for the calories' },
  { id: 'low-calorie', label: 'Low calorie', hint: 'under 500 kcal' },
  { id: 'high-fiber', label: 'High fiber', hint: '10 g+ a portion' },
  { id: 'quick', label: 'Quick', hint: '30 min or less' },
  { id: 'air-fryer', label: 'Air fryer', hint: '' },
  { id: 'one-pot', label: 'One pot', hint: 'little washing up' },
  { id: 'meal-prep', label: 'Meal prep', hint: 'cook once, eat all week' },
  { id: 'batch-friendly', label: 'Batch-friendly', hint: 'keeps for days' },
  { id: 'vegetarian', label: 'Vegetarian', hint: '' },
  { id: 'low-carb', label: 'Low carb', hint: '' },
  { id: 'budget', label: 'Cheap', hint: 'staples and cheap cuts' },
  { id: 'italian', label: 'Italian', hint: '' },
  { id: 'asian', label: 'Asian', hint: '' },
  { id: 'mexican', label: 'Mexican', hint: '' },
  { id: 'spicy', label: 'Spicy', hint: '' },
];

/** Words that say nothing about what a dish is. */
const STOPWORDS = new Set([
  'and',
  'with',
  'the',
  'a',
  'of',
  'in',
  'on',
  'style',
  'fresh',
  'easy',
  'quick',
  'simple',
  'homemade',
  'home',
  'made',
  'best',
  'classic',
  'one',
  'pot',
  'pan',
  'tray',
  'bake',
  'baked',
  'roast',
  'roasted',
  'fried',
  'grilled',
  'sauce',
  'salad',
  'bowl',
  'dish',
  'recipe',
  'sheet',
  'my',
  'your',
  'our',
  'crispy',
  'creamy',
  'spicy',
  'loaded',
  'raw',
  'cooked',
  'canned',
  'dried',
  'fresh',
  'chopped',
  'sliced',
  'boneless',
  'skinless',
  'extra',
  'virgin',
  'olive',
  'oil',
  'salt',
  'pepper',
  'water',
  'white',
  'black',
  'red',
  'green',
  'large',
  'small',
  'whole',
  'plain',
  'low',
  'fat',
  'free',
  'light',
  'ground',
  'powder',
  'paste',
  'fillet',
  'breast',
  'thigh',
  'thighs',
  'mince',
]);

function terms(s: Suggestion): Set<string> {
  const words = [
    ...s.name.toLowerCase().split(/[^a-z]+/),
    // The first ingredients carry the dish: the protein and the starch, not the seasoning.
    ...s.ingredients.slice(0, 4).flatMap((i) => i.search_term.toLowerCase().split(/[^a-z]+/)),
  ];
  return new Set(words.filter((w) => w.length > 2 && !STOPWORDS.has(w)));
}

/**
 * §18.6 — how alike two suggestions are, 0 to 1, by the words that describe the dish and its
 * main ingredients. A turned-down card should not come back with a different sauce.
 */
export function similarity(a: Suggestion, b: Suggestion): number {
  const x = terms(a);
  const y = terms(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / Math.min(x.size, y.size);
}

/** Above this, two dishes read as the same idea to the person looking at them. */
export const TOO_SIMILAR = 0.5;

/** Drops anything that is essentially a card already turned down. */
export function dropNearDuplicates(
  fresh: readonly Suggestion[],
  rejected: readonly Suggestion[],
): Suggestion[] {
  const kept: Suggestion[] = [];
  for (const s of fresh) {
    const tooClose =
      rejected.some((r) => similarity(s, r) >= TOO_SIMILAR) ||
      kept.some((k) => similarity(s, k) >= TOO_SIMILAR);
    if (!tooClose) kept.push(s);
  }
  return kept;
}

const num = (v: unknown, lo: number, hi: number, fallback = 0): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};
const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

/** Validates the model's object; anything unusable is dropped rather than trusted. */
export function parseSuggestions(raw: unknown): Suggestion[] {
  if (!raw || typeof raw !== 'object') return [];
  const list = (raw as { recipes?: unknown }).recipes;
  if (!Array.isArray(list)) return [];
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const name = str(o.name, 80);
    if (!name || seen.has(name.toLowerCase())) continue;
    const ingredientsRaw = Array.isArray(o.ingredients) ? o.ingredients : [];
    const ingredients: SuggestedIngredient[] = [];
    for (const it of ingredientsRaw) {
      if (!it || typeof it !== 'object') continue;
      const i = it as Record<string, unknown>;
      const iname = str(i.name, 80);
      const grams = num(i.grams, 1, 20000);
      if (!iname || grams <= 0) continue;
      const p = (i.per_100g ?? {}) as Record<string, unknown>;
      ingredients.push({
        name: iname,
        search_term: str(i.search_term, 60) || iname,
        grams: Math.round(grams),
        per_100g: {
          kcal: num(p.kcal, 0, 900),
          protein: num(p.protein, 0, 100),
          carb: num(p.carb, 0, 100),
          fat: num(p.fat, 0, 100),
          fiber: num(p.fiber, 0, 60),
        },
        price_per_kg: num(i.price_per_kg, 0, 500),
      });
    }
    if (ingredients.length === 0) continue;
    const steps = (Array.isArray(o.steps) ? o.steps : [])
      .map((s) => str(s, 400))
      .filter(Boolean)
      .slice(0, 12);
    const oven = num(o.oven_c, 0, 300);
    seen.add(name.toLowerCase());
    const inspiration = str(o.inspiration, 140);
    out.push({
      name,
      blurb: str(o.blurb, 160),
      tags: (Array.isArray(o.tags) ? o.tags : []).map((t) => str(t, 20)).filter(Boolean),
      portions: Math.round(num(o.portions, 1, 12, 4)) || 4,
      time_min: Math.round(num(o.time_min, 5, 600, 30)) || 30,
      ...(oven >= 100 ? { oven_c: Math.round(oven) } : {}),
      ingredients,
      steps,
      ...(inspiration ? { inspiration } : {}),
      ...(o.from_bank === true ? { from_bank: true } : {}),
    });
  }
  return out;
}

/** Per-portion figures from the model's own numbers (used on the card before grounding). */
export function suggestionFacts(s: Suggestion) {
  let kcal = 0;
  let protein = 0;
  let fiber = 0;
  let cost = 0;
  let grams = 0;
  for (const i of s.ingredients) {
    const f = i.grams / 100;
    kcal += i.per_100g.kcal * f;
    protein += i.per_100g.protein * f;
    fiber += i.per_100g.fiber * f;
    cost += (i.grams / 1000) * i.price_per_kg;
    grams += i.grams;
  }
  const p = Math.max(1, s.portions);
  return {
    portion_kcal: kcal / p,
    portion_protein_g: protein / p,
    portion_fiber_g: fiber / p,
    portion_cost: cost / p,
    portion_g: grams / p,
    total_cost: cost,
  };
}

/** The shape §9.4's matcher and grounder take, one per ingredient. */
export function toEstimateItems(s: Suggestion): EstimateItem[] {
  return s.ingredients.map((i) => {
    const f = i.grams / 100;
    return {
      name: i.name,
      search_term: i.search_term,
      grams_estimate: i.grams,
      grams_range: [i.grams, i.grams],
      kcal: i.per_100g.kcal * f,
      protein_g: i.per_100g.protein * f,
      carb_g: i.per_100g.carb * f,
      fat_g: i.per_100g.fat * f,
      fiber_g: i.per_100g.fiber * f,
      confidence: 'medium',
    };
  });
}

export interface BudgetLine {
  /** Cost of the list as priced so far. */
  cost: number;
  budget: number;
  /** Fraction of the budget used; > 1 is over. */
  share: number;
  /** How many priced lines carry an estimated price. */
  estimated: number;
  unpriced: number;
}

export function budgetLine(list: ShoppingList, budget: number): BudgetLine {
  return {
    cost: list.total_cost,
    budget,
    share: budget > 0 ? list.total_cost / budget : 0,
    estimated: list.estimated,
    unpriced: list.unpriced,
  };
}
