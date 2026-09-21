// SPEC §9 — photo / description estimation. Pure: validate the model's JSON, ground each item
// against the offline database, apply the +10 % bias to what stays an estimate, total it.
import { matchQuality, searchFoods, type SearchDoc } from './search';
import type { Confidence, Food, Micros } from './types';
import { scaleFood } from './nutrition';

export interface EstimateItem {
  name: string;
  /** 2–4 generic words for the database lookup, main ingredient first ("egg scrambled"). */
  search_term?: string | undefined;
  grams_estimate: number;
  grams_range: [number, number];
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  fiber_g: number;
  confidence: Confidence;
}

export interface EstimateResult {
  items: EstimateItem[];
  hidden_ingredients_assumed: string[];
  total_kcal_range: [number, number];
  notes: string;
}

/** §9.3 — consistent over-counting is absorbed by the engine; under-counting is not. */
export const PHOTO_BIAS = 1.1;
/** Minimum average token match (exact = 3, prefix = 2) for a database match to count. */
export const MATCH_QUALITY_FLOOR = 2.0;
/** The database food's energy density must be within this factor of the model's. */
export const DENSITY_TOLERANCE = 2.5;

const num = (v: unknown, lo = 0, hi = 100000): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(hi, Math.max(lo, n));
};

/** Validates and normalises the model's JSON; throws with a plain reason when unusable. */
export function parseEstimate(raw: unknown): EstimateResult {
  if (!raw || typeof raw !== 'object') throw new Error('The estimate came back empty.');
  const r = raw as Record<string, unknown>;
  const itemsRaw = Array.isArray(r.items) ? r.items : [];
  const items: EstimateItem[] = [];
  for (const it of itemsRaw) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) continue;
    const grams = num(o.grams_estimate, 1, 5000);
    const rangeRaw = Array.isArray(o.grams_range) ? o.grams_range : [];
    const lo = num(rangeRaw[0], 1, 5000) || grams * 0.7;
    const hi = num(rangeRaw[1], 1, 5000) || grams * 1.3;
    const conf = o.confidence === 'high' || o.confidence === 'medium' ? o.confidence : 'low';
    items.push({
      name,
      search_term:
        typeof o.search_term === 'string' ? o.search_term.trim() || undefined : undefined,
      grams_estimate: grams,
      grams_range: [Math.min(lo, hi), Math.max(lo, hi)],
      kcal: num(o.kcal, 0, 5000),
      protein_g: num(o.protein_g, 0, 500),
      carb_g: num(o.carb_g, 0, 1000),
      fat_g: num(o.fat_g, 0, 500),
      fiber_g: num(o.fiber_g, 0, 200),
      confidence: conf,
    });
  }
  if (items.length === 0) throw new Error('Nothing recognisable in that. Try naming the foods.');
  const totalRaw = Array.isArray(r.total_kcal_range) ? r.total_kcal_range : [];
  const sum = items.reduce((a, i) => a + i.kcal, 0);
  const tlo = num(totalRaw[0], 0, 20000) || sum * 0.75;
  const thi = num(totalRaw[1], 0, 20000) || sum * 1.25;
  return {
    items,
    hidden_ingredients_assumed: Array.isArray(r.hidden_ingredients_assumed)
      ? r.hidden_ingredients_assumed.filter((x): x is string => typeof x === 'string')
      : [],
    total_kcal_range: [Math.min(tlo, thi), Math.max(tlo, thi)],
    notes: typeof r.notes === 'string' ? r.notes : '',
  };
}

/** Step 1 (pure, needs only the search index): the food id each item most likely is. */
export function matchItems(
  items: readonly EstimateItem[],
  docs: readonly SearchDoc[],
  usage?: ReadonlyMap<string, number>,
): (string | undefined)[] {
  return items.map((item) => {
    for (const q of [item.search_term, item.name]) {
      if (!q) continue;
      const hits = searchFoods(docs, q, usage, 8);
      for (const h of hits) {
        if (matchQuality(h, q) >= MATCH_QUALITY_FLOOR) return h.id;
      }
    }
    return undefined;
  });
}

export interface GroundedItem {
  item: EstimateItem;
  grams: number;
  /** Present when the item is grounded in a database food. */
  food?: Food | undefined;
  kind: 'matched' | 'estimate';
  confidence: Confidence;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  fiber_g: number;
  micros: Micros;
  /** kcal at the low and high end of the gram range (bias included for estimates). */
  kcal_range: [number, number];
}

/**
 * Step 2 (pure): join items with the foods fetched for their matches. A match is kept only
 * when the database's energy density agrees with the model's — "latte" must not become
 * black coffee at 1 kcal/100 g.
 */
export function groundItems(
  items: readonly EstimateItem[],
  matches: readonly (string | undefined)[],
  foods: ReadonlyMap<string, Food>,
): GroundedItem[] {
  return items.map((item, i) => {
    const food = matches[i] ? foods.get(matches[i]!) : undefined;
    if (food && densityAgrees(item, food)) {
      return groundedFromFood(item, food, item.grams_estimate);
    }
    return groundedEstimate(item, item.grams_estimate);
  });
}

function densityAgrees(item: EstimateItem, food: Food): boolean {
  const model = item.grams_estimate > 0 ? (item.kcal / item.grams_estimate) * 100 : 0;
  const db = food.per_100g.kcal;
  if (model <= 0 || db <= 0) return model <= 5 && db <= 5; // water-like both sides
  const ratio = db / model;
  return ratio <= DENSITY_TOLERANCE && ratio >= 1 / DENSITY_TOLERANCE;
}

/** The model's gram range, moved with the user's own gram choice. */
function rangeAt(item: EstimateItem, grams: number): [number, number] {
  const k = item.grams_estimate > 0 ? grams / item.grams_estimate : 1;
  return [item.grams_range[0] * k, item.grams_range[1] * k];
}

export function groundedFromFood(item: EstimateItem, food: Food, grams: number): GroundedItem {
  const s = scaleFood(food, grams);
  const f = (g: number) => (food.per_100g.kcal * g) / 100;
  const [lo, hi] = rangeAt(item, grams);
  return {
    item,
    grams,
    food,
    kind: 'matched',
    confidence: 'medium', // the food is known; the portion is still a guess
    ...s,
    kcal_range: [f(lo), f(hi)],
  };
}

export function groundedEstimate(item: EstimateItem, grams: number): GroundedItem {
  // Scale the model's macros to the chosen grams, then apply the bias.
  const k = item.grams_estimate > 0 ? grams / item.grams_estimate : 1;
  const b = PHOTO_BIAS;
  const perGram = item.grams_estimate > 0 ? (item.kcal * b) / item.grams_estimate : 0;
  const [lo, hi] = rangeAt(item, grams);
  return {
    item,
    grams,
    kind: 'estimate',
    confidence: 'low',
    kcal: item.kcal * k * b,
    protein_g: item.protein_g * k * b,
    carb_g: item.carb_g * k * b,
    fat_g: item.fat_g * k * b,
    fiber_g: item.fiber_g * k * b,
    micros: {},
    kcal_range: [perGram * lo, perGram * hi],
  };
}

/** Re-ground one item at different grams, keeping its match. */
export function regroundItem(g: GroundedItem, grams: number): GroundedItem {
  return g.food ? groundedFromFood(g.item, g.food, grams) : groundedEstimate(g.item, grams);
}

export function totalGrounded(items: readonly GroundedItem[]) {
  const t = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0, lo: 0, hi: 0 };
  for (const g of items) {
    t.kcal += g.kcal;
    t.protein_g += g.protein_g;
    t.carb_g += g.carb_g;
    t.fat_g += g.fat_g;
    t.fiber_g += g.fiber_g;
    t.lo += g.kcal_range[0];
    t.hi += g.kcal_range[1];
  }
  return t;
}
