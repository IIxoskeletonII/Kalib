import { describe, expect, it } from 'vitest';
import { macrosAgree, parseLabel } from './label';

const base = {
  name: 'Penne rigate',
  brand: 'Barilla',
  basis: 'per_100g',
  serving_g: 80,
  kcal: 359,
  protein_g: 12.5,
  carb_g: 71.2,
  fat_g: 2,
  fiber_g: 3,
  confidence: 'high',
  notes: '',
};

describe('reading a label', () => {
  it('treats a per-100 g column as 100 g, whatever serving the packet suggests', () => {
    const r = parseLabel(base)!;
    expect(r.serving_g).toBe(100);
    expect(r.per_serving).toBe(false);
    expect(r).toMatchObject({ name: 'Penne rigate', brand: 'Barilla', kcal: 359, fiber_g: 3 });
  });

  it('keeps a per-serving column against its stated serving', () => {
    const r = parseLabel({ ...base, basis: 'per_serving', serving_g: 80, kcal: 287 })!;
    expect(r.serving_g).toBe(80);
    expect(r.per_serving).toBe(true);
    expect(r.kcal).toBe(287);
  });

  it('falls back to 100 g when a per-serving label forgot to say how big a serving is', () => {
    expect(parseLabel({ ...base, basis: 'per_serving', serving_g: 0 })!.serving_g).toBe(100);
  });

  it('refuses anything without calories, and clamps nonsense', () => {
    expect(parseLabel({ ...base, kcal: 0 })).toBeNull();
    expect(parseLabel(null)).toBeNull();
    expect(parseLabel('x')).toBeNull();
    const r = parseLabel({ ...base, protein_g: -5, fat_g: 99999, confidence: 'certain' })!;
    expect(r.protein_g).toBe(0);
    expect(r.fat_g).toBe(200);
    expect(r.confidence).toBe('low');
  });

  it('checks the macros account for the calories', () => {
    expect(macrosAgree({ kcal: 359, protein_g: 12.5, carb_g: 71.2, fat_g: 2 })).toBe(true);
    // A column misread (per-serving figures against a per-100 g energy) does not add up.
    expect(macrosAgree({ kcal: 359, protein_g: 4, carb_g: 20, fat_g: 1 })).toBe(false);
    expect(macrosAgree({ kcal: 0, protein_g: 1, carb_g: 1, fat_g: 1 })).toBe(false);
    // Low-calorie foods get the flat tolerance rather than the percentage.
    expect(macrosAgree({ kcal: 30, protein_g: 1, carb_g: 4, fat_g: 0 })).toBe(true);
  });
});
