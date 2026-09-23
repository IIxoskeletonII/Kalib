import { describe, expect, it } from 'vitest';
import {
  budgetLine,
  dropNearDuplicates,
  parseSuggestions,
  similarity,
  suggestionFacts,
  toEstimateItems,
  TOO_SIMILAR,
  type Suggestion,
} from './discover';

const raw = {
  recipes: [
    {
      name: 'Chickpea & spinach curry',
      blurb: 'Weeknight curry with a squeeze of lime.',
      tags: ['high-fiber', 'vegetarian', 'bogus'],
      portions: 4,
      time_min: 35,
      oven_c: null,
      inspiration: 'Coconut Chickpea Curry (Budget Bytes)',
      ingredients: [
        {
          name: 'chickpeas, canned',
          search_term: 'chickpea canned',
          grams: 800,
          per_100g: { kcal: 139, protein: 7, carb: 22, fat: 2.6, fiber: 6 },
          price_per_kg: 2.2,
        },
        {
          name: 'spinach',
          search_term: 'spinach raw',
          grams: 300,
          per_100g: { kcal: 23, protein: 2.9, carb: 3.6, fat: 0.4, fiber: 2.2 },
          price_per_kg: 6,
        },
        { name: '', grams: 100, per_100g: {}, price_per_kg: 1 },
      ],
      steps: ['Soften the onion, 6 minutes.', 'Add spices, 1 minute.', '', 'Simmer 15 minutes.'],
    },
    { name: 'chickpea & Spinach Curry', ingredients: [{ name: 'x', grams: 10 }] },
    { name: 'No ingredients', ingredients: [] },
    { name: 'Roast', oven_c: 200, ingredients: [{ name: 'potato', grams: 1000 }], from_bank: true },
    'junk',
  ],
};

describe('parseSuggestions', () => {
  it('keeps what is usable, drops duplicates and empties, clamps numbers', () => {
    const s = parseSuggestions(raw);
    expect(s.map((x) => x.name)).toEqual(['Chickpea & spinach curry', 'Roast']);
    const c = s[0]!;
    expect(c.ingredients).toHaveLength(2);
    expect(c.steps).toEqual([
      'Soften the onion, 6 minutes.',
      'Add spices, 1 minute.',
      'Simmer 15 minutes.',
    ]);
    expect(c.oven_c).toBeUndefined();
    expect(c.inspiration).toBe('Coconut Chickpea Curry (Budget Bytes)');
    expect(c.from_bank).toBeUndefined();
    const r = s[1]!;
    expect(r.oven_c).toBe(200);
    expect(r.portions).toBe(4);
    expect(r.time_min).toBe(30);
    expect(r.from_bank).toBe(true);
    expect(r.ingredients[0]!.search_term).toBe('potato');
  });

  it('returns nothing for garbage', () => {
    expect(parseSuggestions(null)).toEqual([]);
    expect(parseSuggestions({ recipes: 'x' })).toEqual([]);
  });
});

describe('suggestionFacts and grounding items', () => {
  it('sums the model’s own numbers per portion', () => {
    const s = parseSuggestions(raw)[0]!;
    const f = suggestionFacts(s);
    expect(f.portion_kcal).toBeCloseTo((139 * 8 + 23 * 3) / 4, 3);
    expect(f.portion_protein_g).toBeCloseTo((7 * 8 + 2.9 * 3) / 4, 3);
    expect(f.total_cost).toBeCloseTo(0.8 * 2.2 + 0.3 * 6, 3);
    expect(f.portion_g).toBe(275);
    const items = toEstimateItems(s);
    expect(items[0]).toMatchObject({
      name: 'chickpeas, canned',
      search_term: 'chickpea canned',
      grams_estimate: 800,
      kcal: 139 * 8,
      confidence: 'medium',
    });
  });

  it('reads a budget against the list', () => {
    const list = { aisles: [], total_cost: 45, unpriced: 2, estimated: 3 };
    expect(budgetLine(list, 60)).toEqual({
      cost: 45,
      budget: 60,
      share: 0.75,
      estimated: 3,
      unpriced: 2,
    });
    expect(budgetLine(list, 0).share).toBe(0);
  });
});

describe('not offering the same idea twice (§18.6)', () => {
  const dish = (name: string, ingredients: string[]): Suggestion => ({
    name,
    blurb: '',
    tags: [],
    portions: 4,
    time_min: 30,
    steps: [],
    ingredients: ingredients.map((search_term) => ({
      name: search_term,
      search_term,
      grams: 500,
      per_100g: { kcal: 150, protein: 10, carb: 10, fat: 5, fiber: 2 },
      price_per_kg: 5,
    })),
  });

  const chickenRice = dish('Chicken and rice bowl', [
    'chicken thigh raw',
    'rice white raw',
    'broccoli raw',
  ]);

  it('scores a sauce swap on the same base as the same dish', () => {
    const swap = dish('Creamy garlic chicken with rice', [
      'chicken thigh raw',
      'rice white raw',
      'cream',
    ]);
    expect(similarity(chickenRice, swap)).toBeGreaterThanOrEqual(TOO_SIMILAR);
  });

  it('scores a genuinely different dish as different', () => {
    const other = dish('Lentil and squash dal', [
      'lentil red dried',
      'squash butternut raw',
      'coconut milk',
    ]);
    expect(similarity(chickenRice, other)).toBeLessThan(TOO_SIMILAR);
    const fish = dish('Miso salmon traybake', ['salmon raw', 'potato raw', 'miso paste']);
    expect(similarity(chickenRice, fish)).toBeLessThan(TOO_SIMILAR);
  });

  it('drops near neighbours of what was turned down, and duplicates within the batch', () => {
    const rejected = [chickenRice];
    const fresh = [
      dish('Chicken rice traybake', ['chicken thigh raw', 'rice white raw', 'lemon']), // too close
      dish('Lentil and squash dal', ['lentil red dried', 'squash butternut raw']), // keep
      dish('Red lentil squash curry', ['lentil red dried', 'squash butternut raw']), // dup of the above
      dish('Beef chilli', ['beef mince raw', 'kidney bean canned', 'tomato canned']), // keep
    ];
    const kept = dropNearDuplicates(fresh, rejected);
    expect(kept.map((k) => k.name)).toEqual(['Lentil and squash dal', 'Beef chilli']);
  });

  it('keeps everything when nothing has been turned down', () => {
    const fresh = [chickenRice, dish('Beef chilli', ['beef mince raw', 'bean'])];
    expect(dropNearDuplicates(fresh, [])).toHaveLength(2);
  });
});
