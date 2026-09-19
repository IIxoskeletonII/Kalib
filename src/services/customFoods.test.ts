import { describe, expect, it } from 'vitest';
import type { Food } from '@/core/types';
import { fromFood, toFoodFields } from './customFoods';

describe('custom foods', () => {
  it('normalises a serving to per 100 g and keeps the serving as a portion', () => {
    const f = toFoodFields({
      name: ' Gyro pita ',
      serving_g: 250,
      kcal: 750,
      protein_g: 35,
      carb_g: 60,
      fat_g: 40,
      fiber_g: 4,
    });
    expect(f.name).toBe('Gyro pita');
    expect(f.per_100g).toEqual({ kcal: 300, protein: 14, carb: 24, fat: 16, fiber: 1.6 });
    expect(f.portions).toEqual([{ label: '1 serving', grams: 250 }]);
    expect(f.brand).toBeUndefined();
  });

  it('round-trips through fromFood', () => {
    const input = {
      name: 'Gyro pita',
      brand: 'Corner shop',
      serving_g: 250,
      kcal: 750,
      protein_g: 35,
      carb_g: 60,
      fat_g: 40,
      fiber_g: 4,
    };
    const food: Food = {
      id: 'x',
      user_id: 'local',
      created_at: 't',
      updated_at: 't',
      source: 'custom',
      ...toFoodFields(input),
    };
    expect(fromFood(food)).toEqual(input);
  });
});
