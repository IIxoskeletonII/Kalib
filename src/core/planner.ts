// SPEC §18 — the meal planner's arithmetic. Pure: recipes in, portion counts and a shopping
// list out. The UI owns the deck; this owns the numbers.
import { effectiveYield, portionGrams, recipeTotals } from './recipes';
import type { Food, Recipe } from './types';

export interface PlanItem {
  recipe_id: string;
  portions: number;
  /** The user set this count by hand; scaling leaves it alone. */
  pinned?: boolean;
}

export interface PlanInputs {
  /** Daily kcal / protein targets. */
  kcal: number;
  protein_g: number;
  /** Days the plan covers. */
  days: number;
  /** What is eaten outside the plan every day (breakfast, snacks). */
  allowance_kcal: number;
  allowance_protein_g: number;
}

export interface RecipeFacts {
  recipe: Recipe;
  /** Whole-recipe totals at its current items. */
  kcal: number;
  protein_g: number;
  fiber_g: number;
  yield_g: number;
  /** Per one of the recipe's own portions. */
  portion_kcal: number;
  portion_protein_g: number;
  portion_fiber_g: number;
  portion_g: number;
}

export function recipeFacts(recipe: Recipe, foods: ReadonlyMap<string, Food>): RecipeFacts {
  const t = recipeTotals(recipe.items, foods);
  const y = effectiveYield(recipe);
  const p = portionGrams(recipe);
  const share = y > 0 ? p / y : 0;
  return {
    recipe,
    kcal: t.kcal,
    protein_g: t.protein_g,
    fiber_g: t.fiber_g,
    yield_g: y,
    portion_kcal: t.kcal * share,
    portion_protein_g: t.protein_g * share,
    portion_fiber_g: t.fiber_g * share,
    portion_g: p,
  };
}

export interface ScaledPlan {
  items: PlanItem[];
  /** Per day, from the plan alone (allowance excluded). */
  kcal_per_day: number;
  protein_per_day: number;
  fiber_per_day: number;
  /** Plan + allowance against the targets. */
  kcal_ratio: number;
  protein_ratio: number;
  /** Portion grams per recipe after uniform scaling to hit the budget. */
  portion_g: Record<string, number>;
  budget_kcal: number;
}

/**
 * §18.2 — portion counts for the week. Unpinned recipes share the remaining kcal budget
 * equally (by kcal, so a light salad gets more portions than a lasagne); counts are whole
 * portions; a final uniform gram factor (0.7–1.3) closes the gap to ±5 %.
 */
export function scalePlan(
  facts: readonly RecipeFacts[],
  current: readonly PlanItem[],
  inputs: PlanInputs,
): ScaledPlan {
  const budget = Math.max(0, (inputs.kcal - inputs.allowance_kcal) * inputs.days);
  const byId = new Map(facts.map((f) => [f.recipe.id, f]));
  // portions 0 means "not this week" (a skipped card): it stays on the plan so the deck does
  // not offer it again, but it takes no share of the budget.
  const chosen = current.filter(
    (i) => i.portions > 0 && byId.has(i.recipe_id) && byId.get(i.recipe_id)!.portion_kcal > 0,
  );
  const pinned = chosen.filter((i) => i.pinned);
  const free = chosen.filter((i) => !i.pinned);
  const pinnedKcal = pinned.reduce(
    (a, i) => a + byId.get(i.recipe_id)!.portion_kcal * i.portions,
    0,
  );
  const remaining = Math.max(0, budget - pinnedKcal);

  const items: PlanItem[] = pinned.map((i) => ({ ...i }));
  if (free.length > 0) {
    const perRecipe = remaining / free.length;
    for (const i of free) {
      const f = byId.get(i.recipe_id)!;
      items.push({
        recipe_id: i.recipe_id,
        portions: Math.max(1, Math.round(perRecipe / f.portion_kcal)),
      });
    }
  }

  // Uniform gram factor to land inside ±5 % of the budget, bounded so portions stay real.
  const planKcal = items.reduce((a, i) => a + byId.get(i.recipe_id)!.portion_kcal * i.portions, 0);
  const factor = planKcal > 0 && budget > 0 ? Math.min(1.3, Math.max(0.7, budget / planKcal)) : 1;
  const portion_g: Record<string, number> = {};
  let kcal = 0;
  let protein = 0;
  let fiber = 0;
  for (const i of items) {
    const f = byId.get(i.recipe_id)!;
    portion_g[i.recipe_id] = Math.round(f.portion_g * factor);
    kcal += f.portion_kcal * factor * i.portions;
    protein += f.portion_protein_g * factor * i.portions;
    fiber += f.portion_fiber_g * factor * i.portions;
  }
  const days = Math.max(1, inputs.days);
  return {
    items,
    kcal_per_day: kcal / days,
    protein_per_day: protein / days,
    fiber_per_day: fiber / days,
    kcal_ratio: inputs.kcal > 0 ? (kcal / days + inputs.allowance_kcal) / inputs.kcal : 0,
    protein_ratio:
      inputs.protein_g > 0 ? (protein / days + inputs.allowance_protein_g) / inputs.protein_g : 0,
    portion_g,
    budget_kcal: budget,
  };
}

// ---- Shopping list ----

export type Aisle =
  | 'Produce'
  | 'Meat & fish'
  | 'Dairy & eggs'
  | 'Bakery'
  | 'Grains & pasta'
  | 'Tins & jars'
  | 'Frozen'
  | 'Drinks'
  | 'Oils & spices'
  | 'Other';

export const AISLE_ORDER: Aisle[] = [
  'Produce',
  'Meat & fish',
  'Dairy & eggs',
  'Bakery',
  'Grains & pasta',
  'Tins & jars',
  'Frozen',
  'Drinks',
  'Oils & spices',
  'Other',
];

const AISLE_RULES: [RegExp, Aisle][] = [
  [/frozen/i, 'Frozen'],
  [/canned|jar|tinned/i, 'Tins & jars'],
  [/vegetable|fruit|legume|nut and seed|mushroom|herb/i, 'Produce'],
  [
    /poultry|beef|pork|lamb|sausage|finfish|shellfish|fish|meat|seafood|chicken|turkey/i,
    'Meat & fish',
  ],
  [/dairy|egg|cheese|milk|yogurt/i, 'Dairy & eggs'],
  [/baked|bread|bakery|cake|cookie|pastr/i, 'Bakery'],
  [/cereal|grain|pasta|rice|flour|oat/i, 'Grains & pasta'],
  [/beverage|drink|coffee|tea|juice|water/i, 'Drinks'],
  [
    /fats and oils|oil|spice|herb|condiment|sauce|dressing|vinegar|salt|sugar|sweet/i,
    'Oils & spices',
  ],
  [/soup/i, 'Tins & jars'],
];

/** Aisle: the form in the name first (frozen, tinned), then the source category, then the name. */
export function aisleFor(food: Pick<Food, 'name' | 'category'>): Aisle {
  if (/frozen/i.test(food.name)) return 'Frozen';
  if (/canned|tinned|jar/i.test(food.name)) return 'Tins & jars';
  for (const text of [food.category ?? '', food.name]) {
    for (const [re, aisle] of AISLE_RULES) if (re.test(text)) return aisle;
  }
  return 'Other';
}

export interface Price {
  food_id: string;
  /** In the user's currency, per kilogram. */
  price_per_kg: number;
  /** A suggestion's guess rather than something the user paid (§18.6). */
  estimated?: boolean | undefined;
}

export interface ShoppingLine {
  food_id: string;
  name: string;
  aisle: Aisle;
  grams: number;
  /** Which recipes need it. */
  recipes: string[];
  cost?: number | undefined;
  price_per_kg?: number | undefined;
  /** The price behind `cost` is an estimate. */
  estimated?: boolean | undefined;
}

export interface ShoppingList {
  aisles: { aisle: Aisle; lines: ShoppingLine[] }[];
  total_cost: number;
  /** Lines with no price yet. */
  unpriced: number;
  /** Priced lines whose price is an estimate. */
  estimated: number;
}

export interface PlanSummary {
  /** Portions cooked across the week, and what that is per day. */
  portions: number;
  portions_per_day: number;
  /** Recipes actually in the week. */
  recipes: number;
  /** Cooked grams across the week. */
  grams: number;
  cost_per_day: number;
  cost_per_portion: number;
  /** Per day, plan + allowance, against the day's targets. */
  kcal: number;
  protein_g: number;
  fiber_g: number;
  kcal_target: number;
  protein_target: number;
  /** Fiber has no plan target; 14 g per 1000 kcal is the §3.4 rule. */
  fiber_target: number;
  /** What the week is furthest from, as a sentence's worth of facts. */
  shortest: 'calories' | 'protein' | 'fiber' | null;
  shortest_gap: number;
}

/**
 * §18.2 — the week read back in the units a person thinks in: portions, days, money, and the
 * one target the plan is furthest from. Pure; the screen only formats it.
 */
export function planSummary(
  plan: ScaledPlan,
  facts: readonly RecipeFacts[],
  inputs: PlanInputs,
  total_cost: number,
): PlanSummary {
  const byId = new Map(facts.map((f) => [f.recipe.id, f]));
  let portions = 0;
  let grams = 0;
  for (const i of plan.items) {
    const f = byId.get(i.recipe_id);
    if (!f) continue;
    portions += i.portions;
    grams += (plan.portion_g[i.recipe_id] ?? f.portion_g) * i.portions;
  }
  const days = Math.max(1, inputs.days);
  const kcal = plan.kcal_per_day + inputs.allowance_kcal;
  const protein_g = plan.protein_per_day + inputs.allowance_protein_g;
  const fiber_g = plan.fiber_per_day;
  const fiber_target = Math.max((14 * inputs.kcal) / 1000, 25);
  const gaps: [PlanSummary['shortest'], number][] = [
    ['calories', inputs.kcal - kcal],
    ['protein', inputs.protein_g - protein_g],
    ['fiber', fiber_target - fiber_g],
  ];
  // Relative to each target, so 300 kcal and 20 g of protein compare fairly.
  const worst = gaps
    .map(([k, gap], i) => ({
      k,
      gap,
      rel: gap / [inputs.kcal, inputs.protein_g, fiber_target][i]!,
    }))
    .filter((x) => x.gap > 0)
    .sort((a, b) => b.rel - a.rel)[0];
  return {
    portions,
    portions_per_day: portions / days,
    recipes: plan.items.filter((i) => i.portions > 0).length,
    grams: Math.round(grams),
    cost_per_day: total_cost / days,
    cost_per_portion: portions > 0 ? total_cost / portions : 0,
    kcal,
    protein_g,
    fiber_g,
    kcal_target: inputs.kcal,
    protein_target: inputs.protein_g,
    fiber_target,
    shortest: worst?.k ?? null,
    shortest_gap: worst ? Math.round(worst.gap) : 0,
  };
}

/** §18.3 — ingredients summed across the plan (portion-scaled), grouped by aisle. */
export function shoppingList(
  plan: ScaledPlan,
  facts: readonly RecipeFacts[],
  foods: ReadonlyMap<string, Food>,
  prices: ReadonlyMap<string, Price>,
): ShoppingList {
  const byId = new Map(facts.map((f) => [f.recipe.id, f]));
  const lines = new Map<string, ShoppingLine>();
  for (const item of plan.items) {
    const f = byId.get(item.recipe_id);
    if (!f) continue;
    // Grams of the whole recipe needed = portions × scaled portion ÷ yield, applied to raw items.
    const scale =
      f.yield_g > 0
        ? ((plan.portion_g[item.recipe_id] ?? f.portion_g) * item.portions) / f.yield_g
        : 0;
    for (const it of f.recipe.items) {
      const food = foods.get(it.food_id);
      const line =
        lines.get(it.food_id) ??
        lines
          .set(it.food_id, {
            food_id: it.food_id,
            name: food?.name ?? it.name,
            aisle: food ? aisleFor(food) : 'Other',
            grams: 0,
            recipes: [],
          })
          .get(it.food_id)!;
      line.grams += it.grams * scale;
      if (!line.recipes.includes(f.recipe.name)) line.recipes.push(f.recipe.name);
    }
  }
  let total = 0;
  let unpriced = 0;
  let estimated = 0;
  for (const line of lines.values()) {
    line.grams = Math.round(line.grams);
    const p = prices.get(line.food_id);
    if (p && p.price_per_kg > 0) {
      line.price_per_kg = p.price_per_kg;
      line.cost = (line.grams / 1000) * p.price_per_kg;
      total += line.cost;
      if (p.estimated) {
        line.estimated = true;
        estimated++;
      }
    } else unpriced++;
  }
  const aisles = AISLE_ORDER.map((aisle) => ({
    aisle,
    lines: [...lines.values()].filter((l) => l.aisle === aisle).sort((a, b) => b.grams - a.grams),
  })).filter((g) => g.lines.length > 0);
  return { aisles, total_cost: total, unpriced, estimated };
}

/** Plain text for sharing. */
export function shoppingListText(list: ShoppingList, currency: string): string {
  const out: string[] = ['Kalib — shopping list'];
  for (const g of list.aisles) {
    out.push('', g.aisle);
    for (const l of g.lines) {
      const qty = l.grams >= 1000 ? `${(l.grams / 1000).toFixed(2)} kg` : `${l.grams} g`;
      out.push(
        `- ${l.name.split(',').slice(0, 2).join(',')} — ${qty}${l.cost != null ? ` (${currency}${l.cost.toFixed(2)})` : ''}`,
      );
    }
  }
  if (list.total_cost > 0) {
    out.push(
      '',
      `About ${currency}${list.total_cost.toFixed(0)} (${list.estimated ? 'rough — ' + list.estimated + ' estimated prices' : '±15 %'})${list.unpriced ? `, ${list.unpriced} items unpriced` : ''}`,
    );
  }
  return out.join('\n');
}
