import { describe, expect, it } from 'vitest';
import { buildSearchDoc, searchFoods, tokenize } from './search';

const docs = [
  buildSearchDoc({
    id: 'f1',
    name: 'Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw',
    source: 'usda_foundation',
  }),
  buildSearchDoc({
    id: 's1',
    name: 'Chicken, broilers or fryers, breast, meat only, cooked, roasted',
    source: 'usda_sr',
  }),
  buildSearchDoc({
    id: 's2',
    name: 'Chicken, broilers or fryers, thigh, meat only, cooked, roasted',
    source: 'usda_sr',
  }),
  buildSearchDoc({ id: 'c1', name: 'Chicken breast (my batch)', source: 'custom' }),
  buildSearchDoc({ id: 'f2', name: 'Egg, whole, raw, fresh', source: 'usda_foundation' }),
  buildSearchDoc({ id: 's3', name: 'Crème fraîche', brand: 'Président', source: 'off' }),
  buildSearchDoc({ id: 'f3', name: 'Zucchini, raw', source: 'usda_foundation' }),
];

describe('tokenize', () => {
  it('lowercases, strips diacritics and punctuation', () => {
    expect(tokenize('Crème fraîche, Président!')).toEqual(['creme', 'fraiche', 'president']);
    expect(tokenize('  ')).toEqual([]);
  });
});

describe('searchFoods', () => {
  it('returns nothing for an empty query', () => {
    expect(searchFoods(docs, '')).toEqual([]);
    expect(searchFoods(docs, ' , ')).toEqual([]);
  });

  it('requires every query token to prefix-match', () => {
    const ids = searchFoods(docs, 'chicken breast').map((h) => h.id);
    expect(ids).toContain('f1');
    expect(ids).toContain('s1');
    expect(ids).toContain('c1');
    expect(ids).not.toContain('s2');
    expect(ids).not.toContain('f2');
  });

  it('ranks custom above Foundation above SR Legacy for equal matches', () => {
    const ids = searchFoods(docs, 'chicken breast').map((h) => h.id);
    expect(ids.indexOf('c1')).toBeLessThan(ids.indexOf('f1'));
    expect(ids.indexOf('f1')).toBeLessThan(ids.indexOf('s1'));
  });

  it('boosts foods the user logs often', () => {
    const usage = new Map([['s1', 20]]);
    const ids = searchFoods(docs, 'chicken breast', usage).map((h) => h.id);
    expect(ids[0]).toBe('s1');
  });

  it('matches partial words and diacritic-insensitive input', () => {
    expect(searchFoods(docs, 'zucc').map((h) => h.id)).toEqual(['f3']);
    expect(searchFoods(docs, 'creme fra').map((h) => h.id)).toEqual(['s3']);
    expect(searchFoods(docs, 'president').map((h) => h.id)).toEqual(['s3']);
  });

  it('honours the limit', () => {
    expect(searchFoods(docs, 'chicken', undefined, 2)).toHaveLength(2);
  });

  it('prefers a match in the head noun over a later token', () => {
    const d = [
      buildSearchDoc({ id: 'a', name: 'Oil, olive, salad or cooking', source: 'usda_sr' }),
      buildSearchDoc({ id: 'b', name: 'Olives, ripe, canned', source: 'usda_sr' }),
    ];
    expect(searchFoods(d, 'oliv')[0]!.id).toBe('b');
  });
});

describe('everyday ranking (regressions from real use)', () => {
  const doc = (id: string, name: string, source: 'usda_foundation' | 'usda_sr') =>
    buildSearchDoc({ id, name, source });
  const docs = [
    doc('anch', 'Anchovies, canned in olive oil, with salt, drained', 'usda_foundation'),
    doc('oil', 'Oil, olive, salad or cooking', 'usda_sr'),
    doc('mix', 'Oil, corn, peanut, and olive', 'usda_sr'),
    doc('pep', 'Peppers, banana or Hungarian wax, seeded', 'usda_foundation'),
    doc('ban', 'Bananas, overripe, raw', 'usda_foundation'),
    doc('yolk', 'Egg, yolk, dried', 'usda_foundation'),
    doc('egg', 'Eggs, Grade A, Large, egg whole', 'usda_foundation'),
  ];
  it('"olive oil" is the oil, not a fish packed in it', () => {
    expect(
      searchFoods(docs, 'olive oil')
        .map((h) => h.id)
        .slice(0, 2),
    ).toEqual(['oil', 'mix']);
  });
  it('"banana" is the fruit, not the pepper', () => {
    expect(searchFoods(docs, 'banana')[0]!.id).toBe('ban');
  });
  it('plural queries find singular names, and dried forms rank below whole ones', () => {
    expect(searchFoods(docs, 'eggs')[0]!.id).toBe('egg');
    expect(searchFoods(docs, 'egg')[0]!.id).toBe('egg');
  });
});
