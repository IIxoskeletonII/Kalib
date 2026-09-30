import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import {
  DEFAULT_ENGINE,
  decidePublish,
  estimateTdee,
  firstEstimateDay,
  type EngineDay,
} from './tdee';
import { computeTrend } from './trend';

const DAY1 = '2026-09-21';

// Deterministic RNG so the synthetic person is the same on every run.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rand: () => number): number {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface SimOptions {
  seed: number;
  days: number;
  trueTdee: number;
  intakeMean: number;
  intakeSd: number;
  /** Probability a day goes unlogged / unweighed. */
  gapLog: number;
  gapWeigh: number;
  /** Water/glycogen shed over the first week, kg. */
  waterDrop: number;
  /** Raw scale noise, kg. */
  scaleSd: number;
}

interface SimDay {
  date: string;
  intake: number; // true intake
  logged?: number; // what the app saw
  weight?: number; // what the scale showed
}

/**
 * A synthetic person: fat mass follows energy balance at 7,700 kcal/kg; a water/glycogen
 * drop plays out over the first week; the scale adds i.i.d. noise plus a slow AR(1) wobble.
 */
function simulate(o: SimOptions): SimDay[] {
  const rand = mulberry32(o.seed);
  let fatMassKg = 110;
  let wobble = 0;
  const out: SimDay[] = [];
  for (let i = 0; i < o.days; i++) {
    const intake = Math.max(800, o.intakeMean + o.intakeSd * gaussian(rand));
    fatMassKg += (intake - o.trueTdee) / 7700;
    const water = o.waterDrop * Math.exp(-i / 3); // mostly gone by day 7
    wobble = 0.7 * wobble + 0.3 * gaussian(rand);
    const scale = fatMassKg + water + wobble + o.scaleSd * gaussian(rand);
    const d: SimDay = { date: addDays(DAY1, i), intake };
    if (rand() >= o.gapLog) d.logged = intake + 100 * gaussian(rand);
    if (rand() >= o.gapWeigh) d.weight = Math.round(scale * 10) / 10;
    out.push(d);
  }
  return out;
}

/** The app's view on `today`: trend from weigh-ins so far, logged kcal per day. */
function engineDays(sim: SimDay[], today: string): EngineDay[] {
  const weighIns = sim
    .filter((d) => d.weight != null && d.date <= today)
    .map((d) => ({ date: d.date, weight_kg: d.weight! }));
  const trend = new Map(computeTrend(weighIns, undefined, today).map((p) => [p.date, p]));
  return sim
    .filter((d) => d.date <= today)
    .map((d) => {
      const t = trend.get(d.date);
      return {
        date: d.date,
        kcal: d.logged,
        low_confidence_share: 0.1,
        trend: t?.trend,
        raw: t?.raw,
        weighed: t?.weighed ?? false,
      };
    });
}

describe('estimateTdee — gating', () => {
  it('is calibrating until day 24 and needs enough logged days and weigh-ins', () => {
    const sim = simulate({
      seed: 1,
      days: 40,
      trueTdee: 2800,
      intakeMean: 2200,
      intakeSd: 250,
      gapLog: 0,
      gapWeigh: 0,
      waterDrop: 1.5,
      scaleSd: 0.6,
    });
    expect(firstEstimateDay()).toBe(24);
    const day23 = estimateTdee(engineDays(sim, addDays(DAY1, 22)), DAY1, addDays(DAY1, 22));
    expect(day23.status).toBe('calibrating');
    const day24 = estimateTdee(engineDays(sim, addDays(DAY1, 23)), DAY1, addDays(DAY1, 23));
    expect(day24.status).toBe('ok');
    if (day24.status === 'ok') {
      expect(day24.estimate.window_days).toBe(14);
      expect(day24.estimate.logged_days).toBe(14);
    }
    // Same person, but logging stops after day 12: not enough logged days in the window.
    const patchy: SimDay[] = sim.map((d, i) => {
      if (i < 12) return d;
      const { logged: _drop, ...rest } = d;
      void _drop;
      return rest;
    });
    const r = estimateTdee(engineDays(patchy, addDays(DAY1, 23)), DAY1, addDays(DAY1, 23));
    expect(r.status).toBe('insufficient');
    if (r.status === 'insufficient') expect(r.logged_days).toBe(2);
  });

  it('never lets days 1–10 into the window', () => {
    const sim = simulate({
      seed: 2,
      days: 30,
      trueTdee: 2800,
      intakeMean: 2200,
      intakeSd: 0,
      gapLog: 0,
      gapWeigh: 0,
      waterDrop: 0,
      scaleSd: 0,
    });
    const r = estimateTdee(engineDays(sim, addDays(DAY1, 29)), DAY1, addDays(DAY1, 29));
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.estimate.window_days).toBe(20); // days 11..30
    const r40 = estimateTdee(engineDays(sim, addDays(DAY1, 39)), DAY1, addDays(DAY1, 39));
    if (r40.status === 'ok') expect(r40.estimate.window_days).toBe(28); // days 13..40
  });
});

describe('estimateTdee — synthetic 90 days (SPEC §4 ground truth, ten people)', () => {
  const truth = 2800;
  interface R {
    seed: number;
    day: number;
    tdee_kcal: number;
    ci_low: number;
    ci_high: number;
    data_quality: number;
    method: string;
    filter_days: number;
  }
  const results: R[] = [];
  for (let seed = 1; seed <= 10; seed++) {
    const sim = simulate({
      seed,
      days: 90,
      trueTdee: truth,
      intakeMean: 2200,
      intakeSd: 250,
      gapLog: 0.1,
      gapWeigh: 0.1,
      waterDrop: 1.5,
      scaleSd: 0.6,
    });
    for (let i = 23; i < 90; i++) {
      const today = addDays(DAY1, i);
      const r = estimateTdee(engineDays(sim, today), DAY1, today);
      if (r.status === 'ok') results.push({ seed, day: i + 1, ...r.estimate });
    }
  }
  const halfWidth = (r: R) => (r.ci_high - r.ci_low) / 2;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it('produces an estimate on nearly every day from day 24', () => {
    expect(results.length).toBeGreaterThanOrEqual(10 * 60);
  });

  it('converges: RMS error under 85 kcal from day 45, and within ±150 on day 90', () => {
    const late = results.filter((r) => r.day >= 45);
    const rms = Math.sqrt(mean(late.map((r) => (r.tdee_kcal - truth) ** 2)));
    expect(rms).toBeLessThan(85); // measured 71 with the filter; the trend difference gave 108
    const d90 = results.filter((r) => r.day === 90);
    const close = d90.filter((r) => Math.abs(r.tdee_kcal - truth) <= 150).length / d90.length;
    expect(close).toBeGreaterThanOrEqual(0.95);
  });

  it('no longer runs high early: the filter reads raw weigh-ins, so the EMA lag is gone', () => {
    // §4.5 recorded the old behaviour — "the first estimates run ≈200 kcal high" — as the price
    // of taking the difference between two EMA points. Measured bias is now −81 kcal.
    const early = results.filter((r) => r.day <= 30);
    const bias = mean(early.map((r) => r.tdee_kcal - truth));
    expect(Math.abs(bias)).toBeLessThan(150);
    const settled = results.filter((r) => r.day >= 50);
    expect(Math.abs(mean(settled.map((r) => r.tdee_kcal - truth)))).toBeLessThan(40);
  });

  it('every estimate comes from the filter once raw readings exist', () => {
    expect(results.every((r) => r.method === 'filter')).toBe(true);
    // The span starts at day 11 but the filter only opens on the first reading inside it, so on
    // day 24 a weigh-in gap can leave it a day or two short of the full fourteen.
    expect(Math.min(...results.map((r) => r.filter_days))).toBeGreaterThanOrEqual(10);
    expect(Math.max(...results.map((r) => r.filter_days))).toBeGreaterThanOrEqual(75);
  });

  it('the 95% interval covers the truth on at least 95% of days, early ones included', () => {
    const covered = results.filter((r) => r.ci_low <= truth && truth <= r.ci_high).length;
    expect(covered / results.length).toBeGreaterThanOrEqual(0.95);
  });

  it('keeps narrowing instead of flooring: the filter has no window to forget with', () => {
    const on = (d: number) => mean(results.filter((r) => r.day === d).map(halfWidth));
    // Wide and honest on day 24 (fourteen days of data really is that uncertain), then down
    // past the ±250 floor the 28-day trend difference could never beat.
    expect(on(24)).toBeGreaterThan(on(45));
    expect(on(45)).toBeGreaterThan(on(60));
    expect(on(60)).toBeGreaterThan(on(90));
    expect(on(90)).toBeLessThan(240);
  });

  it('data quality reflects the gaps', () => {
    for (const r of results) {
      expect(r.data_quality).toBeGreaterThan(0.5);
      expect(r.data_quality).toBeLessThanOrEqual(1);
    }
  });
});

describe('estimateTdee — the filter against the §4.2 trend difference', () => {
  // The reason the estimator changed, run as an experiment on one body of data: the same ten
  // synthetic people, scored once with raw readings available and once without.
  const truth = 2800;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  function score(withRaw: boolean) {
    const errors: number[] = [];
    const early: number[] = [];
    let covered = 0;
    let n = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const sim = simulate({
        seed,
        days: 90,
        trueTdee: truth,
        intakeMean: 2200,
        intakeSd: 250,
        gapLog: 0.1,
        gapWeigh: 0.1,
        waterDrop: 1.5,
        scaleSd: 0.6,
      });
      for (let i = 23; i < 90; i++) {
        const today = addDays(DAY1, i);
        const days = engineDays(sim, today).map((d) => (withRaw ? d : { ...d, raw: undefined }));
        const r = estimateTdee(days, DAY1, today);
        if (r.status !== 'ok') continue;
        const e = r.estimate;
        expect(e.method).toBe(withRaw ? 'filter' : 'trend');
        if (i + 1 >= 45) errors.push(e.tdee_kcal - truth);
        if (i + 1 <= 30) early.push(e.tdee_kcal - truth);
        if (e.ci_low <= truth && truth <= e.ci_high) covered++;
        n++;
      }
    }
    return {
      rms: Math.sqrt(mean(errors.map((x) => x * x))),
      earlyBias: mean(early),
      coverage: covered / n,
    };
  }

  const filter = score(true);
  const trend = score(false);

  it('is more accurate once the record has settled', () => {
    expect(filter.rms).toBeLessThan(trend.rms);
    expect(filter.rms).toBeLessThan(trend.rms * 0.8); // 71 against 108
  });

  it('removes the early high bias rather than trading it for another one', () => {
    expect(Math.abs(filter.earlyBias)).toBeLessThan(Math.abs(trend.earlyBias) / 2);
  });

  it('is better calibrated: the interval covers the truth more often, not less', () => {
    expect(filter.coverage).toBeGreaterThan(trend.coverage);
  });

  it('falls back cleanly when a record carries no raw readings at all', () => {
    // Imported history (§13.6) has day totals and weights but no scale readings to filter.
    expect(trend.rms).toBeLessThan(150);
    expect(trend.coverage).toBeGreaterThan(0.9);
  });
});

describe('estimateTdee — direction and arithmetic', () => {
  it('a perfect logger at maintenance measures exactly their intake', () => {
    const days: EngineDay[] = [];
    for (let i = 0; i < 40; i++) {
      days.push({ date: addDays(DAY1, i), kcal: 2500, trend: 90, weighed: true });
    }
    const r = estimateTdee(days, DAY1, addDays(DAY1, 39));
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.estimate.tdee_kcal).toBe(2500);
      expect(r.estimate.delta_trend_kg).toBe(0);
    }
  });

  it('losing 1 kg over 20 days on 2,200 kcal means a TDEE of 2,585', () => {
    const days: EngineDay[] = [];
    for (let i = 0; i < 30; i++) {
      // trend falls linearly 1 kg over days 11..30 (20-day span)
      const trend = i < 10 ? 90 : 90 - (i - 10) / 20;
      days.push({ date: addDays(DAY1, i), kcal: 2200, trend, weighed: true });
    }
    const r = estimateTdee(days, DAY1, addDays(DAY1, 29));
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.estimate.window_days).toBe(20);
      expect(r.estimate.delta_trend_kg).toBeCloseTo(-0.95, 2); // 19 of 20 steps inside the span
      expect(r.estimate.tdee_kcal).toBe(2200 + Math.round((0.95 * 7700) / 19));
    }
  });
});

describe('decidePublish — §4.3 guard rails', () => {
  it('caps movement at ±150 from the previous published value', () => {
    expect(decidePublish(3000, 2700, 2700).tdee).toBe(2850);
    expect(decidePublish(2400, 2700, 2700).tdee).toBe(2550);
    expect(decidePublish(2760, 2700, 2700)).toMatchObject({ tdee: 2760, capped: false });
    expect(decidePublish(3000, 2700, 2700).capped).toBe(true);
  });
  it('flags a measurement more than 600 kcal from the formula', () => {
    expect(decidePublish(3400, 2700, 2700).diverged).toBe(true);
    expect(decidePublish(2050, 2700, 2700).diverged).toBe(true);
    expect(decidePublish(3200, 2700, 2700).diverged).toBe(false);
  });
  it('weekly steps walk toward the measurement', () => {
    let published = 2700;
    for (let week = 0; week < 3; week++) published = decidePublish(3100, published, 2700).tdee;
    expect(published).toBe(3100); // 2850 → 3000 → 3100
  });
  it('uses the engine defaults the spec names', () => {
    expect(DEFAULT_ENGINE.window_days).toBe(28);
    expect(DEFAULT_ENGINE.excluded_days).toBe(10);
    expect(DEFAULT_ENGINE.min_logged_days).toBe(10);
    expect(DEFAULT_ENGINE.min_weighed_days).toBe(10);
  });
});
