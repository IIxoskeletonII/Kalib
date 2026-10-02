import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { getRecipe } from '@/db/repo/recipes';
import { gramsFor, importUrlRecipe, looksLikeUrl, readRecipeLink, readyCount } from './recipeUrl';
import type { Food } from '@/core/types';

// The endpoint needs a session; the token itself is irrelevant to what is tested here.
vi.mock('@/services/apiAuth', () => ({
  authHeaders: async () => ({ authorization: 'Bearer test' }),
}));

const food = (over: Partial<Food>): Food =>
  ({
    id: over.id ?? 'f',
    user_id: 'local',
    created_at: '',
    updated_at: '',
    source: 'usda_foundation',
    name: 'Food',
    per_100g: { kcal: 100, protein: 5, carb: 10, fat: 2, fiber: 1 },
    micros: {},
    micro_coverage: 0,
    portions: [],
    verified: true,
    ...over,
  }) as Food;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.foods.bulkPut([
    food({
      id: 'lentils',
      name: 'Lentils, red, raw',
      per_100g: { kcal: 358, protein: 24, carb: 63, fat: 1.1, fiber: 11 },
    }),
    food({
      id: 'oil',
      name: 'Olive oil',
      per_100g: { kcal: 884, protein: 0, carb: 0, fat: 100, fiber: 0 },
    }),
    food({
      id: 'tomatoes',
      name: 'Tomatoes, canned',
      per_100g: { kcal: 32, protein: 1.6, carb: 7, fat: 0.3, fiber: 1.9 },
    }),
    food({
      id: 'egg',
      name: 'Egg, whole, raw',
      per_100g: { kcal: 143, protein: 12.6, carb: 0.7, fat: 9.5, fiber: 0 },
      portions: [{ label: 'large egg', grams: 50 }],
    }),
  ]);
});

const PAGE = {
  recipe: {
    name: 'Lentil ragu',
    blurb: 'A thick lentil ragu.',
    ingredients: [
      '250 g red lentils',
      '2 tbsp olive oil',
      '1 tin (400 g) canned tomatoes',
      '2 large eggs',
      'salt and pepper',
      'a splash of balsamic vinegar',
    ],
    steps: ['Soften the onion.', 'Simmer 30 minutes.'],
    servings: 4,
    time_min: 45,
    source: 'https://example.com/ragu',
  },
  via: 'json-ld' as const,
};

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 422 })),
  );
}

describe('looksLikeUrl', () => {
  it('accepts a web link and refuses everything else', () => {
    expect(looksLikeUrl('https://www.bbcgoodfood.com/recipes/x')).toBe(true);
    expect(looksLikeUrl('  http://example.com/r  ')).toBe(true);
    expect(looksLikeUrl('KALIB1:abc')).toBe(false);
    expect(looksLikeUrl('example.com')).toBe(false);
    expect(looksLikeUrl('https://localhost')).toBe(false); // no dot: not a public page
  });
});

describe('gramsFor', () => {
  it('takes a stated weight and says so', () => {
    expect(
      gramsFor(
        { raw: '', term: '', name: '', seasoning: false, grams: 250, basis: 'weight' },
        undefined,
      ),
    ).toEqual({
      grams: 250,
      note: '250 g as written',
    });
  });

  it('names the assumption behind a spoon or a tin', () => {
    expect(
      gramsFor(
        { raw: '', term: '', name: '', seasoning: false, grams: 30, basis: 'measure' },
        undefined,
      ).note,
    ).toContain('spoon measure');
    expect(
      gramsFor(
        { raw: '', term: '', name: '', seasoning: false, grams: 400, basis: 'package' },
        undefined,
      ).note,
    ).toContain('standard pack');
  });

  it("answers a bare count from the food's own portions, not a guess", () => {
    const egg = food({
      id: 'egg',
      name: 'Egg, whole, raw',
      portions: [{ label: 'large egg', grams: 50 }],
    });
    const out = gramsFor(
      { raw: '', term: 'eggs', name: 'eggs', seasoning: false, count: 2, basis: 'count' },
      egg,
    );
    expect(out.grams).toBe(100);
    expect(out.note).toContain('large egg');
  });

  it('leaves a count unresolved when the food has no portions to offer', () => {
    const out = gramsFor(
      { raw: '', term: 'onion', name: 'onion', seasoning: false, count: 1, basis: 'count' },
      food({ id: 'onion', portions: [] }),
    );
    expect(out.grams).toBeUndefined();
    expect(out.note).toContain('set it before saving');
  });

  it('marks seasoning as deliberately left out', () => {
    const out = gramsFor({ raw: '', term: '', name: 'salt', seasoning: true }, undefined);
    expect(out.grams).toBeUndefined();
    expect(out.note).toContain('Seasoning');
  });
});

describe('readRecipeLink', () => {
  it('reads a page into matched, weighed lines', async () => {
    mockFetch(PAGE);
    const r = await readRecipeLink('https://example.com/ragu');
    expect(r.name).toBe('Lentil ragu');
    expect(r.servings).toBe(4);
    expect(r.time_min).toBe(45);
    expect(r.steps).toHaveLength(2);
    expect(r.via).toBe('json-ld');
    expect(r.lines).toHaveLength(6);

    const byName = (needle: string) => r.lines.find((l) => l.parsed.name.includes(needle))!;
    expect(byName('lentils').grams).toBe(250);
    expect(byName('lentils').food?.id).toBe('lentils');
    expect(byName('olive oil').grams).toBe(30);
    expect(byName('tomatoes').grams).toBe(400);
    // The bare count is answered by the egg's own 50 g portion.
    expect(byName('eggs').grams).toBe(100);
  });

  it('leaves out seasoning and anything with no stated amount', async () => {
    mockFetch(PAGE);
    const r = await readRecipeLink('https://example.com/ragu');
    const salt = r.lines.find((l) => l.parsed.seasoning)!;
    expect(salt.skipped).toBe(true);
    const vinegar = r.lines.find((l) => l.parsed.name.includes('balsamic'))!;
    expect(vinegar.skipped).toBe(true);
    expect(readyCount(r)).toBe(4);
  });

  it('passes the error the Worker gave, not a generic one', async () => {
    mockFetch({ error: 'No recipe found on that page. You can still add it by hand.' }, false);
    await expect(readRecipeLink('https://example.com/blog')).rejects.toThrow('by hand');
  });
});

describe('importUrlRecipe', () => {
  it('saves only the lines that resolved, with the steps and the credit', async () => {
    mockFetch(PAGE);
    const read = await readRecipeLink('https://example.com/ragu');
    const id = await importUrlRecipe(read);
    const saved = (await getRecipe(id))!;

    expect(saved.name).toBe('Lentil ragu');
    expect(saved.items).toHaveLength(4); // the two unresolved lines are not invented
    expect(saved.portions).toBe(4);
    expect(saved.steps).toEqual(['Soften the onion.', 'Simmer 30 minutes.']);
    expect(saved.time_min).toBe(45);
    expect(saved.source).toBe('imported');
    expect(saved.source_url).toBe('https://example.com/ragu');
    const grams = saved.items.map((i) => i.grams).sort((a, b) => a - b);
    expect(grams).toEqual([30, 100, 250, 400]);
  });

  it('never writes a recipe with no ingredients at all', async () => {
    mockFetch({
      recipe: { ...PAGE.recipe, ingredients: ['salt and pepper'] },
      via: 'model',
    });
    const read = await readRecipeLink('https://example.com/thin');
    expect(readyCount(read)).toBe(0);
    // The screen disables saving at this point; the service still must not corrupt anything.
    const id = await importUrlRecipe(read);
    expect((await getRecipe(id))!.items).toHaveLength(0);
  });
});
