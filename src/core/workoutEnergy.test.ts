import { describe, expect, it } from 'vitest';
import {
  describeEnergy,
  MAX_COUNTED_SEC,
  MET_LIGHT,
  MET_VIGOROUS,
  workoutEnergy,
} from './workoutEnergy';
import type { WorkoutEntry, WorkoutSet } from './types';

const set = (o: Partial<WorkoutSet> = {}): WorkoutSet => ({
  kind: 'normal',
  weight_kg: 80,
  reps: 8,
  done: true,
  ...o,
});

const entry = (sets: number, o: Partial<WorkoutSet> = {}): WorkoutEntry => ({
  exercise_id: 'library:0025',
  name: 'Barbell Bench Press',
  load_type: 'weight_reps',
  sets: Array.from({ length: sets }, () => set(o)),
});

const base = { bodyweight_kg: 90, duration_sec: 60 * 60 };

describe('workoutEnergy', () => {
  it('is MET times bodyweight times hours', () => {
    // 20 sets in 60 minutes is 0.33/min, between the two ends.
    const e = workoutEnergy({ ...base, entries: [entry(20)] });
    expect(e.low).toBe(Math.round((MET_LIGHT * 90 * 1) / 5) * 5);
    expect(e.high).toBe(Math.round((MET_VIGOROUS * 90 * 1) / 5) * 5);
    expect(e.kcal).toBeGreaterThan(e.low);
    expect(e.kcal).toBeLessThan(e.high);
  });

  it('always offers a range, because no device is accurate for lifting', () => {
    const e = workoutEnergy({ ...base, entries: [entry(15)] });
    expect(e.high).toBeGreaterThan(e.low);
    expect(describeEnergy(e)).toMatch(/kcal, likely \d+–\d+/);
  });

  it('reads a dense session as more vigorous than a leisurely one', () => {
    const dense = workoutEnergy({ ...base, duration_sec: 40 * 60, entries: [entry(20)] });
    const leisurely = workoutEnergy({ ...base, duration_sec: 100 * 60, entries: [entry(20)] });
    expect(dense.met).toBeGreaterThan(leisurely.met);
  });

  it('stays inside the compendium bounds whatever the density', () => {
    for (const sets of [1, 5, 20, 60, 200]) {
      const e = workoutEnergy({ ...base, entries: [entry(sets)] });
      expect(e.met).toBeGreaterThanOrEqual(MET_LIGHT);
      expect(e.met).toBeLessThanOrEqual(MET_VIGOROUS);
      expect(e.kcal).toBeGreaterThanOrEqual(e.low);
      expect(e.kcal).toBeLessThanOrEqual(e.high);
    }
  });

  it('ignores warm-ups and unticked sets when judging density', () => {
    const real = workoutEnergy({ ...base, entries: [entry(20)] });
    const padded = workoutEnergy({
      ...base,
      entries: [entry(20), entry(20, { kind: 'warmup' }), entry(20, { done: false })],
    });
    expect(padded.met).toBeCloseTo(real.met, 10);
  });

  it('caps a session left running overnight', () => {
    const overnight = workoutEnergy({ ...base, duration_sec: 10 * 3600, entries: [entry(20)] });
    expect(overnight.minutes).toBe(MAX_COUNTED_SEC / 60);
    expect(overnight.high).toBe(Math.round((MET_VIGOROUS * 90 * 3) / 5) * 5);
  });

  it('is zero rather than NaN with nothing to go on', () => {
    expect(workoutEnergy({ ...base, duration_sec: 0, entries: [] }).kcal).toBe(0);
    expect(workoutEnergy({ ...base, bodyweight_kg: 0, entries: [entry(10)] }).kcal).toBe(0);
    expect(workoutEnergy({ ...base, duration_sec: -5, entries: [] }).kcal).toBe(0);
  });

  it('scales with bodyweight', () => {
    const light = workoutEnergy({ ...base, bodyweight_kg: 60, entries: [entry(20)] });
    const heavy = workoutEnergy({ ...base, bodyweight_kg: 120, entries: [entry(20)] });
    expect(heavy.kcal).toBeGreaterThan(light.kcal);
    expect(heavy.kcal / light.kcal).toBeCloseTo(2, 1);
  });

  it('rounds to five, because the data has no final digit', () => {
    for (const sets of [8, 13, 21]) {
      const e = workoutEnergy({ ...base, entries: [entry(sets)] });
      expect(e.kcal % 5).toBe(0);
      expect(e.low % 5).toBe(0);
      expect(e.high % 5).toBe(0);
    }
  });
});
