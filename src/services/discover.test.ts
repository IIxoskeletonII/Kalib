import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Suggestion } from '@/core/discover';
import { db } from '@/db/db';
import { addFood } from '@/db/repo/foods';
import { listPrices } from '@/db/repo/planner';
import { getRecipe } from '@/db/repo/recipes';
import { setSetting } from '@/db/repo/settings';
import { acceptSuggestion, getDiscover, rejectSuggestion, requestSuggestions } from './discover';
import { planContext, thisWeek } from './planner';

const week = thisWeek('2026-09-22');

const suggestion: Suggestion = {
  name: 'Chickpea & spinach curry',
  blurb: 'Weeknight curry.',
  tags: ['high-fiber', 'vegetarian'],
  portions: 4,
  time_min: 35,
  ingredients: [
    {
      name: 'chickpeas, canned',
      search_term: 'chickpea canned',
      grams: 800,
      per_100g: { kcal: 139, protein: 7, carb: 22, fat: 2.6, fiber: 6 },
      price_per_kg: 2.2,
    },
    {
      name: 'dragon fruit powder',
      search_term: 'dragon fruit powder',
      grams: 50,
      per_100g: { kcal: 350, protein: 4, carb: 80, fat: 1, fiber: 10 },
      price_per_kg: 40,
    },
  ],
  steps: ['Soften the onion, 6 minutes.', 'Simmer 15 minutes.'],
  inspiration: 'Coconut Chickpea Curry (Budget Bytes)',
};

beforeEach(async () => {
  await db.delete();
  await db.open();
  await addFood({
    source: 'usda_foundation',
    name: 'Chickpeas, canned, drained',
    per_100g: { kcal: 140, protein: 7.5, carb: 22, fat: 2.5, fiber: 6.5 },
    micros: {},
    micro_coverage: 0,
    portions: [],
    verified: true,
  });
  await setSetting(`discover:${week}`, {
    inputs: { budget: 60, tags: [], count: 2, avoid: '', include_bank: true },
    pending: [suggestion],
    seen: [],
    requested_at: '2026-09-22T08:00:00Z',
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ ok: true }));
});
afterEach(() => vi.restoreAllMocks());

describe('accepting a suggestion', () => {
  it('grounds what the database knows, invents the rest, keeps steps, prices as estimates, joins the week', async () => {
    const ctx = await planContext(week);
    expect(ctx.suggestions.map((s) => s.name)).toEqual([suggestion.name]);

    const id = await acceptSuggestion(ctx, suggestion);
    const recipe = (await getRecipe(id))!;
    expect(recipe.name).toBe('Chickpea & spinach curry');
    expect(recipe.source).toBe('suggested');
    expect(recipe.steps).toEqual(suggestion.steps);
    expect(recipe.time_min).toBe(35);
    expect(recipe.portions).toBe(4);
    expect(recipe.items.map((i) => i.name)).toEqual([
      'Chickpeas, canned, drained', // grounded in the database row
      'dragon fruit powder', // nothing matched: an own food with the model's macros
    ]);
    const invented = await db.foods.get(recipe.items[1]!.food_id);
    expect(invented?.source).toBe('custom');
    expect(invented?.verified).toBe(false);
    expect(invented?.per_100g.kcal).toBe(350);

    const prices = await listPrices();
    expect(
      prices.map((p) => [p.price_per_kg, p.estimated]).sort((a, b) => +a[0]! - +b[0]!),
    ).toEqual([
      [2.2, true],
      [40, true],
    ]);

    const after = await planContext(week);
    expect(after.suggestions).toEqual([]);
    expect(after.draft.items).toEqual([{ recipe_id: id, portions: 1 }]);
    expect((await getDiscover(week))?.seen).toEqual([suggestion.name]);
    expect(after.list.estimated).toBe(2);
    expect(fetch).toHaveBeenCalledWith('/api/suggest/keep', expect.anything());
  });

  it('rejecting only remembers the name', async () => {
    await rejectSuggestion(week, suggestion);
    const d = await getDiscover(week);
    expect(d?.pending).toEqual([]);
    expect(d?.seen).toEqual([suggestion.name]);
    expect(await db.recipes.count()).toBe(0);
  });
});

describe('requesting suggestions', () => {
  it('sends targets, budget and exclusions, and appends what comes back', async () => {
    const ctx = await planContext(week);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body));
      expect(String(input)).toBe('/api/suggest');
      expect(body.exclude).toContain(suggestion.name);
      expect(body.count).toBe(2);
      expect(body.budget).toBe(60);
      expect(body.kcal_per_portion).toBeGreaterThan(0);
      return Response.json({
        result: { recipes: [{ ...suggestion, name: 'Harissa chicken tray' }] },
        model: 'm',
        used: 1,
        cap: 30,
      });
    });
    const inputs = { budget: 60, tags: ['quick'], count: 2, avoid: '', include_bank: true };
    // No session in tests → the service refuses before spending anything.
    await expect(requestSuggestions(ctx, inputs)).rejects.toThrow(/Sign in/);
  });
});
