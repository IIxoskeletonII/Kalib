import { describe, expect, it } from 'vitest';
import { densityFor, fromGrams, isLiquid, roundIn, toGrams } from './units';

const food = (
  name: string,
  category: string,
  portions: { label: string; grams: number }[] = [],
) => ({
  name,
  category,
  portions,
});

describe('density', () => {
  it('prefers a fluid portion in the data', () => {
    const milk = food('Milk, whole', 'Dairy and Egg Products', [
      { label: '1 cup', grams: 244 },
      { label: '1 fl oz', grams: 30.5 },
    ]);
    const d = densityFor(milk);
    expect(d.basis).toBe('portion');
    expect(d.g_per_ml).toBeCloseTo(1.031, 2);
  });
  it('uses a cup for liquid categories, then name heuristics, then assumes 1', () => {
    expect(
      densityFor(food('Milk, whole', 'Dairy and Egg Products', [{ label: '1 cup', grams: 249 }]))
        .g_per_ml,
    ).toBeCloseTo(1.05, 2);
    expect(
      densityFor(
        food('Oil, olive, salad or cooking', 'Fats and Oils', [
          { label: '1 tablespoon', grams: 13.5 },
        ]),
      ),
    ).toEqual({ g_per_ml: 0.92, basis: 'category' });
    expect(densityFor(food('Coffee, brewed', 'Beverages'))).toEqual({
      g_per_ml: 1,
      basis: 'category',
    });
    expect(densityFor(food('Caffè latte', ''))).toEqual({ g_per_ml: 1.03, basis: 'category' });
    expect(densityFor(food('Chicken, breast, raw', 'Poultry Products'))).toEqual({
      g_per_ml: 1,
      basis: 'assumed',
    });
    expect(densityFor({ ...food('x', ''), density_g_per_ml: 0.8 })).toEqual({
      g_per_ml: 0.8,
      basis: 'food',
    });
  });
  it('knows what is a liquid', () => {
    expect(isLiquid(food('Caffè latte', ''))).toBe(true);
    expect(isLiquid(food('Beverages, water', 'Beverages'))).toBe(true);
    expect(isLiquid(food('Oil, olive', 'Fats and Oils'))).toBe(true);
    expect(isLiquid(food('Rice, white, raw', 'Cereal Grains and Pasta'))).toBe(false);
  });
});

describe('conversion', () => {
  it('round-trips through every unit', () => {
    for (const unit of ['g', 'ml', 'oz', 'floz'] as const) {
      expect(fromGrams(toGrams(250, unit, 1.03), unit, 1.03)).toBeCloseTo(250, 6);
    }
    expect(toGrams(1, 'oz', 1)).toBeCloseTo(28.35, 2);
    expect(toGrams(1, 'floz', 1)).toBeCloseTo(29.57, 2);
    expect(toGrams(250, 'ml', 1.03)).toBeCloseTo(257.5, 1);
  });
  it('rounds by unit', () => {
    expect(roundIn(8.83, 'oz')).toBe(8.8);
    expect(roundIn(257.5, 'g')).toBe(258);
  });
});
