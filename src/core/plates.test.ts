import { describe, expect, it } from 'vitest';
import { DEFAULT_BAR, describePlates, plateLoad, warmupRamp } from './plates';
import { fromDisplay, toDisplay } from './weightUnit';

const kgLoad = (kg: number) => plateLoad(kg, { unit: 'kg' });

describe('plateLoad', () => {
  it('loads a familiar weight the way a gym does', () => {
    // 100 kg on a 20 kg bar: 40 a side = 25 + 15.
    expect(kgLoad(100)!.per_side).toEqual([25, 15]);
    expect(kgLoad(100)!.achieved_kg).toBeCloseTo(100, 9);
    expect(kgLoad(100)!.short_kg).toBeCloseTo(0, 9);
  });

  it('says bar only when there is nothing to add', () => {
    const l = kgLoad(20)!;
    expect(l.per_side).toEqual([]);
    expect(describePlates(l)).toBe('bar only');
  });

  it('refuses a target under the bar instead of implying the bar is right', () => {
    expect(kgLoad(15)).toBeUndefined();
    expect(kgLoad(0)).toBeUndefined();
    expect(plateLoad(Number.NaN, { unit: 'kg' })).toBeUndefined();
  });

  it('goes heaviest first, which is both optimal here and how you load a bar', () => {
    // 61.25 a side: two 25s, a 10 and a 1.25 — not a 25/20/15 spread that totals the same.
    expect(kgLoad(142.5)!.per_side).toEqual([25, 25, 10, 1.25]);
    expect(kgLoad(142.5)!.per_side.reduce((a, b) => a + b, 0)).toBeCloseTo(61.25, 9);
  });

  it('reports what it could not reach rather than rounding silently', () => {
    // 100.5 kg cannot be made from standard kg plates; the honest answer is 100 and 0.5 short.
    const l = kgLoad(100.5)!;
    expect(l.achieved_kg).toBeCloseTo(100, 9);
    expect(l.short_kg).toBeCloseTo(0.5, 9);
  });

  it('does pound plates in pounds, not by converting kilograms', () => {
    // 225 lb on a 45 lb bar: 90 a side = 45 + 45.
    const l = plateLoad(fromDisplay(225, 'lb'), { unit: 'lb' })!;
    expect(l.per_side).toEqual([45, 45]);
    expect(toDisplay(l.achieved_kg, 'lb')).toBeCloseTo(225, 6);
  });

  it('respects a different bar', () => {
    // A 15 kg women's bar: 60 kg is 22.5 a side.
    const l = plateLoad(60, { unit: 'kg', bar: 15 })!;
    expect(l.per_side).toEqual([20, 2.5]);
    expect(l.bar_kg).toBeCloseTo(15, 9);
  });

  it('respects a limited plate set', () => {
    const l = plateLoad(100, { unit: 'kg', plates: [20, 10] })!;
    expect(l.per_side).toEqual([20, 20]);
    expect(l.achieved_kg).toBeCloseTo(100, 9);
  });

  it('terminates on a malformed plate set rather than spinning', () => {
    const l = plateLoad(100, { unit: 'kg', plates: [0, -5, 20] })!;
    expect(l.per_side).toEqual([20, 20]);
  });

  it('never loads more than asked for', () => {
    for (const target of [60, 77.5, 83, 101.3, 142.5, 200]) {
      expect(kgLoad(target)!.achieved_kg).toBeLessThanOrEqual(target + 1e-9);
    }
  });

  it('is symmetric: every side total is half the loaded weight', () => {
    for (const target of [60, 100, 142.5, 180]) {
      const l = kgLoad(target)!;
      const side = l.per_side.reduce((a, b) => a + b, 0);
      expect(l.achieved_kg).toBeCloseTo(DEFAULT_BAR.kg + side * 2, 9);
    }
  });
});

describe('warmupRamp', () => {
  it('ramps the bar, then roughly 40, 60 and 80 per cent', () => {
    const r = warmupRamp(100, { unit: 'kg' });
    expect(r.map((s) => s.weight_kg)).toEqual([20, 40, 60, 80]);
    expect(r.map((s) => s.reps)).toEqual([8, 5, 3, 2]);
  });

  it('never suggests a weight at or above the working set', () => {
    for (const w of [40, 62.5, 100, 137.5, 200]) {
      for (const s of warmupRamp(w, { unit: 'kg' })) {
        expect(s.weight_kg).toBeLessThan(w);
      }
    }
  });

  it('rounds down, because a warm-up that overshoots is not a warm-up', () => {
    const r = warmupRamp(97, { unit: 'kg' });
    for (const s of r) {
      expect(toDisplay(s.weight_kg, 'kg') % 2.5).toBeCloseTo(0, 6);
      expect(s.weight_kg).toBeLessThan(97);
    }
  });

  it('shortens the ramp rather than repeating a weight', () => {
    // At 30 kg, 40% and 60% both collapse onto the bar.
    const r = warmupRamp(30, { unit: 'kg' });
    const weights = r.map((s) => s.weight_kg);
    expect(new Set(weights).size).toBe(weights.length);
    expect(weights).toEqual([...weights].sort((a, b) => a - b));
  });

  it('has nothing to say when the working weight is the bar or less', () => {
    expect(warmupRamp(20, { unit: 'kg' })).toEqual([]);
    expect(warmupRamp(10, { unit: 'kg' })).toEqual([]);
    expect(warmupRamp(Number.NaN, { unit: 'kg' })).toEqual([]);
  });

  it('works in pounds on a pound bar', () => {
    const r = warmupRamp(fromDisplay(225, 'lb'), { unit: 'lb' });
    const inLb = r.map((s) => Math.round(toDisplay(s.weight_kg, 'lb')));
    expect(inLb[0]).toBe(45);
    for (const w of inLb) expect(w % 5).toBe(0);
    expect(Math.max(...inLb)).toBeLessThan(225);
  });

  it('always climbs', () => {
    for (const w of [50, 85, 120, 180]) {
      const r = warmupRamp(w, { unit: 'kg' });
      for (let i = 1; i < r.length; i++) {
        expect(r[i]!.weight_kg).toBeGreaterThan(r[i - 1]!.weight_kg);
      }
    }
  });
});
