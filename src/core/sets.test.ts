import { describe, expect, it } from 'vitest';
import {
  bestE1rm,
  e1rm,
  entryVolume,
  isEmptySet,
  isWorkingSet,
  sessionDuration,
  sessionVolume,
  setVolume,
} from './sets';
import type { LoadType, WorkoutEntry, WorkoutSet } from './types';

const set = (o: Partial<WorkoutSet> = {}): WorkoutSet => ({
  kind: 'normal',
  weight_kg: 80,
  reps: 8,
  done: true,
  ...o,
});

const entry = (o: Partial<WorkoutEntry> = {}): WorkoutEntry => ({
  exercise_id: 'library:0025',
  name: 'Barbell Bench Press',
  load_type: 'weight_reps',
  sets: [set()],
  ...o,
});

describe('isWorkingSet', () => {
  it('counts a completed normal set', () => {
    expect(isWorkingSet(set())).toBe(true);
  });

  it('excludes a warm-up, whose size says more about the person than the training', () => {
    expect(isWorkingSet(set({ kind: 'warmup' }))).toBe(false);
  });

  it('excludes anything not yet ticked', () => {
    expect(isWorkingSet(set({ done: false }))).toBe(false);
  });

  it('counts a set taken to failure and a drop set', () => {
    expect(isWorkingSet(set({ kind: 'failure' }))).toBe(true);
    expect(isWorkingSet(set({ kind: 'drop' }))).toBe(true);
  });
});

describe('setVolume', () => {
  const v = (s: WorkoutSet, t: LoadType = 'weight_reps', bw?: number) => setVolume(s, t, bw);

  it('is weight times reps for ordinary loaded work', () => {
    expect(v(set({ weight_kg: 80, reps: 8 }))).toBe(640);
  });

  it('is zero for a set that was not done', () => {
    expect(v(set({ done: false }))).toBe(0);
  });

  it('uses bodyweight for bodyweight work', () => {
    expect(v({ kind: 'normal', reps: 10, done: true }, 'bodyweight_reps', 90)).toBe(900);
  });

  it('adds the belt to bodyweight for weighted bodyweight work', () => {
    expect(v(set({ weight_kg: 20, reps: 5 }), 'weighted_bodyweight', 90)).toBe(550);
  });

  it('is unknown, not zero, when bodyweight is missing', () => {
    // Twelve pull-ups is not zero work; saying so would be a lie rather than a gap.
    expect(v(set({ reps: 12 }), 'bodyweight_reps', undefined)).toBeUndefined();
    expect(v(set({ reps: 12 }), 'weighted_bodyweight', undefined)).toBeUndefined();
  });

  it('is genuinely zero kilograms for timed and distance work', () => {
    // Built literally rather than through the helper: a timed set carries no weight or reps
    // at all, and exactOptionalPropertyTypes rightly refuses to let us pass undefined for them.
    expect(v({ kind: 'normal', seconds: 60, done: true }, 'time')).toBe(0);
    expect(v(set({ seconds: 600, distance_m: 2000 }), 'distance_time')).toBe(0);
  });
});

describe('entryVolume and sessionVolume', () => {
  it('sums working sets and leaves warm-ups out', () => {
    const e = entry({
      sets: [
        set({ kind: 'warmup', weight_kg: 40, reps: 10 }),
        set({ weight_kg: 80, reps: 8 }),
        set({ weight_kg: 80, reps: 6 }),
      ],
    });
    const v = entryVolume(e);
    expect(v.kg).toBe(80 * 8 + 80 * 6);
    expect(v.working_sets).toBe(2);
    expect(v.reps).toBe(14);
    expect(v.unknown_sets).toBe(0);
  });

  it('reports sets it could not price rather than silently dropping them', () => {
    const e = entry({ load_type: 'bodyweight_reps', sets: [set({ reps: 12 }), set({ reps: 10 })] });
    const v = entryVolume(e);
    expect(v.kg).toBe(0);
    expect(v.unknown_sets).toBe(2);
    expect(v.working_sets).toBe(2);
    expect(v.reps).toBe(22);
  });

  it('adds up across exercises', () => {
    const s = {
      entries: [
        entry({ sets: [set({ weight_kg: 100, reps: 5 })] }),
        entry({ name: 'Squat', sets: [set({ weight_kg: 120, reps: 5 })] }),
      ],
    };
    expect(sessionVolume(s).kg).toBe(500 + 600);
    expect(sessionVolume(s).working_sets).toBe(2);
  });

  it('is zero for an empty session rather than throwing', () => {
    expect(sessionVolume({ entries: [] })).toEqual({
      kg: 0,
      unknown_sets: 0,
      working_sets: 0,
      reps: 0,
    });
  });
});

describe('e1rm', () => {
  it('returns the weight itself for a single, with no formula involved', () => {
    // Epley would claim 103% of a true max, which is nonsense for the rep that defines it.
    expect(e1rm(140, 1)).toBe(140);
  });

  it('sits between Epley and Brzycki', () => {
    const w = 100;
    const reps = 5;
    const epley = w * (1 + reps / 30);
    const brzycki = (w * 36) / (37 - reps);
    const est = e1rm(w, reps)!;
    expect(est).toBeCloseTo((epley + brzycki) / 2, 10);
    expect(est).toBeGreaterThan(Math.min(epley, brzycki));
    expect(est).toBeLessThan(Math.max(epley, brzycki));
  });

  it('agrees with the textbook figure for a known set', () => {
    // 100 kg x 5: Epley 116.7, Brzycki 112.5 — about 114.6.
    expect(e1rm(100, 5)).toBeCloseTo(114.58, 1);
  });

  it('rises with reps and with weight', () => {
    expect(e1rm(100, 8)!).toBeGreaterThan(e1rm(100, 5)!);
    expect(e1rm(110, 5)!).toBeGreaterThan(e1rm(100, 5)!);
  });

  it('declines to estimate past twelve reps, where the formulas stop agreeing', () => {
    expect(e1rm(60, 12)).toBeDefined();
    expect(e1rm(60, 13)).toBeUndefined();
    expect(e1rm(60, 30)).toBeUndefined();
  });

  it('refuses nonsense input rather than returning a number', () => {
    expect(e1rm(0, 5)).toBeUndefined();
    expect(e1rm(-10, 5)).toBeUndefined();
    expect(e1rm(100, 0)).toBeUndefined();
    expect(e1rm(100, 2.5)).toBeUndefined();
    expect(e1rm(Number.NaN, 5)).toBeUndefined();
  });
});

describe('bestE1rm', () => {
  it('takes the best working set, not the heaviest or the last', () => {
    const e = entry({
      sets: [
        set({ weight_kg: 100, reps: 3 }), // ~109
        set({ weight_kg: 90, reps: 8 }), // ~113
        set({ weight_kg: 95, reps: 4 }), // ~106
      ],
    });
    expect(bestE1rm(e)).toBeCloseTo(e1rm(90, 8)!, 10);
  });

  it('ignores warm-ups and unticked sets', () => {
    const e = entry({
      sets: [
        set({ kind: 'warmup', weight_kg: 200, reps: 5 }),
        set({ weight_kg: 300, reps: 5, done: false }),
        set({ weight_kg: 80, reps: 5 }),
      ],
    });
    expect(bestE1rm(e)).toBeCloseTo(e1rm(80, 5)!, 10);
  });

  it('is undefined when nothing can be estimated', () => {
    expect(bestE1rm(entry({ sets: [] }))).toBeUndefined();
    expect(bestE1rm(entry({ sets: [set({ reps: 20 })] }))).toBeUndefined();
  });

  it('prices bodyweight work at the lifter plus the belt, and refuses without bodyweight', () => {
    const chin = entry({
      load_type: 'weighted_bodyweight',
      sets: [set({ weight_kg: 10, reps: 8 })],
    });
    // The bug this guards: a belted chin-up read as a 12.5 kg one-rep max.
    expect(bestE1rm(chin)).toBeUndefined();
    expect(bestE1rm(chin, 80)).toBeCloseTo(e1rm(90, 8)!, 10);
    const bare = entry({
      load_type: 'weighted_bodyweight',
      sets: [{ kind: 'normal', reps: 6, done: true }],
    });
    expect(bestE1rm(bare, 80)).toBeCloseTo(e1rm(80, 6)!, 10);
    // Plain bodyweight carries no belt, whatever a stray weight field says.
    const push = entry({ load_type: 'bodyweight_reps', sets: [set({ weight_kg: 20, reps: 10 })] });
    expect(bestE1rm(push)).toBeUndefined();
    expect(bestE1rm(push, 70)).toBeCloseTo(e1rm(70, 10)!, 10);
  });

  it('has no answer for timed or distance work, whatever fields the set carries', () => {
    // A plank has no one-rep max. The set helper fills weight and reps by default, so without
    // a guard this would confidently return one.
    expect(bestE1rm(entry({ load_type: 'time', sets: [set({ seconds: 60 })] }))).toBeUndefined();
    expect(
      bestE1rm(entry({ load_type: 'distance_time', sets: [set({ distance_m: 2000 })] })),
    ).toBeUndefined();
  });
});

describe('sessionDuration', () => {
  it('measures from the timestamps, not from a clock that may have slept', () => {
    expect(
      sessionDuration({
        started_at: '2026-10-14T09:00:00.000Z',
        ended_at: '2026-10-14T10:03:20.000Z',
      }),
    ).toBe(3800);
  });

  it('is zero while the session is still running', () => {
    expect(sessionDuration({ started_at: '2026-10-14T09:00:00.000Z' })).toBe(0);
  });

  it('is zero rather than negative if the clock moved backwards', () => {
    expect(
      sessionDuration({
        started_at: '2026-10-14T10:00:00.000Z',
        ended_at: '2026-10-14T09:00:00.000Z',
      }),
    ).toBe(0);
  });
});

describe('isEmptySet', () => {
  it('knows what each kind of set needs before it counts as filled in', () => {
    expect(isEmptySet({ kind: 'normal', done: false }, 'weight_reps')).toBe(true);
    expect(isEmptySet({ kind: 'normal', reps: 8, done: false }, 'weight_reps')).toBe(false);
    expect(
      isEmptySet({ kind: 'normal', weight_kg: 0, reps: 10, done: false }, 'bodyweight_reps'),
    ).toBe(false);
    expect(isEmptySet({ kind: 'normal', done: false }, 'time')).toBe(true);
    expect(isEmptySet({ kind: 'normal', seconds: 45, done: false }, 'time')).toBe(false);
    expect(isEmptySet({ kind: 'normal', distance_m: 1000, done: false }, 'distance_time')).toBe(
      false,
    );
  });
});
