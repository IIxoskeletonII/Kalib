import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTER,
  initialState,
  predict,
  runFilter,
  update,
  type FilterDay,
  type FilterOptions,
} from './kalman';

// Round numbers so every covariance step below can be checked by hand: an energy density of
// 100 kcal/kg makes k = 0.01, and zeroing the noise terms leaves only the filter's own algebra.
const O: FilterOptions = {
  energy_density: 100,
  weight_sigma_kg: 1,
  intake_sigma_kcal: 0,
  unlogged_intake_sigma_kcal: 0,
  tdee_drift_kcal: 0,
  biological_sigma_kg: 0,
  prior_tdee_sigma: 100,
  gate_sigma: 4,
  gate_inflate: 9,
};

describe('initialState', () => {
  it('anchors weight to the reading and leaves TDEE loose', () => {
    expect(initialState(50, 2000, O)).toEqual({
      weight: 50,
      tdee: 2000,
      var_weight: 1,
      var_tdee: 10000,
      cov: 0,
    });
  });
});

describe('predict', () => {
  it('moves weight by the energy balance of the day', () => {
    const s = predict(initialState(50, 2000, O), 1000, true, O);
    expect(s.weight).toBeCloseTo(40, 10); // (1000 − 2000)/100
    expect(s.tdee).toBe(2000); // TDEE itself does not move on a prediction
  });

  it('leaves weight alone when intake matches the current estimate', () => {
    expect(predict(initialState(50, 2000, O), 2000, true, O).weight).toBeCloseTo(50, 10);
  });

  it('propagates the covariance as F P Fᵀ + Q', () => {
    const s = predict(initialState(50, 2000, O), 2000, true, O);
    // var_w = 1 − 2(0.01)(0) + 0.01² × 10000 = 2; cov = 0 − 0.01 × 10000 = −100.
    expect(s.var_weight).toBeCloseTo(2, 10);
    expect(s.cov).toBeCloseTo(-100, 10);
    expect(s.var_tdee).toBeCloseTo(10000, 10);
  });

  it('builds the negative weight/TDEE correlation that makes the update work', () => {
    // A higher burn means a lower future weight, so the two must correlate negatively.
    expect(predict(initialState(50, 2000, O), 2000, true, O).cov).toBeLessThan(0);
  });

  it('widens the step more when the day was never logged', () => {
    const known = predict(initialState(50, 2000, DEFAULT_FILTER), 2200, true, DEFAULT_FILTER);
    const guessed = predict(initialState(50, 2000, DEFAULT_FILTER), 2200, false, DEFAULT_FILTER);
    expect(guessed.var_weight).toBeGreaterThan(known.var_weight);
  });

  it('lets TDEE drift, so an old estimate cannot freeze', () => {
    expect(
      predict(initialState(50, 2000, DEFAULT_FILTER), 2000, true, DEFAULT_FILTER).var_tdee,
    ).toBeGreaterThan(DEFAULT_FILTER.prior_tdee_sigma ** 2);
  });
});

describe('update', () => {
  const predicted = predict(initialState(50, 2000, O), 2000, true, O);

  it('shrinks both variances by the exact Kalman amount', () => {
    const { state, gated } = update(predicted, 50, 1, O);
    expect(gated).toBe(false);
    // S = var_w + R = 2 + 1 = 3; K_w = 2/3; K_e = −100/3.
    expect(state.var_weight).toBeCloseTo(2 / 3, 10);
    expect(state.cov).toBeCloseTo(-100 / 3, 10);
    expect(state.var_tdee).toBeCloseTo(10000 - 10000 / 3, 10);
  });

  it('leaves the state alone when the reading is exactly what was predicted', () => {
    const { state } = update(predicted, 50, 1, O);
    expect(state.weight).toBeCloseTo(50, 10);
    expect(state.tdee).toBeCloseTo(2000, 10);
  });

  it('reads heavier-than-predicted as burning less', () => {
    const { state } = update(predicted, 51, 1, O);
    expect(state.weight).toBeCloseTo(50 + 2 / 3, 10);
    expect(state.tdee).toBeCloseTo(2000 - 100 / 3, 10);
  });

  it('reads lighter-than-predicted as burning more', () => {
    expect(update(predicted, 49, 1, O).state.tdee).toBeGreaterThan(2000);
  });

  it('gates an implausible jump instead of believing it', () => {
    // Threshold is 4 × sqrt(2 + 1) ≈ 6.93 kg.
    const ok = update(predicted, 56, 1, O);
    const jump = update(predicted, 60, 1, O);
    expect(ok.gated).toBe(false);
    expect(jump.gated).toBe(true);
    // Gated, so R is nine times larger: S = 2 + 9 = 11 and the reading barely moves weight.
    expect(jump.state.weight).toBeCloseTo(50 + (2 / 11) * 10, 10);
  });

  it('still lets a gated reading through, so a real step change is absorbed eventually', () => {
    let s = predicted;
    for (let i = 0; i < 12; i++) {
      s = update(s, 60, 1, O).state;
      s = predict(s, 2000, true, O);
    }
    expect(s.weight).toBeGreaterThan(59);
  });

  it('trusts a reading less when the cycle says to (sigma_scale)', () => {
    const ordinary = update(predicted, 51, 1, O).state;
    const retaining = update(predicted, 51, 3, O).state;
    expect(Math.abs(retaining.weight - 50)).toBeLessThan(Math.abs(ordinary.weight - 50));
    expect(Math.abs(retaining.tdee - 2000)).toBeLessThan(Math.abs(ordinary.tdee - 2000));
  });

  it('treats a nonsense scale as an ordinary day rather than dividing by zero', () => {
    expect(update(predicted, 51, 0, O).state).toEqual(update(predicted, 51, 1, O).state);
  });
});

/** A person whose true TDEE is known, eating a fixed intake, weighed every day. */
function series(days: number, truth: number, intake: number, gapWeigh = 0): FilterDay[] {
  const out: FilterDay[] = [];
  let w = 110;
  for (let i = 0; i < days; i++) {
    const d: FilterDay = { date: `d${i}`, intake };
    const skipped = gapWeigh > 0 && i % gapWeigh === 1;
    if (!skipped) d.raw = Math.round(w * 10) / 10;
    out.push(d);
    w += (intake - truth) / 7700;
  }
  return out;
}

describe('runFilter', () => {
  it('recovers a known TDEE from a clean series', () => {
    const r = runFilter(series(56, 2600, 2200), 2200, 2200)!;
    expect(r.state.tdee).toBeCloseTo(2600, -2); // within ~50 kcal of the truth
    expect(r.observations).toBe(56);
    expect(r.gated).toBe(0);
  });

  it('keeps narrowing its interval as days accumulate — it has no window to forget past', () => {
    const ci = (n: number) =>
      1.96 * Math.sqrt(runFilter(series(n, 2600, 2200), 2200, 2200)!.state.var_tdee);
    expect(ci(28)).toBeGreaterThan(ci(56));
    expect(ci(56)).toBeGreaterThan(ci(90));
    // §14 asks for better than ±200 kcal; the 28-day window of §4.5 could never get there.
    expect(ci(28)).toBeGreaterThan(200);
    expect(ci(56)).toBeLessThan(200);
  });

  it('starts from a prior on the wrong side and still converges', () => {
    const low = runFilter(series(90, 2600, 2200), 2200, 1800)!.state.tdee;
    const high = runFilter(series(90, 2600, 2200), 2200, 3400)!.state.tdee;
    expect(low).toBeCloseTo(2600, -2);
    expect(high).toBeCloseTo(2600, -2);
  });

  it('survives missing weigh-ins', () => {
    const r = runFilter(series(60, 2600, 2200, 3), 2200, 2200)!;
    expect(r.observations).toBeLessThan(60);
    expect(r.state.tdee).toBeCloseTo(2600, -2);
  });

  it('substitutes the mean on unlogged days rather than skipping them', () => {
    const days = series(60, 2600, 2200).map((d, i) =>
      i % 4 === 0 ? { date: d.date, raw: d.raw } : d,
    );
    const r = runFilter(days, 2200, 2200)!;
    expect(r.steps).toBe(59);
    expect(r.state.tdee).toBeCloseTo(2600, -2);
  });

  it('has nothing to say without a single weigh-in', () => {
    expect(runFilter([{ date: 'd0', intake: 2200 }], 2200, 2200)).toBeUndefined();
    expect(runFilter([], 2200, 2200)).toBeUndefined();
  });

  it('ignores days before the first weigh-in', () => {
    const r = runFilter(
      [
        { date: 'a', intake: 2200 },
        { date: 'b', intake: 2200, raw: 100 },
      ],
      2200,
      2200,
    )!;
    expect(r.state.weight).toBe(100);
    expect(r.steps).toBe(0);
  });
});
