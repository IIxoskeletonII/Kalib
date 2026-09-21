import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, extractShareCode, packRecipe } from './recipeShare';
import type { Food } from './types';

const food = (id: string, name: string, source: Food['source']): Food => ({
  id,
  user_id: 'local',
  created_at: '',
  updated_at: '',
  source,
  name,
  per_100g: { kcal: 120, protein: 22, carb: 0, fat: 2.6, fiber: 0 },
  micros: { iron: 0.4 },
  micro_coverage: 0.05,
  portions: [],
  verified: source !== 'custom',
});

describe('recipe share codes', () => {
  const chicken = food('usda_foundation:171077', 'Chicken, breast, raw', 'usda_foundation');
  const sauce = food('c1', 'Mum’s tomato sauce', 'custom');
  const foods = new Map([chicken, sauce].map((f) => [f.id, f]));
  const recipe = {
    name: 'Chicken & rice',
    portions: 4,
    yield_g: 2200,
    items: [
      { food_id: chicken.id, name: chicken.name, grams: 1000 },
      { food_id: sauce.id, name: sauce.name, grams: 300 },
      { food_id: 'gone', name: 'Deleted thing', grams: 50 },
    ],
  };

  it('packs seed foods by id and embeds own foods', () => {
    const p = packRecipe(recipe, foods);
    expect(p.items[0]).toEqual({ n: chicken.name, g: 1000, id: chicken.id });
    expect(p.items[1]!.f?.per_100g.kcal).toBe(120);
    expect(p.items[1]!.f?.micros).toEqual({ iron: 0.4 });
    expect(p.items[2]).toEqual({ n: 'Deleted thing', g: 50 });
    expect(p.yield_g).toBe(2200);
  });

  it('round-trips through a URL-safe code, with unicode', () => {
    const p = packRecipe(recipe, foods);
    const code = encodeShare(p);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeShare(code)).toEqual(p);
  });

  it('extracts the code from a pasted link or bare text', () => {
    const code = encodeShare(packRecipe(recipe, foods));
    expect(extractShareCode(`https://kalib.kalib.workers.dev/recipes/import#${code}`)).toBe(code);
    expect(extractShareCode(`  ${code}\n`)).toBe(code);
    expect(extractShareCode('hello there')).toBeUndefined();
  });

  it('rejects garbage and validates shapes', () => {
    expect(() => decodeShare('not base64!!')).toThrow(/not a Kalib recipe/);
    expect(() => decodeShare(encodeShare({ v: 1, name: 'x', portions: 2, items: [] }))).toThrow(
      /no ingredients/,
    );
    const loose = decodeShare(
      btoa(
        JSON.stringify({
          v: 1,
          name: ' ',
          portions: '3',
          items: [{ n: 'Rice', g: '400', id: 'usda_sr:1' }, { g: 0 }],
        }),
      ),
    );
    expect(loose.name).toBe('Shared recipe');
    expect(loose.portions).toBe(3);
    expect(loose.items).toEqual([{ n: 'Rice', g: 400, id: 'usda_sr:1' }]);
  });
});
