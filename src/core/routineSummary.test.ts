import { describe, expect, it } from 'vitest';
import {
  CHANGEOVER_SEC,
  DEFAULT_REST_SEC,
  describeRest,
  describeSets,
  describeTarget,
  estimateMinutes,
  groupSupersets,
  routineMuscles,
  totalSets,
  WORK_SEC_PER_SET,
} from './routineSummary';
import type { Muscle } from './types';

describe('estimateMinutes', () => {
  it('is nothing for nothing', () => {
    expect(estimateMinutes([])).toBe(0);
    expect(estimateMinutes([{ sets: 0 }])).toBe(0);
  });

  it('works each set, rests between them, and changes over once per exercise', () => {
    // 3 sets: 3 × 40 work + 2 × 120 rest + 60 changeover = 420 s = 7 min → 5.
    expect(estimateMinutes([{ sets: 3, rest_sec: 120 }])).toBe(5);
    // Four of those: 1,680 s = 28 min → 30.
    expect(estimateMinutes(Array.from({ length: 4 }, () => ({ sets: 3, rest_sec: 120 })))).toBe(30);
  });

  it('uses the default rest when the routine does not say', () => {
    const sec = 3 * WORK_SEC_PER_SET + 2 * DEFAULT_REST_SEC + CHANGEOVER_SEC;
    const n = 6;
    expect(estimateMinutes(Array.from({ length: n }, () => ({ sets: 3 })))).toBe(
      Math.round((n * sec) / 60 / 5) * 5,
    );
    expect(estimateMinutes([{ sets: 3 }], 180)).toBe(
      Math.max(5, Math.round((3 * 40 + 2 * 180 + 60) / 60 / 5) * 5),
    );
  });

  it('a superset rests once per round, after its last exercise', () => {
    const straight = estimateMinutes([
      { sets: 4, rest_sec: 90 },
      { sets: 4, rest_sec: 90 },
    ]);
    const superset = estimateMinutes([
      { sets: 4, rest_sec: 90, superset: 'A' },
      { sets: 4, rest_sec: 90, superset: 'A' },
    ]);
    // Straight: 2 × (160 + 270 + 60) = 980 s. Superset: 160 + 60 + 160 + 360 + 60 = 800 s.
    expect(straight).toBe(15);
    expect(superset).toBe(15);
    const longStraight = estimateMinutes(
      Array.from({ length: 6 }, () => ({ sets: 4, rest_sec: 90 })),
    );
    const longSuper = estimateMinutes(
      Array.from({ length: 6 }, (_, i) => ({
        sets: 4,
        rest_sec: 90,
        superset: String.fromCharCode(65 + Math.floor(i / 2)),
      })),
    );
    expect(longSuper).toBeLessThan(longStraight);
  });

  it('is at least five minutes once there is anything to do, and never negative', () => {
    expect(estimateMinutes([{ sets: 1, rest_sec: 0 }])).toBe(5);
    expect(estimateMinutes([{ sets: 2, rest_sec: -30 }])).toBe(5);
  });

  it('rounds to five minutes, the resolution an estimate has', () => {
    for (let n = 1; n <= 10; n++) {
      expect(
        estimateMinutes(Array.from({ length: n }, () => ({ sets: 3, rest_sec: 90 }))) % 5,
      ).toBe(0);
    }
  });
});

describe('totalSets', () => {
  it('adds the sets, ignoring nonsense', () => {
    expect(totalSets([])).toBe(0);
    expect(totalSets([{ sets: 3 }, { sets: 4 }, { sets: -2 }, { sets: 2.6 }])).toBe(10);
  });
});

describe('routineMuscles', () => {
  const primary: Record<string, Muscle> = {
    bench: 'chest',
    fly: 'chest',
    pushdown: 'triceps',
    raise: 'shoulders',
    run: 'cardio',
  };
  const of = (id: string) => primary[id];

  it('lists primary muscles by sets, most first', () => {
    expect(
      routineMuscles(
        [
          { exercise_id: 'pushdown', sets: 3 },
          { exercise_id: 'bench', sets: 4 },
          { exercise_id: 'fly', sets: 3 },
          { exercise_id: 'raise', sets: 3 },
        ],
        of,
      ),
    ).toEqual([
      { muscle: 'chest', sets: 7 },
      { muscle: 'triceps', sets: 3 },
      { muscle: 'shoulders', sets: 3 },
    ]);
  });

  it('leaves out cardio, unknown exercises and empty items', () => {
    expect(
      routineMuscles(
        [
          { exercise_id: 'run', sets: 1 },
          { exercise_id: 'mystery', sets: 3 },
          { exercise_id: 'bench', sets: 0 },
        ],
        of,
      ),
    ).toEqual([]);
  });
});

describe('describeTarget and describeRest', () => {
  it('prints the sets and the range', () => {
    expect(describeTarget({ sets: 3, rep_low: 8, rep_high: 12 })).toBe('3 × 8–12');
    expect(describeTarget({ sets: 4, rep_low: 10, rep_high: 10 })).toBe('4 × 10');
    expect(describeTarget({ sets: 4, rep_low: 6 })).toBe('4 × 6');
    expect(describeTarget({ sets: 5, rep_high: 5 })).toBe('5 × 5');
    expect(describeTarget({ sets: 3 })).toBe('3 sets');
    expect(describeTarget({ sets: 1 })).toBe('1 set');
  });

  it('prints rest the way a clock does', () => {
    expect(describeRest(90)).toBe('1:30 rest');
    expect(describeRest(120)).toBe('2 min rest');
    expect(describeRest(45)).toBe('0:45 rest');
    expect(describeRest(0)).toBeUndefined();
    expect(describeRest(undefined)).toBeUndefined();
  });
});

describe('groupSupersets', () => {
  it('groups neighbours that share a letter, and keeps each item’s index', () => {
    const items = [{}, { superset: 'A' }, { superset: 'A' }, {}, { superset: 'B' }];
    expect(
      groupSupersets(items).map((g) => [g.superset ?? '-', g.items.map((x) => x.index)]),
    ).toEqual([
      ['-', [0]],
      ['A', [1, 2]],
      ['-', [3]],
      ['B', [4]],
    ]);
  });

  it('starts a new group when a letter comes back after a gap', () => {
    const items = [{ superset: 'A' }, {}, { superset: 'A' }];
    expect(groupSupersets(items)).toHaveLength(3);
  });

  it('is empty for an empty routine', () => {
    expect(groupSupersets([])).toEqual([]);
  });
});

describe('describeSets', () => {
  const s = (weight_kg: number | undefined, reps: number) => ({
    ...(weight_kg != null ? { weight_kg } : {}),
    reps,
  });

  it('says the weight once when it held', () => {
    expect(describeSets([s(60, 8), s(60, 8), s(60, 7)], 'weight_reps', 'kg')).toBe(
      '60 kg × 8, 8, 7',
    );
    expect(describeSets([s(60, 8)], 'weight_reps', 'lb')).toBe('132.3 lb × 8');
  });

  it('pairs each weight with its reps when it moved', () => {
    expect(describeSets([s(60, 8), s(62.5, 6)], 'weight_reps', 'kg')).toBe(
      '60 kg × 8, 62.5 kg × 6',
    );
  });

  it('reps alone for body weight, and the belt for weighted body weight', () => {
    expect(describeSets([s(undefined, 10), s(undefined, 9)], 'bodyweight_reps', 'kg')).toBe(
      '10, 9 reps',
    );
    expect(describeSets([s(10, 8), s(10, 6)], 'weighted_bodyweight', 'kg')).toBe('+10 kg × 8, 6');
    expect(describeSets([s(0, 8)], 'weighted_bodyweight', 'kg')).toBe('Body weight × 8');
  });

  it('seconds for a hold and metres for distance', () => {
    expect(describeSets([{ seconds: 45 }, { seconds: 40.4 }], 'time', 'kg')).toBe('45 s, 40 s');
    expect(describeSets([{ distance_m: 400 }], 'distance_time', 'kg')).toBe('400 m');
    expect(describeSets([{}], 'time', 'kg')).toBeUndefined();
    expect(describeSets([{}], 'distance_time', 'kg')).toBeUndefined();
  });

  it('nothing to say is undefined', () => {
    expect(describeSets([], 'weight_reps', 'kg')).toBeUndefined();
    expect(describeSets([{ weight_kg: 60 }], 'weight_reps', 'kg')).toBeUndefined();
  });

  it('a set with no weight on a loaded lift reads as body weight rather than inventing one', () => {
    expect(describeSets([s(undefined, 8)], 'weight_reps', 'kg')).toBe('Body weight × 8');
  });
});
