import { describe, expect, it } from 'vitest';
import {
  BLOCK_WEEKS,
  blockState,
  easySets,
  easyWeekFrom,
  endEasyWeek,
  isEasyDay,
  liftSignals,
  withoutEasy,
  type BlockInputs,
  type EasyWeek,
  type LiftSignals,
} from './block';
import { addDays } from './dates';
import { easyPrescription } from './progression';
import type { LoadType, WorkoutSession, WorkoutSet } from './types';

const set = (weight_kg: number | undefined, reps: number): WorkoutSet => ({
  kind: 'normal',
  done: true,
  reps,
  ...(weight_kg != null ? { weight_kg } : {}),
});

function session(
  day: string,
  lifts: { id: string; name?: string; sets: WorkoutSet[]; load_type?: LoadType }[],
  ended = true,
): WorkoutSession {
  // Midday UTC keeps the local date key the same wherever the tests run.
  const at = `${day}T12:00:00.000Z`;
  return {
    id: `${day}-${lifts.map((l) => l.id).join()}`,
    user_id: 'local',
    created_at: at,
    updated_at: at,
    started_at: at,
    ...(ended ? { ended_at: at } : {}),
    name: 'Day',
    entries: lifts.map((l) => ({
      exercise_id: l.id,
      name: l.name ?? l.id,
      load_type: l.load_type ?? 'weight_reps',
      sets: l.sets,
    })),
  };
}

const NO_SIGNALS: LiftSignals = { stalled: [], slipping: [] };
const TODAY = '2026-10-20';

function state(o: Partial<BlockInputs> & { firstDay?: string }) {
  const first = o.firstDay ?? addDays(TODAY, -120);
  return blockState({
    sessions: o.sessions ?? [session(first, [{ id: 'bench', sets: [set(80, 8)] }])],
    easyWeeks: o.easyWeeks ?? [],
    signals: o.signals ?? NO_SIGNALS,
    today: o.today ?? TODAY,
    ...(o.resetOn ? { resetOn: o.resetOn } : {}),
  });
}

describe('blockState', () => {
  it('says nothing without a finished session', () => {
    expect(state({ sessions: [] })).toEqual({ kind: 'none' });
    expect(state({ sessions: [session(TODAY, [{ id: 'b', sets: [] }], false)] })).toEqual({
      kind: 'none',
    });
  });

  it('counts weeks from the first session and offers the easier week when the block is due', () => {
    // 120 days in: week 18 of an unbroken run, well past a beginner and past due.
    const s = state({});
    expect(s).toMatchObject({ kind: 'block', beginner: false, offer: { reason: 'scheduled' } });
  });

  it('schedules nothing for a beginner, however long the block', () => {
    const s = state({ firstDay: addDays(TODAY, -(BLOCK_WEEKS * 7 + 3)) });
    expect(s).toMatchObject({ kind: 'block', week: BLOCK_WEEKS + 1, beginner: true });
    expect(s).not.toHaveProperty('offer');
  });

  it('ends beginner status at the first stall', () => {
    const s = state({
      firstDay: addDays(TODAY, -(BLOCK_WEEKS * 7)),
      signals: { stalled: ['Squat'], slipping: [] },
    });
    expect(s).toMatchObject({ beginner: false, offer: { reason: 'scheduled' } });
  });

  it('restarts the count the day after an easier week, and offers again only when due', () => {
    const easy: EasyWeek = { from: addDays(TODAY, -20), to: addDays(TODAY, -14) };
    const s = state({ easyWeeks: [easy] });
    expect(s).toMatchObject({ kind: 'block', week: 2 });
    expect(s).not.toHaveProperty('offer');
  });

  it('counts a week or more off as a break, restarting the block after it', () => {
    const b = (d: number) => session(addDays(TODAY, d), [{ id: 'bench', sets: [set(80, 8)] }]);
    // Eight days between sessions is seven clear days off: the block starts again at -10.
    const s = state({ sessions: [b(-120), b(-60), b(-18), b(-10), b(-3)] });
    expect(s).toMatchObject({ kind: 'block', week: 2, beginner: false });
    expect(s).not.toHaveProperty('offer');
    // Seven days apart is a weekly routine, not a break.
    // Thirteen weeks of them: past a beginner, in week 14 of one unbroken block.
    const weekly = Array.from({ length: 14 }, (_, k) => b(-7 * k));
    expect(state({ sessions: weekly })).toMatchObject({ week: 14, offer: { reason: 'scheduled' } });
  });

  it('is the easier week while one is running', () => {
    const w = easyWeekFrom(addDays(TODAY, -2));
    expect(state({ easyWeeks: [w] })).toEqual({ kind: 'easy', week: w });
  });

  it('treats "not now" as a fresh block, not a snooze', () => {
    const s = state({ resetOn: addDays(TODAY, -3) });
    expect(s).toMatchObject({ week: 1 });
    expect(s).not.toHaveProperty('offer');
    expect(state({ resetOn: addDays(TODAY, -(BLOCK_WEEKS * 7)) })).toMatchObject({
      offer: { reason: 'scheduled' },
    });
  });

  it('brings the offer forward on two stalled or slipping lifts, but not in the first fortnight', () => {
    const two = { stalled: ['Bench', 'Squat'], slipping: [] };
    expect(state({ resetOn: addDays(TODAY, -15), signals: two })).toMatchObject({
      week: 3,
      offer: { reason: 'stalled', lifts: ['Bench', 'Squat'] },
    });
    expect(state({ resetOn: addDays(TODAY, -10), signals: two })).not.toHaveProperty('offer');
    expect(
      state({ resetOn: addDays(TODAY, -15), signals: { stalled: ['Bench'], slipping: [] } }),
    ).not.toHaveProperty('offer');
    expect(
      state({ resetOn: addDays(TODAY, -15), signals: { stalled: [], slipping: ['Row', 'Dip'] } }),
    ).toMatchObject({ offer: { reason: 'slipping' } });
  });

  it('lets signals reach a beginner, who is never otherwise offered one', () => {
    const s = state({
      firstDay: addDays(TODAY, -30),
      signals: { stalled: [], slipping: ['Row', 'Dip'] },
    });
    expect(s).toMatchObject({ beginner: true, offer: { reason: 'slipping' } });
  });
});

describe('liftSignals', () => {
  const ranges = new Map([
    ['bench', { rep_low: 6, rep_high: 10 }],
    ['squat', { rep_low: 6, rep_high: 10 }],
  ]);

  it('finds a lift stalled by its own rule', () => {
    const days = [-14, -10, -6].map((d) => addDays(TODAY, d));
    const sessions = days.map((d) =>
      session(d, [{ id: 'bench', name: 'Bench', sets: [set(80, 7), set(80, 6)] }]),
    );
    expect(liftSignals(sessions, ranges, TODAY)).toEqual({ stalled: ['Bench'], slipping: [] });
  });

  it('finds a lift that lost two reps at the same weight', () => {
    const sessions = [
      session(addDays(TODAY, -7), [
        { id: 'squat', name: 'Squat', sets: [set(100, 9), set(100, 8)] },
      ]),
      session(addDays(TODAY, -3), [
        { id: 'squat', name: 'Squat', sets: [set(100, 7), set(100, 6)] },
      ]),
    ];
    expect(liftSignals(sessions, ranges, TODAY).slipping).toEqual(['Squat']);
  });

  it('does not call a heavier day slipping, nor a one-rep dip', () => {
    const heavier = [
      session(addDays(TODAY, -7), [{ id: 'squat', sets: [set(100, 9)] }]),
      session(addDays(TODAY, -3), [{ id: 'squat', sets: [set(105, 6)] }]),
    ];
    expect(liftSignals(heavier, ranges, TODAY).slipping).toEqual([]);
    const dip = [
      session(addDays(TODAY, -7), [{ id: 'squat', sets: [set(100, 9)] }]),
      session(addDays(TODAY, -3), [{ id: 'squat', sets: [set(100, 8)] }]),
    ];
    expect(liftSignals(dip, ranges, TODAY).slipping).toEqual([]);
  });

  it('ignores a lift not trained in three weeks', () => {
    const sessions = [
      session(addDays(TODAY, -40), [{ id: 'squat', sets: [set(100, 9)] }]),
      session(addDays(TODAY, -30), [{ id: 'squat', sets: [set(100, 5)] }]),
    ];
    expect(liftSignals(sessions, ranges, TODAY)).toEqual({ stalled: [], slipping: [] });
  });

  it('has nothing to say about holds', () => {
    const plank = (d: number, s: number) =>
      session(addDays(TODAY, d), [
        { id: 'plank', load_type: 'time', sets: [{ kind: 'normal', done: true, seconds: s }] },
      ]);
    expect(liftSignals([plank(-7, 60), plank(-3, 30)], ranges, TODAY)).toEqual({
      stalled: [],
      slipping: [],
    });
  });
});

describe('easier-week bookkeeping', () => {
  const week: EasyWeek = { from: '2026-10-13', to: '2026-10-19' };

  it('knows which days are inside one', () => {
    expect(isEasyDay('2026-10-13', [week])).toBe(true);
    expect(isEasyDay('2026-10-19', [week])).toBe(true);
    expect(isEasyDay('2026-10-20', [week])).toBe(false);
  });

  it('removes its sessions from what progression sees', () => {
    const inside = session('2026-10-15', [{ id: 'bench', sets: [set(80, 6)] }]);
    const outside = session('2026-10-08', [{ id: 'bench', sets: [set(80, 10)] }]);
    expect(withoutEasy([inside, outside], [week])).toEqual([outside]);
  });

  it('halves sets, rounding up, never to none', () => {
    expect([1, 2, 3, 4, 5].map(easySets)).toEqual([1, 1, 2, 2, 3]);
  });

  it('ends a running week as of yesterday, and drops one begun today', () => {
    expect(endEasyWeek([week], '2026-10-16')).toEqual([{ from: '2026-10-13', to: '2026-10-15' }]);
    expect(endEasyWeek([week], '2026-10-13')).toEqual([]);
    expect(endEasyWeek([week], '2026-10-25')).toEqual([week]);
  });

  it('runs seven days', () => {
    expect(easyWeekFrom('2026-10-20')).toEqual({ from: '2026-10-20', to: '2026-10-26' });
  });
});

describe('easyPrescription', () => {
  it('keeps last time’s working weight and asks for the bottom of the range', () => {
    expect(
      easyPrescription([[set(80, 9), set(80, 8), set(60, 12)]], {
        load_type: 'weight_reps',
        rep_low: 6,
        rep_high: 10,
      }),
    ).toEqual({ kind: 'easy', reason: 'easy_week', weight_kg: 80, reps: 6 });
  });

  it('without a range, asks for the fewest reps of last time', () => {
    expect(
      easyPrescription([[set(80, 9), set(80, 7)]], { load_type: 'weight_reps' }),
    ).toMatchObject({ weight_kg: 80, reps: 7 });
  });

  it('has no bar for bodyweight work, and no advice for holds or first times', () => {
    expect(
      easyPrescription([[set(undefined, 15)]], { load_type: 'bodyweight_reps', rep_low: 12 }),
    ).toEqual({ kind: 'easy', reason: 'easy_week', reps: 12 });
    expect(easyPrescription([], { load_type: 'weight_reps', rep_low: 6 }).kind).toBe('first_time');
    expect(easyPrescription([[set(0, 0)]], { load_type: 'time' }).kind).toBe('no_advice');
  });
});
