import { describe, expect, it } from 'vitest';
import type { WorkoutSet } from './types';
import {
  DEFAULT_INCREMENT_KG,
  STALL_SESSIONS,
  isStepUp,
  nextPrescription,
  performances,
  suggestedSet,
  workingLoad,
} from './progression';

/** A logged working set. */
const s = (weight_kg: number, reps: number, rir?: number): WorkoutSet => ({
  kind: 'normal',
  done: true,
  weight_kg,
  reps,
  ...(rir != null ? { rir } : {}),
});

/** Reps with no bar: pull-ups, press-ups. */
const body = (reps: number, rir?: number): WorkoutSet => ({
  kind: 'normal',
  done: true,
  reps,
  ...(rir != null ? { rir } : {}),
});

const RANGE = { load_type: 'weight_reps', rep_low: 6, rep_high: 8 } as const;

describe('workingLoad', () => {
  it('is the weight most of the sets used, not the heaviest one', () => {
    // A top single followed by three back-off sets is worked at the back-off weight. Judging
    // the session on the 100 would call three successful sets a failure.
    const perf = [s(100, 3), s(80, 8), s(80, 8), s(80, 7)];
    expect(workingLoad(perf)).toBe(80);
  });

  it('breaks a tie towards the heavier load', () => {
    expect(workingLoad([s(60, 8), s(65, 8)])).toBe(65);
  });

  it('ignores warm-ups and unticked sets', () => {
    const perf: WorkoutSet[] = [
      { kind: 'warmup', done: true, weight_kg: 40, reps: 10 },
      { kind: 'warmup', done: true, weight_kg: 40, reps: 10 },
      { kind: 'normal', done: false, weight_kg: 50, reps: 8 },
      s(70, 8),
    ];
    expect(workingLoad(perf)).toBe(70);
  });

  it('is undefined when nothing carried a load', () => {
    expect(workingLoad([body(10), body(9)])).toBeUndefined();
  });
});

describe('nextPrescription', () => {
  it('says first time when the exercise has never been done', () => {
    expect(nextPrescription([], RANGE)).toEqual({ kind: 'first_time', reason: 'no_history' });
  });

  it('treats a session of warm-ups only as no history', () => {
    const warmupsOnly: WorkoutSet[] = [{ kind: 'warmup', done: true, weight_kg: 40, reps: 10 }];
    expect(nextPrescription([warmupsOnly], RANGE).kind).toBe('first_time');
  });

  it('adds load once every set reaches the top of the range', () => {
    const p = nextPrescription([[s(60, 8), s(60, 8), s(60, 8)]], RANGE);
    expect(p).toEqual({
      kind: 'add_load',
      reason: 'cleared_range',
      weight_kg: 62.5,
      reps: 6,
      from_weight_kg: 60,
    });
  });

  it('will not add load when only some sets reached the top', () => {
    // Eight, eight, six. Two good sets and one short one is not a cleared range, and adding
    // weight here is how a stall gets built.
    const p = nextPrescription([[s(60, 8), s(60, 8), s(60, 6)]], RANGE);
    expect(p.kind).toBe('add_reps');
    expect(p.weight_kg).toBe(60);
    expect(p.reps).toBe(7);
  });

  it('asks for one more rep than the weakest set, capped at the top of the range', () => {
    const p = nextPrescription([[s(60, 7), s(60, 7), s(60, 7)]], RANGE);
    expect(p.reps).toBe(8);
    // and never beyond it
    const q = nextPrescription([[s(60, 8), s(60, 7), s(60, 8)]], RANGE);
    expect(q.reps).toBe(8);
  });

  it('holds the load when the bottom of the range was missed', () => {
    const p = nextPrescription([[s(60, 5), s(60, 4), s(60, 4)]], RANGE);
    expect(p).toEqual({ kind: 'hold', reason: 'missed_range', weight_kg: 60, reps: 6 });
  });

  it('blames effort, not load, when the sets stopped well short of failure', () => {
    // Four reps but four left in the tank. The weight is not the problem and dropping it
    // would solve the wrong thing.
    const p = nextPrescription([[s(60, 4, 4), s(60, 4, 4)]], RANGE);
    expect(p.kind).toBe('hold');
    expect(p.reason).toBe('left_reps_in_reserve');
  });

  it('does not blame effort when the sets were taken close to failure', () => {
    const p = nextPrescription([[s(60, 4, 1), s(60, 4, 0)]], RANGE);
    expect(p.reason).toBe('missed_range');
  });

  it('rounds the new load to a whole increment', () => {
    const p = nextPrescription([[s(61, 8), s(61, 8)]], { ...RANGE, increment_kg: 2.5 });
    // 61 + 2.5 is 63.5, which no pair of plates makes; 62.5 does.
    expect(p.weight_kg).toBe(62.5);
  });

  it('honours a smaller increment where the gym has one', () => {
    const p = nextPrescription([[s(20, 8), s(20, 8)]], { ...RANGE, increment_kg: 1 });
    expect(p.weight_kg).toBe(21);
  });

  it('uses the default increment when none is given', () => {
    const p = nextPrescription([[s(60, 8), s(60, 8)]], RANGE);
    expect(p.weight_kg).toBe(60 + DEFAULT_INCREMENT_KG);
  });
});

describe('bodyweight work', () => {
  const BW = { load_type: 'bodyweight_reps', rep_low: 6, rep_high: 10 } as const;

  it('keeps adding reps when the range is cleared, because there is no bar to load', () => {
    const p = nextPrescription([[body(10), body(10), body(10)]], BW);
    expect(p).toEqual({ kind: 'add_reps', reason: 'cleared_range', reps: 11 });
    expect(p.weight_kg).toBeUndefined();
  });

  it('still works inside the range', () => {
    const p = nextPrescription([[body(8), body(7), body(7)]], BW);
    expect(p.kind).toBe('add_reps');
    expect(p.reps).toBe(8);
  });
});

describe('what it refuses to advise on', () => {
  it('has nothing to say about a plank', () => {
    const p = nextPrescription([[{ kind: 'normal', done: true, seconds: 60 }]], {
      load_type: 'time',
      rep_low: 6,
      rep_high: 8,
    });
    expect(p).toEqual({ kind: 'no_advice', reason: 'not_a_lift' });
  });

  it('has nothing to say without a rep range', () => {
    expect(nextPrescription([[s(60, 8)]], { load_type: 'weight_reps' })).toEqual({
      kind: 'no_advice',
      reason: 'no_rep_range',
    });
  });

  it('has nothing to say about a range that runs backwards', () => {
    const p = nextPrescription([[s(60, 8)]], {
      load_type: 'weight_reps',
      rep_low: 10,
      rep_high: 6,
    });
    expect(p.reason).toBe('no_rep_range');
  });
});

describe('stalling', () => {
  const stuck = [s(100, 6), s(100, 6), s(100, 5)];

  it('backs the load off after enough sessions at the same weight', () => {
    const p = nextPrescription(Array(STALL_SESSIONS).fill(stuck), RANGE);
    expect(p.kind).toBe('deload');
    expect(p.reason).toBe('stalled');
    expect(p.from_weight_kg).toBe(100);
    // ten per cent off, rounded to a load that exists
    expect(p.weight_kg).toBe(90);
    expect(p.reps).toBe(6);
    expect(p.stalled_sessions).toBe(STALL_SESSIONS);
  });

  it('does not back off one session early', () => {
    const p = nextPrescription(Array(STALL_SESSIONS - 1).fill(stuck), RANGE);
    expect(p.kind).not.toBe('deload');
  });

  it('counts only the unbroken run at that load', () => {
    // Stuck twice, but before that the lift was moving, so it is not stuck yet.
    const p = nextPrescription([stuck, stuck, [s(95, 8), s(95, 8), s(95, 8)]], RANGE);
    expect(p.kind).not.toBe('deload');
  });

  it('is not stalled if the range was cleared in that run', () => {
    const clearedOnce = [s(100, 8), s(100, 8), s(100, 8)];
    const p = nextPrescription([stuck, stuck, clearedOnce, stuck], RANGE);
    expect(p.kind).not.toBe('deload');
  });

  it('never deloads a session that cleared the range', () => {
    const clearedNow = [s(100, 8), s(100, 8), s(100, 8)];
    const p = nextPrescription([clearedNow, stuck, stuck, stuck], RANGE);
    expect(p.kind).toBe('add_load');
  });
});

describe('isStepUp', () => {
  it('is true only when more is being asked for', () => {
    expect(isStepUp({ kind: 'add_load', reason: 'cleared_range' })).toBe(true);
    expect(isStepUp({ kind: 'add_reps', reason: 'inside_range' })).toBe(true);
    expect(isStepUp({ kind: 'hold', reason: 'missed_range' })).toBe(false);
    expect(isStepUp({ kind: 'deload', reason: 'stalled' })).toBe(false);
    expect(isStepUp({ kind: 'first_time', reason: 'no_history' })).toBe(false);
  });
});

describe('performances', () => {
  const sess = (id: string, started_at: string, sets: WorkoutSet[], ended = true) => ({
    id,
    user_id: 'u',
    created_at: started_at,
    updated_at: started_at,
    started_at,
    ...(ended ? { ended_at: started_at } : {}),
    name: 'x',
    entries: [{ exercise_id: 'bench', name: 'bench', load_type: 'weight_reps' as const, sets }],
  });

  it('returns one entry per session, newest first', () => {
    const got = performances(
      [
        sess('a', '2026-10-01T10:00:00.000Z', [s(60, 8)]),
        sess('c', '2026-10-15T10:00:00.000Z', [s(70, 8)]),
        sess('b', '2026-10-08T10:00:00.000Z', [s(65, 8)]),
      ],
      'bench',
    );
    expect(got.map((p) => p[0]?.weight_kg)).toEqual([70, 65, 60]);
  });

  it('skips the session being logged, and any still running', () => {
    const got = performances(
      [
        sess('live', '2026-10-16T10:00:00.000Z', [s(80, 8)], false),
        sess('now', '2026-10-15T10:00:00.000Z', [s(75, 8)]),
        sess('past', '2026-10-08T10:00:00.000Z', [s(65, 8)]),
      ],
      'bench',
      'now',
    );
    expect(got.map((p) => p[0]?.weight_kg)).toEqual([65]);
  });

  it('skips sessions where the exercise did no working sets', () => {
    const warm: WorkoutSet[] = [{ kind: 'warmup', done: true, weight_kg: 40, reps: 10 }];
    const got = performances(
      [
        sess('a', '2026-10-08T10:00:00.000Z', warm),
        sess('b', '2026-10-01T10:00:00.000Z', [s(60, 8)]),
      ],
      'bench',
    );
    expect(got).toHaveLength(1);
  });

  it('ignores other exercises entirely', () => {
    expect(performances([sess('a', '2026-10-08T10:00:00.000Z', [s(60, 8)])], 'squat')).toEqual([]);
  });
});

describe('suggestedSet', () => {
  it('offers the prescribed load and reps', () => {
    const p = nextPrescription([[s(60, 8), s(60, 8)]], RANGE);
    expect(suggestedSet(p)).toEqual({ weight_kg: 62.5, reps: 6 });
  });

  it('offers reps alone for bodyweight work', () => {
    const p = nextPrescription([[body(10), body(10)]], {
      load_type: 'bodyweight_reps',
      rep_low: 6,
      rep_high: 10,
    });
    expect(suggestedSet(p)).toEqual({ reps: 11 });
  });

  it('offers nothing the first time, so the cells stay empty', () => {
    expect(suggestedSet({ kind: 'first_time', reason: 'no_history' })).toBeUndefined();
  });

  it('offers nothing where there is no advice to give', () => {
    expect(suggestedSet({ kind: 'no_advice', reason: 'not_a_lift' })).toBeUndefined();
  });
});

describe('a worked progression, session by session', () => {
  it('climbs the range, then the load, then starts the range again', () => {
    const opts = { ...RANGE };
    const history: WorkoutSet[][] = [];

    // Six reps on everything: inside the range, so one more rep.
    history.unshift([s(60, 6), s(60, 6), s(60, 6)]);
    let p = nextPrescription(history, opts);
    expect([p.kind, p.weight_kg, p.reps]).toEqual(['add_reps', 60, 7]);

    history.unshift([s(60, 7), s(60, 7), s(60, 7)]);
    p = nextPrescription(history, opts);
    expect([p.kind, p.weight_kg, p.reps]).toEqual(['add_reps', 60, 8]);

    // Top of the range on every set: the load goes up and the reps go back to the bottom.
    history.unshift([s(60, 8), s(60, 8), s(60, 8)]);
    p = nextPrescription(history, opts);
    expect([p.kind, p.weight_kg, p.reps]).toEqual(['add_load', 62.5, 6]);

    history.unshift([s(62.5, 6), s(62.5, 6), s(62.5, 6)]);
    p = nextPrescription(history, opts);
    expect([p.kind, p.weight_kg, p.reps]).toEqual(['add_reps', 62.5, 7]);
  });
});
