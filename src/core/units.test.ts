import { describe, expect, it } from 'vitest';
import {
  bestPortionDonor,
  densityFor,
  fromGrams,
  isLiquid,
  isWeightLabel,
  roundIn,
  shortPortionLabel,
  toGrams,
  usablePortions,
} from './units';

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

describe('portion labels on a button (§8)', () => {
  it('drops the leading 1 and keeps the first of several alternatives', () => {
    expect(shortPortionLabel('1 egg')).toBe('egg');
    expect(shortPortionLabel('1 banana')).toBe('banana');
    expect(shortPortionLabel('1 medium or regular slice')).toBe('medium slice');
    expect(shortPortionLabel('1 small or thin/very thin slice')).toBe('small slice');
    expect(shortPortionLabel('1 large or thick slice')).toBe('large slice');
    expect(shortPortionLabel('1 cup, mashed')).toBe('cup, mashed');
    expect(shortPortionLabel('1 slice, crust not eaten')).toBe('slice, crust not eaten');
    expect(shortPortionLabel('2 tbsp')).toBe('2 tbsp');
  });

  it('recognises a portion that is only a weight, which the unit chips already cover', () => {
    for (const l of ['oz', '1 oz', 'g', '100 g', 'fl oz', 'ml', 'lb', 'ounces']) {
      expect(isWeightLabel(shortPortionLabel(l)), l).toBe(true);
    }
    for (const l of ['egg', 'medium slice', 'cup', 'banana', 'fillet']) {
      expect(isWeightLabel(l), l).toBe(false);
    }
  });
});

describe('borrowing a portion from a neighbouring food', () => {
  const f = (name: string, portions: { label: string; grams: number }[]) => ({ name, portions });
  const hen = f('Egg, whole, raw', [{ label: '1 egg', grams: 50 }]);
  const duck = f('Egg, duck, whole, fresh, raw', [{ label: '1 egg', grams: 70 }]);
  const white = f('Egg, white, raw', [{ label: '1 white', grams: 33 }]);
  const noPortions = f('Egg, whole, dried', []);

  it('lends from the closest description, not a different animal', () => {
    const target = { name: 'Egg, whole, raw, frozen, pasteurized' };
    expect(bestPortionDonor(target, [duck, hen, white, noPortions])?.name).toBe(hen.name);
  });

  it('will not cross to another subject', () => {
    const target = { name: 'Chicken, breast, boneless, skinless, raw' };
    expect(bestPortionDonor(target, [hen, duck])).toBeUndefined();
  });

  it('ignores donors whose only portions are weights', () => {
    const ounces = f('Egg, whole, raw, fresh', [{ label: '1 oz', grams: 28 }]);
    expect(bestPortionDonor({ name: 'Egg, whole, raw, frozen' }, [ounces])).toBeUndefined();
  });

  it('keeps only portions worth counting', () => {
    expect(
      usablePortions([
        { label: '1 egg', grams: 50 },
        { label: '1 oz', grams: 28 },
        { label: '1 egg', grams: 50 },
        { label: '1 cup', grams: 245 },
      ]).map((p) => p.label),
    ).toEqual(['1 egg', '1 cup']);
  });
});
