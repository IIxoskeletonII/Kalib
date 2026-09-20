import { describe, expect, it } from 'vitest';
import {
  effectiveYield,
  formatPortions,
  portionGrams,
  rawWeight,
  recipeFoodFields,
  recipeMicroCoverage,
  recipeTotals,
  servingsOf,
} from './recipes';
import type { Food, RecipeItem } from './types';

type F = Pick<Food, 'per_100g' | 'micros'>;
const chicken: F = {
  per_100g: { kcal: 120, protein: 22.5, carb: 0, fat: 2.6, fiber: 0 },
  micros: { iron: 0.4, zinc: 0.7, b12: 0.2 },
};
const rice: F = {
  per_100g: { kcal: 360, protein: 7, carb: 79, fat: 0.6, fiber: 1.3 },
  micros: { iron: 0.8 },
};
const foods = new Map<string, F>([
  ['chicken', chicken],
  ['rice', rice],
]);
const items: RecipeItem[] = [
  { food_id: 'chicken', name: 'Chicken breast', grams: 1000 },
  { food_id: 'rice', name: 'Rice, raw', grams: 400 },
];

describe('recipe totals', () => {
  it('sums scaled ingredients', () => {
    const t = recipeTotals(items, foods);
    expect(t.kcal).toBeCloseTo(1200 + 1440);
    expect(t.protein_g).toBeCloseTo(225 + 28);
    expect(t.micros.iron).toBeCloseTo(4 + 3.2);
  });
  it('ignores ingredients whose food is missing', () => {
    const t = recipeTotals([...items, { food_id: 'gone', name: 'x', grams: 500 }], foods);
    expect(t.kcal).toBeCloseTo(2640);
  });
  it('raw weight stands in for yield until the pot is weighed', () => {
    expect(rawWeight(items)).toBe(1400);
    expect(effectiveYield({ items })).toBe(1400);
    expect(effectiveYield({ items, yield_g: 2200 })).toBe(2200);
    expect(portionGrams({ items, yield_g: 2200, portions: 4 })).toBe(550);
  });
});

describe('materialised food', () => {
  it('divides totals by the cooked yield, not the raw weight', () => {
    const f = recipeFoodFields(
      { name: 'Chicken & rice', items, yield_g: 2200, portions: 4 },
      foods,
    );
    expect(f.per_100g.kcal).toBeCloseTo(2640 / 22, 1);
    expect(f.per_100g.protein).toBeCloseTo(253 / 22, 1);
    expect(f.portions).toEqual([{ label: '1 portion', grams: 550 }]);
    expect(f.micros.iron).toBeCloseTo(7.2 / 22, 2);
    expect(f.verified).toBe(false);
  });
  it('is empty-safe', () => {
    const f = recipeFoodFields({ name: ' ', items: [], portions: 4 }, foods);
    expect(f.name).toBe('Recipe');
    expect(f.per_100g.kcal).toBe(0);
    expect(f.portions).toEqual([]);
  });
  it('weights micro coverage by ingredient grams', () => {
    // chicken covers 3/22 of the tracked micros, rice 1/22
    const c = recipeMicroCoverage(items, foods);
    expect(c).toBeCloseTo((1000 * (3 / 22) + 400 * (1 / 22)) / 1400, 5);
  });
});

describe('portions', () => {
  it('rounds servings to a quarter, never below a quarter', () => {
    expect(servingsOf(550, 550)).toBe(1);
    expect(servingsOf(275, 550)).toBe(0.5);
    expect(servingsOf(600, 550)).toBe(1);
    expect(servingsOf(700, 550)).toBe(1.25);
    expect(servingsOf(10, 550)).toBe(0.25);
    expect(servingsOf(100, 0)).toBe(1);
  });
  it('formats with vulgar fractions', () => {
    expect(formatPortions(3)).toBe('3');
    expect(formatPortions(2.5)).toBe('2½');
    expect(formatPortions(0.25)).toBe('¼');
    expect(formatPortions(0)).toBe('0');
    expect(formatPortions(1.75)).toBe('1¾');
  });
});
