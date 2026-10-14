import { describe, expect, it } from 'vitest';
import { describePR, lastPerformance, newRecords, personalRecords } from './pr';
import { e1rm } from './sets';
import type { WorkoutEntry, WorkoutSession, WorkoutSet } from './types';

const set = (weight_kg: number, reps: number, o: Partial<WorkoutSet> = {}): WorkoutSet => ({
  kind: 'normal',
  weight_kg,
  reps,
  done: true,
  ...o,
});

const BENCH = 'library:0025';

function session(
  started_at: string,
  sets: WorkoutSet[],
  o: {
    id?: string;
    exercise_id?: string;
    name?: string;
    load_type?: WorkoutEntry['load_type'];
  } = {},
): WorkoutSession {
  return {
    id: o.id ?? started_at,
    user_id: 'local',
    created_at: started_at,
    updated_at: started_at,
    started_at,
    ended_at: started_at,
    name: 'Push',
    entries: [
      {
        exercise_id: o.exercise_id ?? BENCH,
        name: o.name ?? 'Barbell Bench Press',
        load_type: o.load_type ?? 'weight_reps',
        sets,
      },
    ],
  };
}

describe('personalRecords', () => {
  const history = [
    session('2026-09-01T09:00:00.000Z', [set(80, 8), set(80, 6)]),
    session('2026-09-08T09:00:00.000Z', [set(85, 5), set(80, 9)]),
    session('2026-09-15T09:00:00.000Z', [set(90, 3)]),
  ];

  it('finds the heaviest, and when it happened', () => {
    const pr = personalRecords(history, BENCH);
    expect(pr.heaviest_kg).toBe(90);
    expect(pr.heaviest_reps).toBe(3);
    expect(pr.heaviest_at).toBe('2026-09-15T09:00:00.000Z');
  });

  it('finds the best estimated max, which need not be the heaviest set', () => {
    const pr = personalRecords(history, BENCH);
    // 80x9 estimates higher than 90x3.
    expect(pr.best_e1rm_kg).toBeCloseTo(e1rm(80, 9)!, 9);
    expect(pr.best_e1rm_at).toBe('2026-09-08T09:00:00.000Z');
  });

  it('finds the best single set by volume, a different question again', () => {
    const pr = personalRecords(history, BENCH);
    expect(pr.best_set_volume_kg).toBe(80 * 9);
  });

  it('remembers the most reps at each weight', () => {
    const pr = personalRecords(history, BENCH);
    expect(pr.reps_at_weight.get(80)).toBe(9);
    expect(pr.reps_at_weight.get(85)).toBe(5);
    expect(pr.reps_at_weight.get(90)).toBe(3);
  });

  it('breaks a tie on weight by reps, so a heavy single still stands', () => {
    const pr = personalRecords(
      [
        session('2026-09-01T09:00:00.000Z', [set(100, 1)]),
        session('2026-09-08T09:00:00.000Z', [set(100, 3)]),
      ],
      BENCH,
    );
    expect(pr.heaviest_kg).toBe(100);
    expect(pr.heaviest_reps).toBe(3);
  });

  it('ignores warm-ups and unticked sets entirely', () => {
    const pr = personalRecords(
      [
        session('2026-09-01T09:00:00.000Z', [
          set(200, 5, { kind: 'warmup' }),
          set(300, 5, { done: false }),
          set(60, 5),
        ]),
      ],
      BENCH,
    );
    expect(pr.heaviest_kg).toBe(60);
  });

  it('ignores other exercises', () => {
    const pr = personalRecords(
      [session('2026-09-01T09:00:00.000Z', [set(200, 5)], { exercise_id: 'library:0043' })],
      BENCH,
    );
    expect(pr.heaviest_kg).toBeUndefined();
    expect(pr.reps_at_weight.size).toBe(0);
  });

  it('tracks the longest hold for timed work', () => {
    const pr = personalRecords(
      [
        session('2026-09-01T09:00:00.000Z', [{ kind: 'normal', seconds: 45, done: true }], {
          load_type: 'time',
        }),
        session('2026-09-08T09:00:00.000Z', [{ kind: 'normal', seconds: 70, done: true }], {
          load_type: 'time',
        }),
      ],
      BENCH,
    );
    expect(pr.best_seconds).toBe(70);
    expect(pr.best_seconds_at).toBe('2026-09-08T09:00:00.000Z');
  });

  it('is empty for an exercise never done', () => {
    const pr = personalRecords([], BENCH);
    expect(pr.heaviest_kg).toBeUndefined();
    expect(pr.reps_at_weight.size).toBe(0);
  });
});

describe('lastPerformance', () => {
  const history = [
    session('2026-09-01T09:00:00.000Z', [set(80, 8)], { id: 'a' }),
    session('2026-09-08T09:00:00.000Z', [set(85, 6), set(85, 5)], { id: 'b' }),
  ];

  it('returns the most recent time, not the best time', () => {
    const last = lastPerformance(history, BENCH)!;
    expect(last.session_id).toBe('b');
    expect(last.sets.map((s) => [s.weight_kg, s.reps])).toEqual([
      [85, 6],
      [85, 5],
    ]);
  });

  it('excludes the session in progress, so it does not show you your own set', () => {
    const live = session('2026-09-15T09:00:00.000Z', [set(90, 3)], { id: 'live' });
    expect(lastPerformance([...history, live], BENCH, 'live')!.session_id).toBe('b');
  });

  it('skips a session where the exercise was opened but never worked', () => {
    const skipped = session('2026-09-10T09:00:00.000Z', [set(85, 0, { done: false })], { id: 'c' });
    expect(lastPerformance([...history, skipped], BENCH)!.session_id).toBe('b');
  });

  it('leaves warm-ups out of what you are trying to beat', () => {
    const s = session('2026-09-20T09:00:00.000Z', [set(40, 10, { kind: 'warmup' }), set(90, 5)], {
      id: 'd',
    });
    expect(lastPerformance([s], BENCH)!.sets).toHaveLength(1);
  });

  it('is undefined the first time', () => {
    expect(lastPerformance([], BENCH)).toBeUndefined();
  });
});

describe('newRecords', () => {
  const history = [session('2026-09-01T09:00:00.000Z', [set(80, 8)], { id: 'a' })];

  it('reports a heavier top set, with what it beat', () => {
    const today = session('2026-09-08T09:00:00.000Z', [set(85, 5)], { id: 'b' });
    const hits = newRecords(today, history);
    const weight = hits.find((h) => h.kind === 'weight')!;
    expect(weight.value).toBe(85);
    expect(weight.previous).toBe(80);
  });

  it('reports more reps at a weight already used', () => {
    const today = session('2026-09-08T09:00:00.000Z', [set(80, 10)], { id: 'b' });
    const reps = newRecords(today, history).find((h) => h.kind === 'reps')!;
    expect(reps.value).toBe(10);
    expect(reps.previous).toBe(8);
  });

  it('does not call more reps at a brand new weight a record', () => {
    // 82.5 has never been used; doing 12 there is new, not an improvement.
    const today = session('2026-09-08T09:00:00.000Z', [set(82.5, 12)], { id: 'b' });
    expect(newRecords(today, history).some((h) => h.kind === 'reps')).toBe(false);
  });

  it('says nothing the first time an exercise is ever done', () => {
    // Otherwise every line would be a record on day one, exactly when someone first looks.
    const first = session('2026-09-01T09:00:00.000Z', [set(100, 5)], { id: 'a' });
    expect(newRecords(first, [])).toEqual([]);
  });

  it('reports nothing for a session that beat nothing', () => {
    const today = session('2026-09-08T09:00:00.000Z', [set(70, 5)], { id: 'b' });
    expect(newRecords(today, history)).toEqual([]);
  });

  it('cannot beat itself when the history is passed carelessly', () => {
    // The caller must exclude the session; if it does, a repeat of the same work sets nothing.
    const today = session('2026-09-08T09:00:00.000Z', [set(80, 8)], { id: 'b' });
    expect(newRecords(today, history)).toEqual([]);
  });

  it('names every kind of record it can report', () => {
    for (const kind of ['weight', 'e1rm', 'set_volume', 'reps', 'seconds'] as const) {
      expect(
        describePR({ exercise_id: BENCH, name: 'x', kind, value: 2, previous: 1 }),
      ).toBeTruthy();
    }
  });
});
