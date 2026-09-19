import { describe, expect, it } from 'vitest';
import { selectEverydayPool } from './coachFoods';
import type { Food } from './types';

function food(id: string, name: string, source: Food['source'] = 'usda_sr'): Food {
  return {
    id,
    user_id: 'local',
    created_at: 't',
    updated_at: 't',
    source,
    name,
    category: 'Legumes and Legume Products',
    per_100g: { kcal: 116, protein: 9, carb: 20, fat: 0.4, fiber: 7.9 },
    micros: {},
    micro_coverage: 0,
    portions: [],
    verified: true,
  };
}

describe('selectEverydayPool', () => {
  it('picks one row per pattern: Foundation first, unsalted before salted, then the shortest name', () => {
    const pool = selectEverydayPool([
      food('salt', 'Lentils, mature seeds, cooked, boiled, with salt'),
      food('nosalt', 'Lentils, mature seeds, cooked, boiled, without salt'),
      food('raw', 'Lentils, raw'),
      food(
        'chick-long',
        'Chickpeas (garbanzo beans, bengal gram), mature seeds, cooked, boiled, with salt',
      ),
      food('chick-found', 'Chickpeas, cooked', 'usda_foundation'),
    ]);
    expect([...pool.keys()]).toEqual(['nosalt', 'chick-found']);
    expect(pool.get('nosalt')?.grams).toBe(150);
  });

  it('leaves patterns with no match out of the pool', () => {
    expect(selectEverydayPool([food('x', 'Something else')]).size).toBe(0);
  });
});
