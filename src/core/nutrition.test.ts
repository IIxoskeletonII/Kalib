import { describe, expect, it } from 'vitest';
import { microCoverageOf } from './nutrients';
import { calorieConfidence, dayTotals, hasAnyMicros, microCoverage, scaleFood } from './nutrition';

const chicken = {
  per_100g: { kcal: 165, protein: 31, carb: 0, fat: 3.6, fiber: 0 },
  micros: { b3: 13.7, selenium: 27.6, vit_a: 6 },
};

describe('scaleFood', () => {
  it('scales macros and micros linearly by grams', () => {
    const s = scaleFood(chicken, 50);
    expect(s.kcal).toBeCloseTo(82.5, 9);
    expect(s.protein_g).toBeCloseTo(15.5, 9);
    expect(s.fat_g).toBeCloseTo(1.8, 9);
    expect(s.micros).toEqual({ b3: 6.85, selenium: 13.8, vit_a: 3 });
  });

  it('drops micros that are absent rather than writing zeros', () => {
    const s = scaleFood({ per_100g: chicken.per_100g, micros: {} }, 100);
    expect(s.micros).toEqual({});
  });
});

describe('dayTotals', () => {
  it('sums macros and merges micros across entries', () => {
    const a = { ...scaleFood(chicken, 100) };
    const b = {
      kcal: 100,
      protein_g: 1,
      carb_g: 20,
      fat_g: 1,
      fiber_g: 5,
      micros: { vit_c: 10, b3: 1 },
    };
    const t = dayTotals([a, b]);
    expect(t.kcal).toBeCloseTo(265, 9);
    expect(t.protein_g).toBeCloseTo(32, 9);
    expect(t.fiber_g).toBe(5);
    expect(t.micros.b3).toBeCloseTo(14.7, 9);
    expect(t.micros.vit_c).toBe(10);
  });

  it('returns zeros for an empty day', () => {
    expect(dayTotals([])).toEqual({
      kcal: 0,
      protein_g: 0,
      carb_g: 0,
      fat_g: 0,
      fiber_g: 0,
      micros: {},
    });
  });
});

describe('§7.4 provenance', () => {
  it('calorieConfidence is the kcal-weighted share of high-confidence entries', () => {
    expect(
      calorieConfidence([
        { kcal: 300, confidence: 'high' },
        { kcal: 700, confidence: 'low' },
      ]),
    ).toBeCloseTo(0.3, 9);
  });

  it('calorieConfidence is null for an empty day', () => {
    expect(calorieConfidence([])).toBeNull();
  });

  it('microCoverage counts kcal from entries with any micronutrient data', () => {
    expect(
      microCoverage([
        { kcal: 200, micros: { iron: 1 } },
        { kcal: 800, micros: {} },
        { kcal: 0, micros: { iron: 5 } },
      ]),
    ).toBeCloseTo(0.2, 9);
    expect(microCoverage([])).toBeNull();
  });

  it('hasAnyMicros ignores unknown keys', () => {
    expect(hasAnyMicros({})).toBe(false);
    expect(hasAnyMicros(undefined)).toBe(false);
    expect(hasAnyMicros({ zinc: 0 })).toBe(true);
  });

  it('microCoverageOf is the fraction of tracked micros present', () => {
    expect(microCoverageOf({})).toBe(0);
    expect(microCoverageOf({ iron: 1, zinc: 2 })).toBeCloseTo(2 / 22, 9);
  });
});
