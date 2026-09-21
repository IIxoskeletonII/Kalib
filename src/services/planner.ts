// SPEC §18 — the week's plan: which recipes, how many portions, what to buy.
import { weekStart } from '@/core/banking';
import { todayKey } from '@/core/dates';
import {
  recipeFacts,
  scalePlan,
  shoppingList,
  type PlanInputs,
  type Price,
  type RecipeFacts,
  type ScaledPlan,
  type ShoppingList,
} from '@/core/planner';
import type { Food, FoodPrice, Recipe, SyncMeta, WeekPlan, WeekPlanItem } from '@/core/types';
import { getFoods } from '@/db/repo/foods';
import { foodUsageCounts } from '@/db/repo/logEntries';
import { getPlan, listPrices, setPrice, upsertPlan } from '@/db/repo/planner';
import { listRecipes } from '@/db/repo/recipes';
import { getSetting, setSetting } from '@/db/repo/settings';
import { currentTargets } from './targets';

export const CURRENCY_KEY = 'currency';
const ALLOWANCE_KEY = 'plan:allowance';

export interface PlanContext {
  week_start: string;
  plan: WeekPlan | undefined;
  /** Working copy: the stored plan or the defaults. */
  draft: Omit<WeekPlan, keyof SyncMeta>;
  recipes: Recipe[];
  facts: RecipeFacts[];
  foods: Map<string, Food>;
  prices: Map<string, Price>;
  currency: string;
  inputs: PlanInputs;
  scaled: ScaledPlan;
  list: ShoppingList;
  /** Recipes not yet decided this week, rotation first. */
  deck: Recipe[];
  skipped: Recipe[];
}

export function thisWeek(date: string = todayKey()): string {
  return weekStart(date);
}

export async function planContext(week_start: string): Promise<PlanContext> {
  const [plan, recipes, priceRows, usage, targets, currency, allowance] = await Promise.all([
    getPlan(week_start),
    listRecipes(),
    listPrices(),
    foodUsageCounts(),
    currentTargets(todayKey()),
    getSetting<string>(CURRENCY_KEY),
    getSetting<{ kcal: number; protein_g: number }>(ALLOWANCE_KEY),
  ]);
  const ids = new Set<string>();
  for (const r of recipes) for (const it of r.items) ids.add(it.food_id);
  const foods = await getFoods([...ids]);
  const facts = recipes.map((r) => recipeFacts(r, foods));
  const prices = new Map<string, Price>(
    priceRows.map((p: FoodPrice) => [
      p.food_id,
      { food_id: p.food_id, price_per_kg: p.price_per_kg },
    ]),
  );
  const draft: PlanContext['draft'] = plan
    ? {
        week_start: plan.week_start,
        days: plan.days,
        allowance_kcal: plan.allowance_kcal,
        allowance_protein_g: plan.allowance_protein_g,
        items: plan.items,
        checked: plan.checked,
      }
    : {
        week_start,
        days: 7,
        allowance_kcal: allowance?.kcal ?? 0,
        allowance_protein_g: allowance?.protein_g ?? 0,
        items: [],
        checked: [],
      };
  const inputs: PlanInputs = {
    kcal: Math.round(targets?.kcal ?? 2000),
    protein_g: Math.round(targets?.protein_g ?? 120),
    days: draft.days,
    allowance_kcal: draft.allowance_kcal,
    allowance_protein_g: draft.allowance_protein_g,
  };
  const scaled = scalePlan(facts, draft.items, inputs);
  const list = shoppingList(scaled, facts, foods, prices);

  // Deck order: recipes logged most (rotation) first; skipped ones are remembered on the plan
  // as portions 0 so they are not offered again this week.
  const decided = new Set(draft.items.map((i) => i.recipe_id));
  const score = (r: Recipe) => usage.get(r.food_id) ?? 0;
  const undecided = recipes.filter((r) => !decided.has(r.id)).sort((a, b) => score(b) - score(a));
  const skipped = recipes.filter((r) =>
    draft.items.some((i) => i.recipe_id === r.id && i.portions === 0),
  );
  return {
    week_start,
    plan,
    draft,
    recipes,
    facts,
    foods,
    prices,
    currency: currency ?? '€',
    inputs,
    scaled,
    list,
    deck: undecided,
    skipped,
  };
}

async function save(ctx: PlanContext, patch: Partial<PlanContext['draft']>): Promise<void> {
  await upsertPlan({ ...ctx.draft, ...patch });
}

/** Swipe right (include) or left (skip) on the deck. */
export async function decide(ctx: PlanContext, recipe_id: string, include: boolean): Promise<void> {
  const items: WeekPlanItem[] = ctx.draft.items.filter((i) => i.recipe_id !== recipe_id);
  items.push({ recipe_id, portions: include ? 1 : 0 });
  await save(ctx, { items });
}

/** Take a skipped recipe back into the deck. */
export async function undecide(ctx: PlanContext, recipe_id: string): Promise<void> {
  await save(ctx, { items: ctx.draft.items.filter((i) => i.recipe_id !== recipe_id) });
}

/** Pin a portion count by hand (0 removes it from the week). */
export async function setPortions(ctx: PlanContext, recipe_id: string, portions: number) {
  const items = ctx.draft.items.map((i) =>
    i.recipe_id === recipe_id
      ? { ...i, portions: Math.max(0, Math.round(portions)), pinned: true }
      : i,
  );
  await save(ctx, { items });
}

export async function unpin(ctx: PlanContext, recipe_id: string): Promise<void> {
  const items = ctx.draft.items.map((i) =>
    i.recipe_id === recipe_id ? { recipe_id: i.recipe_id, portions: 1 } : i,
  );
  await save(ctx, { items });
}

export async function setAllowance(ctx: PlanContext, kcal: number, protein_g: number) {
  await setSetting(ALLOWANCE_KEY, { kcal, protein_g });
  await save(ctx, { allowance_kcal: kcal, allowance_protein_g: protein_g });
}

export async function setDays(ctx: PlanContext, days: number): Promise<void> {
  await save(ctx, { days: Math.min(14, Math.max(1, Math.round(days))) });
}

export async function toggleChecked(ctx: PlanContext, food_id: string): Promise<void> {
  const checked = ctx.draft.checked.includes(food_id)
    ? ctx.draft.checked.filter((id) => id !== food_id)
    : [...ctx.draft.checked, food_id];
  await save(ctx, { checked });
}

export async function savePrice(food_id: string, price_per_kg: number, currency: string) {
  await setPrice(food_id, price_per_kg, currency);
}

/** The plan's items with the recipe facts and scaled grams, for the list on screen. */
export function planRows(ctx: PlanContext) {
  const byId = new Map(ctx.facts.map((f) => [f.recipe.id, f]));
  return ctx.scaled.items
    .map((item) => ({
      item,
      facts: byId.get(item.recipe_id)!,
      portion_g: ctx.scaled.portion_g[item.recipe_id] ?? byId.get(item.recipe_id)!.portion_g,
      pinned: ctx.draft.items.find((i) => i.recipe_id === item.recipe_id)?.pinned ?? false,
    }))
    .filter((r) => r.facts && r.item.portions > 0);
}
