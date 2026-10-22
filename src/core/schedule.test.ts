import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import {
  addSlot,
  alternatingCycle,
  cleanCycle,
  cleanPlan,
  cycleFrequency,
  describePlan,
  describeWeekdays,
  effectiveCycle,
  EMPTY_PLAN,
  flexiblePlan,
  isDefaultCycle,
  missedMove,
  mondayOfKey,
  moveSlot,
  projectSchedule,
  removeSlot,
  splitKind,
  storeCycle,
  toggleWeekday,
  upcomingSlots,
  type ScheduleDay,
  type SplitKind,
} from './schedule';
import type { WorkoutSession } from './types';

const meta = { user_id: 'local', created_at: '', updated_at: '' };

/** A finished session at noon local, so no zone moves it across midnight. */
const done = (day: string, routine_id?: string, extra: Partial<WorkoutSession> = {}) =>
  ({
    ...meta,
    id: `${day}-${routine_id ?? 'empty'}-${extra.id ?? ''}`,
    started_at: new Date(`${day}T12:00:00`).toISOString(),
    ended_at: new Date(`${day}T13:00:00`).toISOString(),
    ...(routine_id ? { routine_id } : {}),
    name: routine_id ?? 'Workout',
    entries: [],
    ...extra,
  }) as WorkoutSession;

const MON = 1;
const TUE = 2;
const WED = 3;
const THU = 4;
const FRI = 5;
const SAT = 6;
const SUN = 0;

// 19 Oct 2026 is a Monday. The clocks go back in Europe on Sunday 25 Oct.
const MONDAY = '2026-10-19';
const PPL = ['CT', 'BB', 'LG', 'ST', 'BB', 'LG'];

const names = (days: ScheduleDay[]) =>
  days.map((d) => `${d.date.slice(5)} ${d.state}${d.slot ? ` ${d.slot.routine_id}` : ''}`);

describe('the plan', () => {
  it('cleans what sync hands it', () => {
    expect(cleanPlan(undefined)).toEqual(EMPTY_PLAN);
    expect(cleanPlan('3')).toEqual(EMPTY_PLAN);
    expect(cleanPlan({ weekdays: [5, 1, 3, 3, 9, -1, 2.5, 'x'] })).toEqual({
      weekdays: [1, 3, 5],
      per_week: 3,
    });
    // Fixed days decide the count, whatever count came with them.
    expect(cleanPlan({ weekdays: [1, 3], per_week: 5 })).toEqual({ weekdays: [1, 3], per_week: 2 });
    expect(cleanPlan({ weekdays: [], per_week: 3 })).toEqual({ weekdays: [], per_week: 3 });
    expect(cleanPlan({ per_week: 12 })).toEqual({ weekdays: [], per_week: 7 });
    expect(cleanPlan({ per_week: 0 })).toEqual({ weekdays: [], per_week: 1 });
    expect(cleanPlan({ per_week: Number.NaN })).toEqual(EMPTY_PLAN);
    expect(cleanPlan({ per_week: null })).toEqual(EMPTY_PLAN);
  });

  it('lists Sunday last, as every week in the app does', () => {
    expect(cleanPlan({ weekdays: [SUN, MON, SAT] }).weekdays).toEqual([MON, SAT, SUN]);
  });

  it('toggles days on and off, and clearing the last one hands it back to Auto', () => {
    let p = toggleWeekday(EMPTY_PLAN, WED);
    expect(p).toEqual({ weekdays: [WED], per_week: 1 });
    p = toggleWeekday(p, MON);
    p = toggleWeekday(p, FRI);
    expect(p).toEqual({ weekdays: [MON, WED, FRI], per_week: 3 });
    p = toggleWeekday(p, WED);
    expect(p).toEqual({ weekdays: [MON, FRI], per_week: 2 });
    p = toggleWeekday(toggleWeekday(p, MON), FRI);
    expect(p).toEqual(EMPTY_PLAN);
  });

  it('toggling a day on a flexible plan fixes the days', () => {
    expect(toggleWeekday(flexiblePlan(4), TUE)).toEqual({ weekdays: [TUE], per_week: 1 });
  });

  it('a flexible plan is a count from 1 to 7, or Auto', () => {
    expect(flexiblePlan(3)).toEqual({ weekdays: [], per_week: 3 });
    expect(flexiblePlan(9)).toEqual({ weekdays: [], per_week: 7 });
    expect(flexiblePlan(0)).toEqual({ weekdays: [], per_week: 1 });
    expect(flexiblePlan(null)).toEqual(EMPTY_PLAN);
  });

  it('describes itself in words', () => {
    expect(describeWeekdays([FRI, MON, WED])).toBe('Mon, Wed and Fri');
    expect(describeWeekdays([TUE])).toBe('Tue');
    expect(describeWeekdays([])).toBe('');
    expect(describeWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(describePlan({ weekdays: [MON, THU], per_week: 2 })).toBe('Mon and Thu');
    expect(describePlan(flexiblePlan(3))).toBe('3 a week, any days');
    expect(describePlan(EMPTY_PLAN)).toBe('Auto');
  });
});

describe('the cycle', () => {
  const R = (...ids: string[]) => ids.map((id) => ({ id }));

  it('is the list in order until edited', () => {
    expect(effectiveCycle(undefined, R('A', 'B', 'C'))).toEqual(['A', 'B', 'C']);
    expect(effectiveCycle({ slots: [], known: [] }, R('A', 'B'))).toEqual(['A', 'B']);
    expect(effectiveCycle(undefined, [])).toEqual([]);
  });

  it('keeps a routine twice when it was put in twice', () => {
    const stored = storeCycle(PPL, R('CT', 'BB', 'LG', 'ST'));
    expect(effectiveCycle(stored, R('CT', 'BB', 'LG', 'ST'))).toEqual(PPL);
  });

  it('drops a routine that was deleted, everywhere it appeared', () => {
    const stored = storeCycle(PPL, R('CT', 'BB', 'LG', 'ST'));
    expect(effectiveCycle(stored, R('CT', 'LG', 'ST'))).toEqual(['CT', 'LG', 'ST', 'LG']);
  });

  it('adds a routine created since at the end', () => {
    const stored = storeCycle(['B', 'A'], R('A', 'B'));
    expect(effectiveCycle(stored, R('A', 'B', 'C'))).toEqual(['B', 'A', 'C']);
  });

  it('leaves out a routine taken out on purpose', () => {
    // ARMS existed when the cycle was edited without it: it is an occasional day, not a slot.
    const stored = storeCycle(['A', 'B'], R('A', 'B', 'ARMS'));
    expect(effectiveCycle(stored, R('A', 'B', 'ARMS'))).toEqual(['A', 'B']);
  });

  it('falls back to the list when every slot is gone', () => {
    const stored = storeCycle(['A'], R('A', 'B'));
    expect(effectiveCycle(stored, R('B'))).toEqual(['B']);
  });

  it('a routine renamed keeps its slot: slots are ids', () => {
    const stored = storeCycle(['A', 'B'], R('A', 'B'));
    expect(effectiveCycle(stored, R('A', 'B'))).toEqual(['A', 'B']);
  });

  it('follows a reorder of the list only while it has never been edited', () => {
    expect(effectiveCycle(undefined, R('B', 'A'))).toEqual(['B', 'A']);
    const stored = storeCycle(['A', 'B'], R('A', 'B'));
    expect(effectiveCycle(stored, R('B', 'A'))).toEqual(['A', 'B']);
  });

  it('stores only routines that exist', () => {
    expect(storeCycle(['A', 'GONE', 'A'], R('A', 'B'))).toEqual({
      slots: ['A', 'A'],
      known: ['A', 'B'],
    });
  });

  it('cleans what sync hands it', () => {
    expect(cleanCycle(null)).toBeUndefined();
    expect(cleanCycle({ slots: 'A' })).toBeUndefined();
    expect(cleanCycle({ slots: ['A', 3, '', 'B'], known: ['A', 'A', null] })).toEqual({
      slots: ['A', 'B'],
      known: ['A'],
    });
    expect(cleanCycle({ slots: ['A'] })).toEqual({ slots: ['A'], known: [] });
  });

  it('knows the default when it sees it', () => {
    expect(isDefaultCycle(['A', 'B'], R('A', 'B'))).toBe(true);
    expect(isDefaultCycle(['B', 'A'], R('A', 'B'))).toBe(false);
    expect(isDefaultCycle(['A', 'B', 'A'], R('A', 'B'))).toBe(false);
  });

  it('moves, removes and adds slots without mutating', () => {
    const s = ['A', 'B', 'C'];
    expect(moveSlot(s, 0, 2)).toEqual(['B', 'C', 'A']);
    expect(moveSlot(s, 2, 0)).toEqual(['C', 'A', 'B']);
    expect(moveSlot(s, 1, 1)).toEqual(s);
    expect(moveSlot(s, -1, 1)).toEqual(s);
    expect(moveSlot(s, 0, 3)).toEqual(s);
    expect(removeSlot(s, 1)).toEqual(['A', 'C']);
    expect(removeSlot(['A'], 0)).toEqual(['A']);
    expect(removeSlot(s, 7)).toEqual(s);
    expect(addSlot(s, 'B')).toEqual(['A', 'B', 'C', 'B']);
    expect(s).toEqual(['A', 'B', 'C']);
  });
});

describe('what kind of day a routine is', () => {
  const primary: Record<string, string> = {
    bench: 'chest',
    ohp: 'shoulders',
    pushdown: 'triceps',
    row: 'upper back',
    pulldown: 'lats',
    curl: 'biceps',
    squat: 'quads',
    rdl: 'hamstrings',
    calf: 'calves',
    crunch: 'abs',
    run: 'cardio',
  };
  const of = (id: string) => primary[id];
  const it3 = (...ids: string[]) => ids.map((exercise_id) => ({ exercise_id, sets: 3 }));

  it('reads push, pull and legs from where the sets go', () => {
    expect(splitKind(it3('bench', 'ohp', 'pushdown'), of)).toBe('push');
    expect(splitKind(it3('row', 'pulldown', 'curl'), of)).toBe('pull');
    expect(splitKind(it3('squat', 'rdl', 'calf'), of)).toBe('legs');
    expect(splitKind(it3('crunch'), of)).toBe('core');
  });

  it('a push day with one curl is still a push day', () => {
    expect(splitKind(it3('bench', 'ohp', 'pushdown', 'curl'), of)).toBe('push');
  });

  it('push and pull together is upper; with legs it is full body', () => {
    expect(splitKind(it3('bench', 'row', 'ohp', 'pulldown'), of)).toBe('upper');
    expect(splitKind(it3('bench', 'row', 'squat', 'rdl'), of)).toBe('full');
  });

  it('weighs by sets, not by exercises', () => {
    const items = [
      { exercise_id: 'squat', sets: 8 },
      { exercise_id: 'bench', sets: 2 },
    ];
    expect(splitKind(items, of)).toBe('legs');
  });

  it('is other when nothing is known', () => {
    expect(splitKind([], of)).toBe('other');
    expect(splitKind(it3('mystery'), of)).toBe('other');
    expect(splitKind(it3('run'), of)).toBe('other');
    expect(splitKind([{ exercise_id: 'bench', sets: 0 }], of)).toBe('other');
  });
});

describe('alternating variants', () => {
  const kinds = (m: Record<string, SplitKind>) => (id: string) => m[id] ?? 'other';
  const R = (...ids: string[]) => ids.map((id) => ({ id }));

  it("turns the user's four routines into the six-day lap they meant", () => {
    const k = kinds({ CT: 'push', BB: 'pull', LG: 'legs', ST: 'push' });
    expect(alternatingCycle(R('CT', 'BB', 'LG', 'ST'), k)).toEqual(PPL);
  });

  it('alternates upper and lower variants too', () => {
    const k = kinds({ UA: 'upper', LA: 'legs', UB: 'upper', LB: 'legs' });
    // Two variants of each kind already alternate in list order: nothing to suggest.
    expect(alternatingCycle(R('UA', 'LA', 'UB', 'LB'), k)).toEqual(['UA', 'LA', 'UB', 'LB']);
  });

  it('suggests nothing when every kind has one routine', () => {
    const k = kinds({ P: 'push', L: 'pull', G: 'legs' });
    expect(alternatingCycle(R('P', 'L', 'G'), k)).toBeUndefined();
  });

  it('suggests nothing when a routine cannot be classified', () => {
    const k = kinds({ CT: 'push', BB: 'pull', LG: 'legs', X: 'other' });
    expect(alternatingCycle(R('CT', 'BB', 'LG', 'X'), k)).toBeUndefined();
  });

  it('suggests nothing when variants would not line up into whole laps', () => {
    const k = kinds({ P1: 'push', P2: 'push', P3: 'push', L1: 'pull', L2: 'pull', G: 'legs' });
    expect(alternatingCycle(R('P1', 'L1', 'G', 'P2', 'L2', 'P3'), k)).toBeUndefined();
  });

  it('suggests nothing for two routines or one kind', () => {
    expect(alternatingCycle(R('A', 'B'), kinds({ A: 'push', B: 'pull' }))).toBeUndefined();
    expect(
      alternatingCycle(R('A', 'B', 'C'), kinds({ A: 'full', B: 'full', C: 'full' })),
    ).toBeUndefined();
  });

  it('keeps the kinds in the order first listed', () => {
    const k = kinds({ LG: 'legs', CT: 'push', BB: 'pull', ST: 'push' });
    expect(alternatingCycle(R('LG', 'CT', 'BB', 'ST'), k)).toEqual([
      'LG',
      'CT',
      'BB',
      'LG',
      'ST',
      'BB',
    ]);
  });
});

describe('laying the cycle onto the week', () => {
  const MWF = [MON, WED, FRI];

  it("the user's example: Mon C&T, Wed B&B, Fri Legs, Mon S&T, Wed B&B, Fri Legs", () => {
    const days = projectSchedule({
      cycle: PPL,
      weekdays: MWF,
      sessions: [],
      from: MONDAY,
      days: 14,
      today: MONDAY,
    });
    expect(days.filter((d) => d.slot).map((d) => [d.date, d.slot!.routine_id])).toEqual([
      ['2026-10-19', 'CT'],
      ['2026-10-21', 'BB'],
      ['2026-10-23', 'LG'],
      ['2026-10-26', 'ST'],
      ['2026-10-28', 'BB'],
      ['2026-10-30', 'LG'],
    ]);
    expect(days[0]!.state).toBe('today');
    expect(days[1]!.state).toBe('rest');
    expect(days[2]!.state).toBe('planned');
  });

  it('and it keeps going the same way as the weeks are trained', () => {
    // The first week done exactly as planned: the second is as the user described it.
    const sessions = [done('2026-10-19', 'CT'), done('2026-10-21', 'BB'), done('2026-10-23', 'LG')];
    const today = '2026-10-26';
    const days = projectSchedule({
      cycle: PPL,
      weekdays: MWF,
      sessions,
      from: today,
      days: 14,
      today,
    });
    expect(days.filter((d) => d.slot).map((d) => d.slot!.routine_id)).toEqual([
      'ST',
      'BB',
      'LG',
      'CT',
      'BB',
      'LG',
    ]);
  });

  it('a missed Monday moves Chest & Tri to Wednesday, and says so', () => {
    const today = '2026-10-21';
    const days = projectSchedule({
      cycle: PPL,
      weekdays: MWF,
      sessions: [],
      from: MONDAY,
      days: 7,
      today,
    });
    expect(names(days)).toEqual([
      '10-19 missed',
      '10-20 rest',
      '10-21 today CT',
      '10-22 rest',
      '10-23 planned BB',
      '10-24 rest',
      '10-25 rest',
    ]);
    expect(missedMove(days, today)).toEqual({
      missed: '2026-10-19',
      moved_to: '2026-10-21',
      routine_id: 'CT',
    });
  });

  it('a session on a day off counts where it happened and moves the cycle on', () => {
    // Trained Tuesday instead of Monday: Wednesday is Back & Bi, not Chest & Tri again.
    const today = '2026-10-21';
    const days = projectSchedule({
      cycle: PPL,
      weekdays: MWF,
      sessions: [done('2026-10-20', 'CT')],
      from: MONDAY,
      days: 7,
      today,
    });
    expect(names(days)).toEqual([
      '10-19 missed',
      '10-20 done',
      '10-21 today BB',
      '10-22 rest',
      '10-23 planned LG',
      '10-24 rest',
      '10-25 rest',
    ]);
    expect(days[1]!.done).toEqual([{ session_id: '2026-10-20-CT-', name: 'CT', routine_id: 'CT' }]);
    // Something was done since the missed day: nothing to explain.
    expect(missedMove(days, today)).toBeUndefined();
  });

  it('trained today, today shows what was done and the next slot goes to the next day', () => {
    const days = projectSchedule({
      cycle: PPL,
      weekdays: MWF,
      sessions: [done(MONDAY, 'CT')],
      from: MONDAY,
      days: 7,
      today: MONDAY,
    });
    expect(days[0]!.state).toBe('done');
    expect(days[0]!.slot).toBeUndefined();
    expect(days[2]!.slot?.routine_id).toBe('BB');
    expect(missedMove(days, MONDAY)).toBeUndefined();
  });

  it('two sessions on one day are both shown, oldest first', () => {
    const am = done(MONDAY, 'CT', { started_at: new Date(`${MONDAY}T07:00:00`).toISOString() });
    const pm = done(MONDAY, 'BB', { id: 'pm' });
    const days = projectSchedule({
      cycle: PPL,
      weekdays: MWF,
      sessions: [pm, am],
      from: MONDAY,
      days: 3,
      today: MONDAY,
    });
    expect(days[0]!.done.map((d) => d.routine_id)).toEqual(['CT', 'BB']);
    expect(days[2]!.slot?.routine_id).toBe('LG');
  });

  it('an empty workout shows as done without moving the cycle', () => {
    const days = projectSchedule({
      cycle: PPL,
      weekdays: MWF,
      sessions: [done(MONDAY)],
      from: MONDAY,
      days: 3,
      today: '2026-10-20',
    });
    expect(days[0]!.state).toBe('done');
    expect(days[2]!.slot?.routine_id).toBe('CT');
  });

  it('ignores sessions still running, deleted, or dated after today', () => {
    const running = { ...done(MONDAY, 'CT'), ended_at: undefined } as unknown as WorkoutSession;
    const deleted = done(MONDAY, 'CT', { id: 'd', deleted_at: '2026-10-19T14:00:00.000Z' });
    const future = done('2026-10-25', 'CT', { id: 'f' });
    const days = projectSchedule({
      cycle: PPL,
      weekdays: MWF,
      sessions: [running, deleted, future],
      from: MONDAY,
      days: 7,
      today: MONDAY,
    });
    expect(days[0]!.state).toBe('today');
    expect(days[0]!.slot?.routine_id).toBe('CT');
    expect(days[6]!.state).toBe('rest');
    expect(days[6]!.done).toEqual([]);
  });

  it('works across the clocks going back', () => {
    // Sunday 25 Oct is 25 hours long in Europe; Monday 26 must still be a Monday.
    const days = projectSchedule({
      cycle: ['A', 'B'],
      weekdays: [SAT, SUN, MON],
      sessions: [],
      from: '2026-10-24',
      days: 4,
      today: '2026-10-24',
    });
    expect(days.map((d) => [d.date, d.weekday, d.slot?.routine_id])).toEqual([
      ['2026-10-24', SAT, 'A'],
      ['2026-10-25', SUN, 'B'],
      ['2026-10-26', MON, 'A'],
      ['2026-10-27', TUE, undefined],
    ]);
  });

  it('every number of days from one to seven fills exactly those days', () => {
    const all = [MON, TUE, WED, THU, FRI, SAT, SUN];
    for (let n = 1; n <= 7; n++) {
      const weekdays = all.slice(0, n);
      const days = projectSchedule({
        cycle: ['A', 'B', 'C'],
        weekdays,
        sessions: [],
        from: MONDAY,
        days: 7,
        today: MONDAY,
      });
      expect(days.filter((d) => d.slot)).toHaveLength(n);
      expect(days.filter((d) => d.planned)).toHaveLength(n);
      // The slots run through the cycle in order, wrapping.
      expect(days.filter((d) => d.slot).map((d) => d.slot!.index)).toEqual(
        Array.from({ length: n }, (_, k) => k % 3),
      );
    }
  });

  it('no fixed days lays nothing onto a date', () => {
    const days = projectSchedule({
      cycle: PPL,
      weekdays: [],
      sessions: [done(MONDAY, 'CT')],
      from: MONDAY,
      days: 7,
      today: '2026-10-21',
    });
    expect(days.every((d) => !d.slot && !d.planned)).toBe(true);
    expect(days[0]!.state).toBe('done');
  });

  it('an empty cycle still marks the training days, with nothing on them', () => {
    const days = projectSchedule({
      cycle: [],
      weekdays: MWF,
      sessions: [],
      from: MONDAY,
      days: 7,
      today: MONDAY,
    });
    expect(days[0]).toMatchObject({ state: 'today', planned: true });
    expect(days[0]!.slot).toBeUndefined();
    expect(days[2]).toMatchObject({ state: 'planned' });
  });

  it('days asked for: zero gives nothing, a negative gives nothing', () => {
    const base = { cycle: PPL, weekdays: MWF, sessions: [], from: MONDAY, today: MONDAY };
    expect(projectSchedule({ ...base, days: 0 })).toEqual([]);
    expect(projectSchedule({ ...base, days: -3 })).toEqual([]);
  });

  it('edits to the cycle mid-week take effect from the next slot', () => {
    const sessions = [done(MONDAY, 'CT')];
    const before = projectSchedule({
      cycle: ['CT', 'BB', 'LG', 'ST'],
      weekdays: MWF,
      sessions,
      from: MONDAY,
      days: 14,
      today: '2026-10-20',
    });
    const after = projectSchedule({
      cycle: PPL,
      weekdays: MWF,
      sessions,
      from: MONDAY,
      days: 14,
      today: '2026-10-20',
    });
    const slots = (d: ScheduleDay[]) => d.filter((x) => x.slot).map((x) => x.slot!.routine_id);
    expect(slots(before)).toEqual(['BB', 'LG', 'ST', 'CT', 'BB']);
    expect(slots(after)).toEqual(['BB', 'LG', 'ST', 'BB', 'LG']);
    // Monday is history either way.
    expect(before[0]!.state).toBe('done');
    expect(after[0]!.state).toBe('done');
  });

  it('a routine deleted mid-week drops out of the days ahead', () => {
    const days = projectSchedule({
      cycle: effectiveCycle(
        storeCycle(PPL, [{ id: 'CT' }, { id: 'BB' }, { id: 'LG' }, { id: 'ST' }]),
        [{ id: 'CT' }, { id: 'LG' }, { id: 'ST' }],
      ),
      weekdays: MWF,
      sessions: [done(MONDAY, 'CT')],
      from: MONDAY,
      days: 14,
      today: '2026-10-20',
    });
    expect(days.filter((d) => d.slot).map((d) => d.slot!.routine_id)).toEqual([
      'LG',
      'ST',
      'LG',
      'CT',
      'LG',
    ]);
  });

  it('a long stretch missed still offers the next routine, not a backlog', () => {
    const today = '2026-11-16';
    const days = projectSchedule({
      cycle: PPL,
      weekdays: MWF,
      sessions: [done(MONDAY, 'CT')],
      from: mondayOfKey(today),
      days: 7,
      today,
    });
    expect(days[0]).toMatchObject({ state: 'today', slot: { routine_id: 'BB' } });
  });
});

describe('the next few, without fixed days', () => {
  it('lists what comes next from where the cycle has got to', () => {
    expect(upcomingSlots(PPL, [done(MONDAY, 'CT')], 3).map((s) => s.routine_id)).toEqual([
      'BB',
      'LG',
      'ST',
    ]);
    expect(upcomingSlots(PPL, [], 8).map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 0, 1]);
    expect(upcomingSlots([], [], 3)).toEqual([]);
    expect(upcomingSlots(PPL, [], 0)).toEqual([]);
  });
});

describe('missedMove', () => {
  const day = (date: string, state: ScheduleDay['state'], routine_id?: string): ScheduleDay => ({
    date,
    weekday: 0,
    planned: state !== 'rest',
    state,
    done: [],
    ...(routine_id ? { slot: { index: 0, routine_id } } : {}),
  });

  it('names the latest missed day and where its routine went', () => {
    const days = [
      day('2026-10-19', 'missed'),
      day('2026-10-20', 'rest'),
      day('2026-10-21', 'missed'),
      day('2026-10-22', 'rest'),
      day('2026-10-23', 'today', 'CT'),
    ];
    expect(missedMove(days, '2026-10-23')).toEqual({
      missed: '2026-10-21',
      moved_to: '2026-10-23',
      routine_id: 'CT',
    });
  });

  it('is silent with nothing missed, or nothing ahead to move to', () => {
    expect(
      missedMove([day('2026-10-19', 'done'), day('2026-10-21', 'today', 'BB')], '2026-10-21'),
    ).toBeUndefined();
    expect(
      missedMove([day('2026-10-19', 'missed'), day('2026-10-21', 'rest')], '2026-10-21'),
    ).toBeUndefined();
  });
});

describe('mondayOfKey', () => {
  it('finds the Monday of any day, Sunday included', () => {
    expect(mondayOfKey('2026-10-19')).toBe('2026-10-19');
    expect(mondayOfKey('2026-10-25')).toBe('2026-10-19');
    expect(mondayOfKey('2026-10-26')).toBe('2026-10-26');
    expect(mondayOfKey('2027-01-01')).toBe('2026-12-28');
    for (let k = 0; k < 400; k++) {
      const d = addDays('2026-01-01', k);
      const m = mondayOfKey(d);
      expect(new Date(`${m}T12:00:00`).getDay()).toBe(1);
      expect(d >= m && d <= addDays(m, 6)).toBe(true);
    }
  });
});

describe('cycleFrequency', () => {
  it('spreads the days over the slots', () => {
    const f = cycleFrequency(['a', 'b', 'c', 'd'], 3)!;
    expect([...f.values()]).toEqual([0.75, 0.75, 0.75, 0.75]);
  });

  it('counts a routine once per slot it holds: the alternating push week', () => {
    const f = cycleFrequency(['chest', 'pull', 'legs', 'shoulders', 'pull', 'legs'], 3)!;
    expect(f.get('pull')).toBe(1);
    expect(f.get('legs')).toBe(1);
    expect(f.get('chest')).toBe(0.5);
    expect(f.get('shoulders')).toBe(0.5);
  });

  it('keeps the week whole: the frequencies add up to the days trained', () => {
    for (const days of [1, 2, 3, 4, 5, 6, 7]) {
      const f = cycleFrequency(['a', 'b', 'a', 'c', 'd'], days)!;
      expect([...f.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(days, 10);
    }
  });

  it('says nothing without a number of days or a cycle', () => {
    expect(cycleFrequency(['a'], null)).toBeUndefined();
    expect(cycleFrequency(['a'], 0)).toBeUndefined();
    expect(cycleFrequency([], 3)).toBeUndefined();
  });
});
