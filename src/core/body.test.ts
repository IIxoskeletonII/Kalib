import { describe, expect, it } from 'vitest';
import {
  BODYFAT_MAX_PCT,
  BODYFAT_MIN_PCT,
  bodyFatBasis,
  fatFreeMassIndex,
  isPlausibleWaist,
  relativeFatMass,
  resolveBodyFat,
  WAIST_MAX_CM,
  WAIST_MIN_CM,
  waistToHeight,
  WHTR_HEALTHY_MAX,
} from './body';

describe('relativeFatMass', () => {
  // §14: 186 cm, ~110 kg, body fat self-estimated at 30–40% with low confidence. A 110 cm waist
  // on that frame lands at 30.2%, i.e. the bottom of the guess — which is the whole point of
  // measuring instead of guessing.
  it('places the owner inside his own self-estimate', () => {
    expect(relativeFatMass(186, 110, 'male')).toBeCloseTo(30.18, 2);
  });

  it('adds 12 points for women at the same proportions', () => {
    expect(relativeFatMass(170, 80, 'female') - relativeFatMass(170, 80, 'male')).toBeCloseTo(
      12,
      6,
    );
  });

  it('falls as the waist shrinks at a fixed height', () => {
    const wide = relativeFatMass(180, 100, 'male');
    const narrow = relativeFatMass(180, 80, 'male');
    expect(narrow).toBeLessThan(wide);
    expect(narrow).toBeCloseTo(19, 0);
  });

  it('is scale-free: only the height-to-waist ratio matters', () => {
    expect(relativeFatMass(180, 90, 'male')).toBeCloseTo(relativeFatMass(1.8, 0.9, 'male'), 10);
  });

  it('clamps a negative result rather than returning an impossible percentage', () => {
    // A 41 cm waist on a 200 cm frame gives -33.6 before clamping.
    expect(relativeFatMass(200, 41, 'male')).toBe(BODYFAT_MIN_PCT);
  });

  it('stays inside the survivable range across every plausible body', () => {
    for (let h = 140; h <= 210; h += 5) {
      for (let w = WAIST_MIN_CM; w <= WAIST_MAX_CM; w += 5) {
        for (const sex of ['male', 'female'] as const) {
          const pct = relativeFatMass(h, w, sex);
          expect(pct).toBeGreaterThanOrEqual(BODYFAT_MIN_PCT);
          expect(pct).toBeLessThanOrEqual(BODYFAT_MAX_PCT);
        }
      }
    }
  });

  it('rejects nonsense input instead of returning NaN', () => {
    expect(() => relativeFatMass(0, 90, 'male')).toThrow(RangeError);
    expect(() => relativeFatMass(180, 0, 'male')).toThrow(RangeError);
  });
});

describe('waistToHeight', () => {
  it('reads as a share of height, with 0.5 the low-risk screen', () => {
    expect(waistToHeight(186, 93)).toBeCloseTo(WHTR_HEALTHY_MAX, 10);
    expect(waistToHeight(186, 110)).toBeGreaterThan(WHTR_HEALTHY_MAX);
  });

  it('rejects a zero height', () => {
    expect(() => waistToHeight(0, 90)).toThrow(RangeError);
  });
});

describe('fatFreeMassIndex', () => {
  it('computes lean mass per square metre', () => {
    // 110 kg at 30% fat is 77 kg lean; 1.86 m squared is 3.4596.
    expect(fatFreeMassIndex(110, 30, 186)).toBeCloseTo(22.26, 2);
  });

  it('rises as body fat falls at constant weight', () => {
    expect(fatFreeMassIndex(110, 20, 186)).toBeGreaterThan(fatFreeMassIndex(110, 30, 186));
  });
});

describe('isPlausibleWaist', () => {
  it('accepts tape readings and rejects typos', () => {
    expect(isPlausibleWaist(93)).toBe(true);
    expect(isPlausibleWaist(40)).toBe(true);
    expect(isPlausibleWaist(39)).toBe(false);
    expect(isPlausibleWaist(251)).toBe(false);
    expect(isPlausibleWaist(Number.NaN)).toBe(false);
  });
});

describe('resolveBodyFat', () => {
  const base = { sex: 'male' as const, height_cm: 186 };

  it('trusts an entered measurement over everything else', () => {
    const e = resolveBodyFat({ ...base, measured_pct: 28, waist_cm: 110, profile_pct: 35 });
    expect(e).toEqual({ pct: 28, source: 'measured' });
  });

  it('falls back to the waist before the onboarding guess', () => {
    const e = resolveBodyFat({ ...base, waist_cm: 110, profile_pct: 35 })!;
    expect(e.source).toBe('waist');
    expect(e.pct).toBeCloseTo(30.18, 2);
    expect(e.waist_cm).toBe(110);
  });

  it('ignores an implausible waist and keeps the guess', () => {
    expect(resolveBodyFat({ ...base, waist_cm: 5, profile_pct: 35 })).toEqual({
      pct: 35,
      source: 'profile',
    });
  });

  it('returns undefined when nothing is known, so §3.2 stays on Mifflin', () => {
    expect(resolveBodyFat(base)).toBeUndefined();
    expect(resolveBodyFat({ ...base, measured_pct: Number.NaN })).toBeUndefined();
  });

  it('describes where each number came from', () => {
    expect(bodyFatBasis({ pct: 28, source: 'measured' })).toBe('as entered');
    expect(bodyFatBasis({ pct: 30, source: 'waist', waist_cm: 110 })).toBe(
      'from a 110 cm waist (RFM)',
    );
    expect(bodyFatBasis({ pct: 35, source: 'profile' })).toBe('your starting estimate');
  });
});
