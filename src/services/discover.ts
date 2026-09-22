// SPEC §18.6 — suggestions: ask the Worker, keep the batch for the week, and turn an accepted
// card into a real recipe (ingredients grounded like §9.4, steps kept, prices recorded as
// estimates) that the planner then treats like any other.
import { groundItems, matchItems, type GroundedItem } from '@/core/estimate';
import { parseSuggestions, toEstimateItems, type Suggestion } from '@/core/discover';
import type { Food } from '@/core/types';
import { getFoods, listSearchDocs } from '@/db/repo/foods';
import { foodUsageCounts } from '@/db/repo/logEntries';
import { getSetting, setSetting } from '@/db/repo/settings';
import { setPrice } from '@/db/repo/planner';
import { authHeaders } from '@/services/apiAuth';
import { createCustomFood } from '@/services/customFoods';
import { decide, setBudget, type PlanContext } from '@/services/planner';
import {
  addRecipeItem,
  createRecipe,
  setRecipeMeta,
  setRecipePortions,
  setRecipeSteps,
} from '@/services/recipes';

export interface DiscoverInputs {
  budget: number;
  tags: string[];
  count: number;
  avoid: string;
  /** Mix in recipes other people kept (free, instant). */
  include_bank: boolean;
}

export interface DiscoverState {
  inputs: DiscoverInputs;
  /** Cards still to decide, in order. */
  pending: Suggestion[];
  /** Names already accepted or rejected this week, so the next batch avoids them. */
  seen: string[];
  requested_at: string;
  model?: string;
}

export const DISCOVER_INPUTS_KEY = 'discover:inputs';
export const DEFAULT_INPUTS: DiscoverInputs = {
  budget: 0,
  tags: [],
  count: 4,
  avoid: '',
  include_bank: true,
};

export function discoverKey(week_start: string): string {
  return `discover:${week_start}`;
}

export async function getDiscover(week_start: string): Promise<DiscoverState | null> {
  return (await getSetting<DiscoverState>(discoverKey(week_start))) ?? null;
}

export async function getDiscoverInputs(): Promise<DiscoverInputs> {
  return (await getSetting<DiscoverInputs>(DISCOVER_INPUTS_KEY)) ?? DEFAULT_INPUTS;
}

/** Asks for a batch; appends to whatever is still pending for the week. */
export async function requestSuggestions(
  ctx: PlanContext,
  inputs: DiscoverInputs,
): Promise<{ added: number; used?: number; cap?: number }> {
  const auth = await authHeaders();
  if (!('authorization' in auth)) {
    throw new Error('Sign in first (Settings → Sync). Suggestions run on the server.');
  }
  await setSetting(DISCOVER_INPUTS_KEY, inputs);
  if (inputs.budget !== ctx.budget) await setBudget(ctx, inputs.budget);
  const current = await getDiscover(ctx.week_start);
  const exclude = [
    ...ctx.recipes.map((r) => r.name),
    ...(current?.seen ?? []),
    ...(current?.pending ?? []).map((s) => s.name),
  ];
  const perDay = ctx.inputs.kcal - ctx.inputs.allowance_kcal;
  // One dinner is roughly 40 % of what is left for planned meals; protein likewise.
  const kcal_per_portion = Math.round(Math.max(300, Math.min(1200, perDay * 0.4)));
  const protein_per_portion = Math.round(
    Math.max(20, Math.min(90, (ctx.inputs.protein_g - ctx.inputs.allowance_protein_g) * 0.4)),
  );
  const res = await fetch('/api/suggest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({
      budget: inputs.budget,
      currency: ctx.currency,
      tags: inputs.tags,
      count: inputs.count,
      avoid: inputs.avoid,
      kcal_per_portion,
      protein_per_portion,
      exclude: exclude.slice(-40),
      locale: navigator.language,
      include_bank: inputs.include_bank,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    result?: unknown;
    model?: string;
    used?: number;
    cap?: number;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? `Suggestions failed (${res.status}).`);
  const fresh = parseSuggestions(data.result).filter(
    (s) => !exclude.some((n) => n.toLowerCase() === s.name.toLowerCase()),
  );
  const next: DiscoverState = {
    inputs,
    pending: [...(current?.pending ?? []), ...fresh],
    seen: current?.seen ?? [],
    requested_at: new Date().toISOString(),
    ...(data.model ? { model: data.model } : {}),
  };
  await setSetting(discoverKey(ctx.week_start), next);
  return {
    added: fresh.length,
    ...(data.used != null ? { used: data.used } : {}),
    ...(data.cap != null ? { cap: data.cap } : {}),
  };
}

async function settle(week_start: string, s: Suggestion): Promise<void> {
  const current = await getDiscover(week_start);
  if (!current) return;
  await setSetting(discoverKey(week_start), {
    ...current,
    pending: current.pending.filter((p) => p.name !== s.name),
    seen: [...current.seen, s.name].slice(-60),
  } satisfies DiscoverState);
}

export async function rejectSuggestion(week_start: string, s: Suggestion): Promise<void> {
  await settle(week_start, s);
}

/** Ground the ingredients against the offline database; the rest become own foods. */
export async function groundSuggestion(s: Suggestion): Promise<GroundedItem[]> {
  const items = toEstimateItems(s);
  const [docs, usage] = await Promise.all([listSearchDocs(), foodUsageCounts()]);
  const matches = matchItems(items, docs, usage);
  const foods = await getFoods(matches.filter((id): id is string => id != null));
  return groundItems(items, matches, foods);
}

/**
 * Swipe right: the suggestion becomes a recipe of the user's own (grounded ingredients, the
 * model's steps and metadata), its ingredients get estimated prices where none exist, and it
 * goes into the week. Returns the new recipe id.
 */
export async function acceptSuggestion(ctx: PlanContext, s: Suggestion): Promise<string> {
  const grounded = await groundSuggestion(s);
  const recipe = await createRecipe(s.name);
  for (let i = 0; i < grounded.length; i++) {
    const g = grounded[i]!;
    const ing = s.ingredients[i]!;
    let food: Food;
    if (g.food) food = g.food;
    else {
      food = await createCustomFood({
        name: ing.name,
        serving_g: 100,
        kcal: ing.per_100g.kcal,
        protein_g: ing.per_100g.protein,
        carb_g: ing.per_100g.carb,
        fat_g: ing.per_100g.fat,
        fiber_g: ing.per_100g.fiber,
      });
    }
    await addRecipeItem(recipe.id, food, ing.grams);
    if (ing.price_per_kg > 0) await setPrice(food.id, ing.price_per_kg, ctx.currency, true);
  }
  await setRecipePortions(recipe.id, s.portions);
  if (s.steps.length) await setRecipeSteps(recipe.id, s.steps);
  await setRecipeMeta(recipe.id, {
    blurb: s.blurb,
    tags: s.tags,
    time_min: s.time_min,
    ...(s.oven_c != null ? { oven_c: s.oven_c } : {}),
    source: 'suggested',
  });
  await decide(ctx, recipe.id, true);
  await settle(ctx.week_start, s);
  // The shared bank grows with every kept card; nobody's data goes with it.
  void fetch('/api/suggest/keep', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ recipe: s }),
  }).catch(() => undefined);
  return recipe.id;
}
