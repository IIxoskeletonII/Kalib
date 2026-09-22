import { describe, expect, it } from 'vitest';
import {
  nextSwitch,
  resolveMode,
  computeBmr,
  computeTargets,
  deficitPct,
  fatTarget,
  isProvisional,
  katchMcArdle,
  mifflinStJeor,
  sexFloor,
  type TargetInputs,
} from './targets';

const base: TargetInputs = {
  sex: 'male',
  age: 30,
  height_cm: 180,
  weight_kg: 80,
  bodyfat_pct: 20,
  activity_level: 'moderate',
  mode: 'CUT',
  goal_rate_kg_per_week: 0.5,
};

describe('BMR (§3.2)', () => {
  it('Mifflin-St Jeor', () => {
    expect(mifflinStJeor('male', 80, 180, 30)).toBe(1780);
    expect(mifflinStJeor('female', 80, 180, 30)).toBe(1614);
  });

  it('Katch-McArdle', () => {
    expect(katchMcArdle(60)).toBe(1666);
  });

  it('uses Mifflin when body fat is unknown', () => {
    const r = computeBmr({ ...base, bodyfat_pct: undefined });
    expect(r.method).toBe('mifflin_st_jeor');
    expect(r.bmr).toBe(1780);
    expect(r.uncertain).toBe(false);
    expect(r.lbm_kg).toBeUndefined();
  });

  it('uses Katch-McArdle when body fat is known and formulas agree within 10%', () => {
    const r = computeBmr(base);
    expect(r.method).toBe('katch_mcardle');
    expect(r.lbm_kg).toBe(64);
    expect(r.bmr).toBeCloseTo(1752.4, 5);
    expect(r.uncertain).toBe(false);
  });

  it('takes the mean and flags uncertainty when formulas disagree by >10% (Eliya, §14)', () => {
    const r = computeBmr({
      ...base,
      age: 23,
      height_cm: 186,
      weight_kg: 110,
      bodyfat_pct: 35,
      activity_level: 'light',
    });
    expect(r.mifflin).toBe(2152.5);
    expect(r.katch).toBeCloseTo(1914.4, 5);
    expect(r.method).toBe('mean');
    expect(r.uncertain).toBe(true);
    expect(r.bmr).toBeCloseTo(2033.45, 5);
  });
});

describe('deficit (§3.4, §3.5)', () => {
  it('CUT scales with goal rate and is clamped to [0.10, 0.25]', () => {
    expect(deficitPct('CUT', 0.5, 2800)).toBeCloseTo(0.19643, 4);
    expect(deficitPct('CUT', 0.1, 2800)).toBe(0.1);
    expect(deficitPct('CUT', 2, 2800)).toBe(0.25);
  });

  it('MAINTAIN is zero regardless of rate', () => {
    expect(deficitPct('MAINTAIN', 1, 2800)).toBe(0);
  });

  it('BULK is a surplus between 5 and 15 %, whatever sign the rate is given with', () => {
    expect(deficitPct('BULK', 0.25, 2800)).toBeCloseTo(-0.09821, 4);
    expect(deficitPct('BULK', 0.05, 2800)).toBe(-0.05);
    expect(deficitPct('BULK', 2, 2800)).toBe(-0.15);
    expect(deficitPct('BULK', -0.25, 2800)).toBeCloseTo(-0.09821, 4);
  });

  it('BULK targets sit above TDEE with protein and fat held', () => {
    const base = {
      sex: 'male' as const,
      age: 23,
      height_cm: 186,
      weight_kg: 90,
      bodyfat_pct: 18,
      activity_level: 'moderate' as const,
      goal_rate_kg_per_week: 0.25,
    };
    const bulk = computeTargets({ ...base, mode: 'BULK' });
    const keep = computeTargets({ ...base, mode: 'MAINTAIN' });
    expect(bulk.kcal).toBeGreaterThan(keep.kcal);
    expect(bulk.kcal / bulk.tdee).toBeCloseTo(1 + (0.25 * 7700) / (bulk.tdee * 7), 3);
    expect(bulk.protein_g).toBe(keep.protein_g);
    expect(bulk.fat_g).toBeGreaterThanOrEqual(keep.fat_g);
    expect(bulk.floors_applied).toEqual([]);
  });

  it('RECOMP is capped at 0.10 and never negative', () => {
    expect(deficitPct('RECOMP', 0.5, 2800)).toBe(0.1);
    expect(deficitPct('RECOMP', 0, 2800)).toBe(0);
    expect(deficitPct('RECOMP', 0.1, 2800)).toBeCloseTo(0.0393, 3);
  });
});

describe('computeTargets (§3.4)', () => {
  it('derives the full target set with no floors engaged', () => {
    const t = computeTargets(base);
    expect(t.tdee_source).toBe('formula');
    expect(t.tdee).toBeCloseTo(2716.22, 1);
    expect(t.deficit_pct).toBeCloseTo(0.20249, 4);
    expect(t.kcal).toBeCloseTo(2166.2, 0);
    expect(t.protein_g).toBe(128);
    expect(t.fat_g).toBeCloseTo(52.95, 1);
    expect(t.carb_g).toBeCloseTo(294.4, 0);
    expect(t.fiber_g).toBeCloseTo(30.33, 1);
    expect(t.water_ml).toBe(2800);
    expect(t.floors_applied).toEqual([]);
  });

  it('uses 1.8 g/kg of target weight for protein when body fat is unknown', () => {
    const t = computeTargets({ ...base, bodyfat_pct: undefined, target_weight_kg: 75 });
    expect(t.protein_g).toBeCloseTo(135, 5);
    expect(t.lbm_kg).toBeUndefined();
  });

  it('falls back to current weight for protein when neither body fat nor target is known', () => {
    const t = computeTargets({ ...base, bodyfat_pct: undefined });
    expect(t.protein_g).toBeCloseTo(144, 5);
  });

  it('RECOMP holds protein at the upper bound (2.2 g/kg LBM)', () => {
    const t = computeTargets({ ...base, mode: 'RECOMP' });
    expect(t.protein_g).toBeCloseTo(140.8, 5);
    expect(t.deficit_pct).toBe(0.1);
  });

  it('MAINTAIN sets kcal to TDEE', () => {
    const t = computeTargets({ ...base, mode: 'MAINTAIN' });
    expect(t.kcal).toBeCloseTo(t.tdee, 6);
    expect(t.deficit_pct).toBe(0);
  });

  it('applies the BMR×1.10 floor', () => {
    const t = computeTargets({
      sex: 'female',
      age: 40,
      height_cm: 160,
      weight_kg: 50,
      activity_level: 'sedentary',
      mode: 'CUT',
      goal_rate_kg_per_week: 1,
      target_weight_kg: 45,
    });
    expect(t.bmr).toBe(1139);
    expect(t.deficit_pct).toBe(0.25);
    expect(t.floors_applied).toEqual(['bmr_110pct']);
    expect(t.kcal).toBeCloseTo(1252.9, 5);
    expect(t.protein_g).toBeCloseTo(81, 5);
    expect(t.fat_g).toBeCloseTo(30.63, 1);
    expect(t.carb_g).toBeCloseTo(163.3, 0);
  });

  it('applies the sex minimum after the BMR floor', () => {
    const t = computeTargets({
      sex: 'female',
      age: 60,
      height_cm: 150,
      weight_kg: 45,
      activity_level: 'sedentary',
      mode: 'CUT',
      goal_rate_kg_per_week: 0.5,
    });
    expect(t.floors_applied).toEqual(['bmr_110pct', 'sex_minimum']);
    expect(t.kcal).toBe(1200);
  });

  it('uses a measured TDEE when supplied', () => {
    const t = computeTargets({ ...base, measured_tdee: 3000 });
    expect(t.tdee).toBe(3000);
    expect(t.tdee_source).toBe('measured');
    expect(isProvisional(t.tdee_source)).toBe(false);
    expect(isProvisional('formula')).toBe(true);
  });

  it('never violates any floor and fat is a fixed point, across a grid of inputs', () => {
    const sexes = ['male', 'female'] as const;
    const modes = ['CUT', 'MAINTAIN', 'RECOMP'] as const;
    const acts = ['sedentary', 'light', 'moderate', 'heavy'] as const;
    for (const sex of sexes)
      for (const mode of modes)
        for (const activity_level of acts)
          for (const weight_kg of [45, 60, 80, 110, 150])
            for (const bodyfat_pct of [undefined, 10, 25, 40])
              for (const goal_rate_kg_per_week of [0, 0.25, 0.5, 1, 2]) {
                const i: TargetInputs = {
                  sex,
                  age: 35,
                  height_cm: 170,
                  weight_kg,
                  bodyfat_pct,
                  activity_level,
                  mode,
                  goal_rate_kg_per_week,
                };
                const t = computeTargets(i);
                expect(t.kcal).toBeGreaterThanOrEqual(t.bmr * 1.1 - 1e-9);
                expect(t.kcal).toBeGreaterThanOrEqual(sexFloor(sex));
                expect(t.kcal).toBeGreaterThanOrEqual(t.protein_g * 4 + t.fat_g * 9 + 50 - 1e-9);
                expect(t.fat_g).toBeCloseTo(fatTarget(weight_kg, t.kcal), 9);
                expect(t.carb_g).toBeGreaterThanOrEqual(0);
                expect(t.fiber_g).toBeGreaterThanOrEqual(25);
                expect(t.deficit_pct).toBeGreaterThanOrEqual(0);
                expect(t.deficit_pct).toBeLessThanOrEqual(0.25);
              }
  });

  it('lands Eliya (§14) in the provisional neighbourhood', () => {
    const t = computeTargets({
      sex: 'male',
      age: 23,
      height_cm: 186,
      weight_kg: 110,
      bodyfat_pct: 35,
      activity_level: 'light',
      mode: 'CUT',
      goal_rate_kg_per_week: 0.5,
    });
    expect(t.bmr_uncertain).toBe(true);
    expect(t.tdee).toBeGreaterThan(2650);
    expect(t.tdee).toBeLessThan(2900);
    expect(t.kcal).toBeGreaterThan(2100);
    expect(t.kcal).toBeLessThan(2350);
    expect(t.protein_g).toBeGreaterThan(135);
    expect(t.protein_g).toBeLessThan(165);
    expect(t.fiber_g).toBeGreaterThan(29);
    expect(t.water_ml).toBe(3850);
  });
});

describe('scheduled mode switching (§3.5)', () => {
  const schedule = [
    { date: '2026-12-24', mode: 'MAINTAIN' as const },
    { date: '2027-01-25', mode: 'CUT' as const },
  ];
  it('uses the base mode before the first switch', () => {
    expect(resolveMode('CUT', schedule, '2026-12-23')).toBe('CUT');
  });
  it('switches on the day, and again on the return', () => {
    expect(resolveMode('CUT', schedule, '2026-12-24')).toBe('MAINTAIN');
    expect(resolveMode('CUT', schedule, '2027-01-10')).toBe('MAINTAIN');
    expect(resolveMode('CUT', schedule, '2027-01-25')).toBe('CUT');
  });
  it('reports the next switch', () => {
    expect(nextSwitch(schedule, '2026-12-01')?.date).toBe('2026-12-24');
    expect(nextSwitch(schedule, '2027-01-01')?.date).toBe('2027-01-25');
    expect(nextSwitch(schedule, '2027-02-01')).toBeUndefined();
  });
});
