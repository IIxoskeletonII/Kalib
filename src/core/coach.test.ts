import { describe, expect, it } from 'vitest';
import { findGaps, gapClosed, isCompleteDay, recommendFoods, type DaySummary } from './coach';
import type { Food } from './types';

const target = { kcal: 2200, protein_g: 150, carb_g: 250, fat_g: 70, fiber_g: 32 };

function day(
  date: string,
  kcal: number,
  protein: number,
  fiber: number,
  micros: Partial<Record<'iron' | 'vit_c', number>> = {},
  coverage = 1,
): DaySummary {
  return {
    date,
    totals: { kcal, protein_g: protein, carb_g: 200, fat_g: 60, fiber_g: fiber, micros },
    target,
    entries: [
      { kcal: kcal * coverage, micros: { iron: 1 } },
      { kcal: kcal * (1 - coverage), micros: {} },
    ],
  };
}

function food(
  id: string,
  name: string,
  kcal: number,
  protein: number,
  fiber: number,
  extra: Partial<Food> = {},
): Food {
  return {
    id,
    user_id: 'local',
    created_at: 't',
    updated_at: 't',
    source: 'usda_sr',
    name,
    category: 'Legumes and Legume Products',
    per_100g: { kcal, protein, carb: 10, fat: 2, fiber },
    micros: {},
    micro_coverage: 0,
    portions: [],
    verified: true,
    ...extra,
  };
}

describe('findGaps (§16.1)', () => {
  it('needs four complete days', () => {
    const days = [day('d1', 2000, 100, 10), day('d2', 2000, 100, 10), day('d3', 2000, 100, 10)];
    expect(findGaps(days, 'male')).toEqual([]);
    expect(findGaps([...days, day('d4', 2000, 100, 10)], 'male').length).toBeGreaterThan(0);
  });

  it('ignores incomplete days and reports the largest shortfall first', () => {
    const days = [
      day('d1', 2000, 100, 12),
      day('d2', 2100, 110, 14),
      day('d3', 2000, 100, 12),
      day('d4', 2200, 120, 15),
      day('d5', 400, 10, 1), // half-logged day: excluded
    ];
    const gaps = findGaps(days, 'male');
    const fiber = gaps.find((g) => g.nutrient === 'fiber_g')!;
    const protein = gaps.find((g) => g.nutrient === 'protein_g')!;
    expect(fiber.days).toBe(4);
    expect(fiber.average).toBeCloseTo(13.25, 5);
    expect(fiber.ratio).toBeLessThan(protein.ratio);
    expect(gaps[0]!.nutrient).toBe('fiber_g');
    expect(isCompleteDay(days[4]!)).toBe(false);
  });

  it('is silent when targets are met', () => {
    const days = [1, 2, 3, 4, 5].map((i) => day(`d${i}`, 2200, 150, 33, { iron: 9, vit_c: 100 }));
    const gaps = findGaps(days, 'male').filter(
      (g) => g.nutrient === 'protein_g' || g.nutrient === 'fiber_g',
    );
    expect(gaps).toEqual([]);
  });

  it('judges micronutrients only on well-covered days', () => {
    const low = [1, 2, 3, 4, 5].map((i) => day(`d${i}`, 2200, 150, 33, { iron: 2 }, 0.5));
    expect(findGaps(low, 'male').find((g) => g.nutrient === 'iron')).toBeUndefined();
    const covered = [1, 2, 3, 4, 5].map((i) => day(`d${i}`, 2200, 150, 33, { iron: 2 }, 0.9));
    const iron = findGaps(covered, 'male').find((g) => g.nutrient === 'iron')!;
    expect(iron.target).toBe(8);
    expect(iron.unit).toBe('mg');
    expect(findGaps(covered, 'female').find((g) => g.nutrient === 'iron')!.target).toBe(18);
  });
});

describe('recommendFoods (§16.2)', () => {
  const foods = [
    food('lentils', 'Lentils, mature seeds, cooked, boiled', 116, 9, 7.9, {
      source: 'usda_foundation',
    }),
    food('raspberries', 'Raspberries, raw', 52, 1.2, 6.5),
    food('bran', 'Wheat bran, crude', 216, 15.6, 42.8),
    food('chicken', 'Chicken, breast, roasted', 165, 31, 0),
    food('oil', 'Oil, olive', 884, 0, 0),
    food('lettuce', 'Lettuce, iceberg', 14, 0.9, 1.2),
    food('lentils2', 'Lentils, red, cooked', 100, 8, 5),
    food('cake', 'Cake, chocolate', 370, 5, 2),
  ];
  const gap = {
    nutrient: 'fiber_g' as const,
    label: 'Fiber',
    unit: 'g',
    average: 13,
    target: 32,
    ratio: 0.4,
    days: 5,
  };

  it('ranks by what a realistic portion adds, skips ingredients and implausible foods, one per head noun', () => {
    const recs = recommendFoods(gap, foods);
    expect(recs.map((r) => r.food.id)).toEqual(['raspberries', 'lentils']);
    expect(recs.map((r) => r.food.id)).not.toContain('bran'); // an ingredient, not a dish
    expect(recs.map((r) => r.food.id)).not.toContain('oil');
    expect(recs.map((r) => r.food.id)).not.toContain('lettuce');
    expect(recs.map((r) => r.food.id)).not.toContain('cake');
    const lentils = recs.find((r) => r.food.id === 'lentils')!;
    expect(lentils.grams).toBe(100);
    expect(lentils.adds).toBeCloseTo(7.9, 5);
    expect(lentils.kcal).toBeCloseTo(116, 5);
    const berries = recs.find((r) => r.food.id === 'raspberries')!;
    expect(berries.grams).toBe(150); // low-energy produce gets a bigger portion
  });

  it('only suggests foods from edible groups, unless the user already eats them', () => {
    const cinnamon = food('cin', 'Spices, cinnamon, ground', 247, 4, 53, {
      category: 'Spices and Herbs',
    });
    const custom = food('mine', 'Overnight oats', 120, 5, 6, { source: 'custom' });
    delete custom.category;
    expect(recommendFoods(gap, [cinnamon, custom])).toEqual([]);
    const recs = recommendFoods(gap, [cinnamon, custom], { familiarIds: new Set(['mine']) });
    expect(recs.map((r) => r.food.id)).toEqual(['mine']);
  });

  it('skips raw legumes and grains and portions nuts small', () => {
    const rawLentils = food('rawl', 'Lentils, raw', 352, 25, 10.7);
    const chia = food('chia', 'Seeds, chia seeds, dried', 486, 16.5, 34.4);
    const almonds = food('alm', 'Nuts, almonds', 579, 21, 12.5);
    const recs = recommendFoods(gap, [rawLentils, chia, almonds]);
    // 30 g of chia adds 10 g; 30 g of almonds adds under 4 g, not worth a suggestion.
    expect(recs.map((r) => r.food.id)).toEqual(['chia']);
    expect(recs[0]!.grams).toBe(30);
    expect(recs[0]!.adds).toBeCloseTo(10.32, 2);
  });

  it('prefers foods the user already logs and honours exclusions', () => {
    const recs = recommendFoods(gap, foods, {
      familiarIds: new Set(['lentils']),
      exclude: new Set(['bran']),
    });
    expect(recs[0]!.food.id).toBe('lentils');
    expect(recs[0]!.familiar).toBe(true);
    expect(recs.map((r) => r.food.id)).not.toContain('bran');
  });

  it('uses the first realistic portion for the message', () => {
    const withPortion = food('beans', 'Beans, black, cooked', 132, 8.9, 8.7, {
      portions: [{ label: '1 cup', grams: 172 }],
    });
    const rec = recommendFoods(gap, [withPortion])[0]!;
    expect(rec.grams).toBe(172);
    expect(rec.adds).toBeCloseTo(14.96, 1);
  });

  it('protein gaps use a protein density floor', () => {
    const pgap = {
      ...gap,
      nutrient: 'protein_g' as const,
      label: 'Protein',
      average: 100,
      target: 150,
      ratio: 0.67,
    };
    const recs = recommendFoods(pgap, foods);
    expect(recs[0]!.food.id).toBe('chicken');
    expect(recs.map((r) => r.food.id)).not.toContain('raspberries');
  });
});

describe('gapClosed', () => {
  it('fires once when a flagged nutrient disappears from the list', () => {
    const fiber = {
      nutrient: 'fiber_g' as const,
      label: 'Fiber',
      unit: 'g',
      average: 13,
      target: 32,
      ratio: 0.4,
      days: 5,
    };
    expect(gapClosed(fiber, [])).toBe(true);
    expect(gapClosed(fiber, [fiber])).toBe(false);
    expect(gapClosed(undefined, [])).toBe(false);
  });
});
