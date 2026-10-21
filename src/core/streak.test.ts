import { describe, expect, it } from 'vitest';
import type { EasyWeek } from './block';
import { addDays, fromDateKey, toDateKey } from './dates';
import {
  describeRun,
  inferAim,
  missedDays,
  mondayOf,
  monthOfWeek,
  runsByWeek,
  skipsLine,
  skipsReturn,
  SKIPS_PER_MONTH,
  skipsCovered,
  trainedDays,
  trainingStreak,
  weekLine,
  type StreakWeek,
  type WeeklyAim,
} from './streak';
import type { WorkoutSession, WorkoutSet } from './types';

const work: WorkoutSet = { kind: 'normal', done: true, weight_kg: 60, reps: 8 };

/** A session at 18:00 local on `day`, so the local date key is `day` in any zone. */
function session(
  day: string,
  o: { ended?: boolean; deleted?: boolean; sets?: WorkoutSet[]; hour?: number } = {},
): WorkoutSession {
  const at = fromDateKey(day);
  at.setHours(o.hour ?? 18);
  const iso = at.toISOString();
  return {
    id: `${day}-${o.hour ?? 18}-${Math.random()}`,
    user_id: 'local',
    created_at: iso,
    updated_at: iso,
    started_at: iso,
    ...(o.ended === false ? {} : { ended_at: iso }),
    ...(o.deleted ? { deleted_at: iso } : {}),
    name: 'Day',
    entries: [
      { exercise_id: 'bench', name: 'Bench', load_type: 'weight_reps', sets: o.sets ?? [work] },
    ],
  };
}

/**
 * Sessions from a week-by-week pattern: `plan[k]` lists weekday offsets (0 = Monday) trained in
 * the k-th week from `monday`.
 */
function weeks(monday: string, plan: number[][]): WorkoutSession[] {
  return plan.flatMap((days, k) => days.map((d) => session(addDays(monday, 7 * k + d))));
}

// 2026: Monday 5 Oct; Wednesday 21 Oct is "today" unless a test says otherwise.
const OCT5 = '2026-10-05';
const TODAY = '2026-10-21';
const aim = (sessions: number | null, from = '2000-01-03'): WeeklyAim => ({ from, sessions });

describe('weeks and months', () => {
  it('puts every day in the week that began on the Monday before or on it', () => {
    for (let i = 0; i < 7; i++) expect(mondayOf(addDays(OCT5, i))).toBe(OCT5);
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
    // Sunday belongs to the week that began six days earlier, across a year end too.
    expect(mondayOf('2027-01-03')).toBe('2026-12-28');
    expect(mondayOf('2024-03-03')).toBe('2024-02-26');
  });

  it('charges a week to the month holding its Thursday', () => {
    expect(monthOfWeek('2026-09-28')).toBe('2026-10'); // Thu 1 Oct
    expect(monthOfWeek('2026-10-26')).toBe('2026-10'); // Thu 29 Oct, though it ends in November
    expect(monthOfWeek('2025-12-29')).toBe('2026-01'); // Thu 1 Jan, across a year
    expect(monthOfWeek('2026-08-31')).toBe('2026-09'); // Thu 3 Sep
    expect(monthOfWeek('2026-09-21')).toBe('2026-09');
  });

  it('knows when the skips come back', () => {
    expect(skipsReturn('2026-10')).toBe('2026-11-01');
    expect(skipsReturn('2026-12')).toBe('2027-01-01');
    expect(skipsReturn('2028-02')).toBe('2028-03-01');
  });
});

describe('trainedDays', () => {
  it('counts a day once, however many sessions it had', () => {
    const d = trainedDays([session(OCT5, { hour: 7 }), session(OCT5, { hour: 19 })]);
    expect([...d]).toEqual([OCT5]);
  });

  it('ignores sessions still running, deleted, or with no work in them', () => {
    const d = trainedDays([
      session('2026-10-06', { ended: false }),
      session('2026-10-07', { deleted: true }),
      session('2026-10-08', { sets: [{ ...work, kind: 'warmup' }] }),
      session('2026-10-09', { sets: [{ ...work, done: false }] }),
      session('2026-10-10', { sets: [] }),
      { ...session('2026-10-11'), started_at: 'not a date' },
      session('2026-10-12'),
    ]);
    expect([...d]).toEqual(['2026-10-12']);
  });

  it('counts timed and distance work as work', () => {
    const hold = session('2026-10-06', { sets: [{ kind: 'normal', done: true, seconds: 60 }] });
    expect(trainedDays([hold]).size).toBe(1);
  });
});

describe('inferAim', () => {
  const daysOf = (s: WorkoutSession[]) => trainedDays(s);

  it('needs two closed weeks before it reads a pattern', () => {
    const d = daysOf(weeks(OCT5, [[0, 2, 4]]));
    expect(inferAim(OCT5, d, OCT5)).toBeUndefined();
    expect(inferAim('2026-10-12', d, OCT5)).toBeUndefined();
    expect(
      inferAim(
        '2026-10-19',
        daysOf(
          weeks(OCT5, [
            [0, 2, 4],
            [0, 2, 4],
          ]),
        ),
        OCT5,
      ),
    ).toBe(3);
  });

  it('takes the lower median, so one holiday week does not lower the bar', () => {
    const d = daysOf(weeks(OCT5, [[0, 2, 4], [], [0, 2, 4], [0, 2, 4]]));
    expect(inferAim(addDays(OCT5, 28), d, OCT5)).toBe(3);
    // Two of four weeks light: the lower middle is taken, the kinder error.
    const e = daysOf(weeks(OCT5, [[0], [0, 2, 4], [0], [0, 2, 4]]));
    expect(inferAim(addDays(OCT5, 28), e, OCT5)).toBe(1);
  });

  it('does not let one double week raise it', () => {
    const d = daysOf(
      weeks(OCT5, [
        [0, 2],
        [0, 1, 2, 3, 4, 5],
        [0, 2],
        [0, 2],
      ]),
    );
    expect(inferAim(addDays(OCT5, 28), d, OCT5)).toBe(2);
  });

  it('never reads weeks before the first one trained', () => {
    const d = daysOf(
      weeks(OCT5, [
        [0, 2, 4],
        [0, 2, 4],
      ]),
    );
    expect(inferAim(addDays(OCT5, 14), d, OCT5)).toBe(3);
    // If it did, the empty weeks before the start would drag the median to one.
    expect(inferAim(addDays(OCT5, 14), d, addDays(OCT5, -28))).toBe(1);
  });

  it('looks back only four weeks', () => {
    const d = daysOf(weeks(OCT5, [[0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0], [0], [0], [0]]));
    expect(inferAim(addDays(OCT5, 42), d, OCT5)).toBe(1);
  });

  it('is at least one, even after a month of nothing', () => {
    const d = daysOf(weeks(OCT5, [[0], [], [], [], []]));
    expect(inferAim(addDays(OCT5, 35), d, OCT5)).toBe(1);
  });
});

describe('trainingStreak — the basics', () => {
  it('is empty with nothing logged, and asks for one day', () => {
    const s = trainingStreak([], TODAY);
    expect(s.current).toEqual({ weeks: 0, days: 0 });
    expect(s.best.weeks).toBe(0);
    expect(s.history).toHaveLength(1);
    expect(s.this_week).toMatchObject({ monday: '2026-10-19', days: 0, aim: 1, status: 'open' });
    expect(s.this_week.aim_source).toBe('default');
    expect(s.skips).toEqual({ month: '2026-10', used: 0, left: 3, allowed: 3 });
  });

  it('starts a run the first week, on one session', () => {
    const s = trainingStreak([session('2026-10-20')], TODAY);
    expect(s.current).toEqual({ weeks: 1, from: '2026-10-19', days: 1 });
    expect(s.this_week.status).toBe('met');
  });

  it('reads the aim from what you have been doing', () => {
    const s = trainingStreak(
      weeks(OCT5, [
        [0, 2, 4],
        [0, 2, 4],
      ]),
      TODAY,
    );
    expect(s.this_week).toMatchObject({ aim: 3, aim_source: 'inferred', days: 0, status: 'open' });
    expect(s.current).toEqual({ weeks: 2, from: OCT5, days: 6 });
  });

  it('never judges the week you are in until it is over', () => {
    // Sunday evening with nothing done this week: still open, the run still stands.
    const s = trainingStreak(
      weeks(OCT5, [
        [0, 2, 4],
        [0, 2, 4],
      ]),
      '2026-10-25',
    );
    expect(s.this_week.status).toBe('open');
    expect(s.current.weeks).toBe(2);
    expect(s.skips.used).toBe(0);
  });

  it('adds this week to the run as soon as it is met', () => {
    const s = trainingStreak(
      weeks(OCT5, [
        [0, 2, 4],
        [0, 2, 4],
        [0, 1, 2],
      ]),
      TODAY,
    );
    expect(s.this_week.status).toBe('met');
    expect(s.current).toEqual({ weeks: 3, from: OCT5, days: 9 });
  });

  it('counts days, not weekdays: any days you like', () => {
    const s = trainingStreak(
      weeks(OCT5, [
        [0, 2],
        [1, 5],
      ]),
      TODAY,
      { aims: [aim(2)] },
    );
    expect(s.history.map((w) => w.status)).toEqual(['met', 'met', 'open']);
  });

  it('counts two sessions on one day as one day', () => {
    const two = [session(OCT5, { hour: 7 }), session(OCT5, { hour: 19 })];
    const s = trainingStreak(two, '2026-10-14', { aims: [aim(2)] });
    expect(s.history[0]).toMatchObject({ days: 1, short: 1, status: 'forgiven' });
  });

  it('ignores sessions dated after today', () => {
    const s = trainingStreak([session('2026-10-20'), session('2026-11-30')], TODAY);
    expect(s.history.at(-1)!.monday).toBe('2026-10-19');
    expect(s.current.weeks).toBe(1);
  });

  it('ignores deleted, running and empty sessions', () => {
    const s = trainingStreak(
      [
        session('2026-10-20', { deleted: true }),
        session('2026-10-20', { ended: false }),
        session('2026-10-20', { sets: [] }),
      ],
      TODAY,
    );
    expect(s.current.weeks).toBe(0);
    expect(s.history).toHaveLength(1);
  });

  it('records the last training day of each week', () => {
    const s = trainingStreak(weeks(OCT5, [[0, 3]]), TODAY);
    expect(s.history[0]!.last_day).toBe('2026-10-08');
    expect(s.history[1]!.last_day).toBeUndefined();
  });
});

describe('trainingStreak — skips', () => {
  it('forgives a short week and keeps the run going', () => {
    const s = trainingStreak(
      weeks(OCT5, [
        [0, 2, 4],
        [0, 2],
      ]),
      TODAY,
      { aims: [aim(3)] },
    );
    expect(s.history[1]).toMatchObject({ short: 1, status: 'forgiven' });
    expect(s.current.weeks).toBe(2);
    expect(s.skips).toMatchObject({ used: 1, left: 2 });
  });

  it('forgives up to three missed days a month, and the fourth ends the run', () => {
    // Four weeks charged to October, each one day short of three.
    const plan = [
      [0, 2],
      [0, 2],
      [0, 2],
      [0, 2],
    ];
    const s = trainingStreak(weeks('2026-09-28', plan), '2026-10-28', { aims: [aim(3)] });
    expect(s.history.map((w) => w.status)).toEqual([
      'forgiven',
      'forgiven',
      'forgiven',
      'missed',
      'open',
    ]);
    expect(s.current.weeks).toBe(0);
    expect(s.best).toEqual({ weeks: 3, from: '2026-09-28', days: 6 });
    expect(s.skips).toEqual({ month: '2026-10', used: 3, left: 0, allowed: 3 });
  });

  it('gives three new skips each month, by the Thursday rule', () => {
    // Weeks of 21 Sep (Sept), 28 Sep (Oct: Thu 1 Oct), 5 Oct (Oct).
    const plan = [[0], [0], [0, 2]];
    const s = trainingStreak(weeks('2026-09-21', plan), '2026-10-14', { aims: [aim(3)] });
    expect(s.history.map((w) => [w.month, w.short, w.status])).toEqual([
      ['2026-09', 2, 'forgiven'],
      ['2026-10', 2, 'forgiven'],
      ['2026-10', 1, 'forgiven'],
      ['2026-10', 0, 'open'],
    ]);
    expect(s.current.weeks).toBe(3);
    expect(s.skips).toMatchObject({ used: 3, left: 0 });
  });

  it('charges a whole week off like any other shortfall', () => {
    const at3 = trainingStreak(weeks(OCT5, [[0, 2, 4], []]), TODAY, { aims: [aim(3)] });
    expect(at3.history[1]).toMatchObject({ short: 3, status: 'forgiven' });
    // At four a week, a week off is more than a month forgives: the run ends.
    const at4 = trainingStreak(weeks(OCT5, [[0, 1, 2, 4], []]), TODAY, { aims: [aim(4)] });
    expect(at4.history[1]).toMatchObject({ short: 4, status: 'missed' });
    expect(at4.current.weeks).toBe(0);
    expect(at4.best.weeks).toBe(1);
  });

  it('can be made strict with no skips', () => {
    const s = trainingStreak(weeks(OCT5, [[0, 2], [0]]), TODAY, {
      aims: [aim(2)],
      skipsPerMonth: 0,
    });
    expect(s.history[1]!.status).toBe('missed');
    expect(s.skips).toEqual({ month: '2026-10', used: 0, left: 0, allowed: 0 });
  });

  it('never shows more skips used than allowed', () => {
    const s = trainingStreak(weeks(OCT5, [[0, 1, 2, 3], [], []]), '2026-10-28', {
      aims: [aim(4)],
    });
    expect(s.skips.used).toBe(3);
    expect(s.skips.left).toBe(0);
  });

  it('starts a new run on the first week trained after one ends', () => {
    const plan = [[0, 1, 2, 3], [], [], [0, 1, 2, 3]];
    const s = trainingStreak(weeks('2026-10-19', plan), '2026-11-15', { aims: [aim(4)] });
    expect(s.history.map((w) => w.status)).toEqual(['met', 'missed', 'missed', 'met']);
    expect(s.current).toEqual({ weeks: 1, from: '2026-11-09', days: 4 });
    // A tie with an older run keeps the one still going.
    expect(s.best.from).toBe('2026-11-09');
  });

  it('drops a forgiven empty week from the front of a run', () => {
    const plan = [[0, 2], [], [0, 2]];
    const s = trainingStreak(weeks('2026-09-21', plan), '2026-10-14', {
      aims: [aim(2), aim(5, '2026-09-21'), aim(2, '2026-09-28')],
    });
    // Week one: 2 of 5, three short, all of September's skips. Then fine.
    expect(s.history[0]).toMatchObject({ aim: 5, short: 3, status: 'forgiven' });
    expect(s.history[1]).toMatchObject({ aim: 2, short: 2, status: 'forgiven', days: 0 });
    expect(s.current).toEqual({ weeks: 3, from: '2026-09-21', days: 4 });
  });
});

describe('trainingStreak — easier weeks', () => {
  const easy = (from: string): EasyWeek => ({ from, to: addDays(from, 6) });

  it('never lets an easier week break the run, and charges no skips for it', () => {
    const s = trainingStreak(weeks(OCT5, [[0, 2, 4], [0]]), TODAY, {
      aims: [aim(3)],
      easyWeeks: [easy('2026-10-12')],
    });
    expect(s.history[1]).toMatchObject({ status: 'easy', short: 0 });
    expect(s.current.weeks).toBe(2);
    expect(s.skips.used).toBe(0);
  });

  it('covers both calendar weeks an easier week straddles', () => {
    // Thursday to Wednesday.
    const s = trainingStreak(weeks(OCT5, [[0], [1]]), TODAY, {
      aims: [aim(3)],
      easyWeeks: [easy('2026-10-08')],
    });
    expect(s.history.slice(0, 2).map((w) => w.status)).toEqual(['easy', 'easy']);
  });

  it('calls an easier week that met the aim met', () => {
    const s = trainingStreak(
      weeks(OCT5, [
        [0, 2, 4],
        [0, 2, 4],
      ]),
      TODAY,
      {
        aims: [aim(3)],
        easyWeeks: [easy('2026-10-12')],
      },
    );
    expect(s.history[1]!.status).toBe('met');
  });

  it('counts an easier week with no training in a run, but does not start one with it', () => {
    const inside = trainingStreak(weeks(OCT5, [[0, 2], [], [0, 2]]), '2026-10-28', {
      aims: [aim(2)],
      easyWeeks: [easy('2026-10-12')],
    });
    expect(inside.current).toEqual({ weeks: 3, from: OCT5, days: 4 });
    const front = trainingStreak(weeks('2026-10-12', [[], [0, 2]]), '2026-10-28', {
      aims: [aim(2)],
      easyWeeks: [easy('2026-10-12')],
    });
    // The empty easy week precedes the first session, so history starts after it anyway.
    expect(front.current.from).toBe('2026-10-19');
  });

  it('does not excuse a gap that was not declared', () => {
    const s = trainingStreak(weeks(OCT5, [[0, 2, 4], [], []]), '2026-10-28', {
      aims: [aim(3)],
    });
    expect(s.history.slice(1, 3).map((w) => w.status)).toEqual(['forgiven', 'missed']);
  });
});

describe('trainingStreak — the aim you set', () => {
  it('applies from its week on and never rewrites the weeks before it', () => {
    const plan = [
      [0, 2],
      [0, 2],
      [0, 2],
    ];
    const before = trainingStreak(weeks(OCT5, plan), '2026-10-28', { aims: [aim(2)] });
    const after = trainingStreak(weeks(OCT5, plan), '2026-10-28', {
      aims: [aim(2), aim(4, '2026-10-19')],
    });
    expect(after.history.slice(0, 2)).toEqual(before.history.slice(0, 2));
    expect(after.history[2]).toMatchObject({ aim: 4, aim_source: 'set', short: 2 });
  });

  it('hands back to the pattern with null', () => {
    const s = trainingStreak(
      weeks(OCT5, [
        [0, 2, 4],
        [0, 2, 4],
        [0, 2, 4],
      ]),
      '2026-10-28',
      {
        aims: [aim(5), aim(null, '2026-10-19')],
      },
    );
    expect(s.history[1]).toMatchObject({ aim: 5, aim_source: 'set' });
    expect(s.history[2]).toMatchObject({ aim: 3, aim_source: 'inferred' });
  });

  it('keeps the aim between one and seven', () => {
    const lo = trainingStreak([session('2026-10-20')], TODAY, { aims: [aim(0)] });
    expect(lo.this_week.aim).toBe(1);
    const hi = trainingStreak([session('2026-10-20')], TODAY, { aims: [aim(12)] });
    expect(hi.this_week.aim).toBe(7);
  });

  it('uses the latest aim that has started, whatever order they are stored in', () => {
    const s = trainingStreak([session('2026-10-20')], TODAY, {
      aims: [aim(4, '2026-10-19'), aim(2, '2026-10-05'), aim(6, '2026-11-02')],
    });
    expect(s.this_week.aim).toBe(4);
  });
});

describe('trainingStreak — the best run', () => {
  it('remembers the longest run after it ends', () => {
    // Three weeks, a forgiven week off (October's first two skips), a second that is not.
    const plan = [[0, 2], [0, 2], [0, 2], [], [], [0, 2]];
    const s = trainingStreak(weeks('2026-09-07', plan), TODAY, { aims: [aim(2)] });
    expect(s.history.map((w) => w.status)).toEqual([
      'met',
      'met',
      'met',
      'forgiven',
      'missed',
      'met',
      'open',
    ]);
    expect(s.current).toEqual({ weeks: 1, from: '2026-10-12', days: 2 });
    expect(s.best).toEqual({ weeks: 4, from: '2026-09-07', days: 6 });
  });

  it('keeps a run alive through a month of single forgiven gaps', () => {
    // One a week, four empty weeks: September forgives one, October three of three.
    const plan = [[0], [0], [0], [], [], [], [], [0]];
    const s = trainingStreak(weeks('2026-08-31', plan), TODAY, { aims: [aim(1)] });
    expect(s.history.filter((w) => w.status === 'forgiven')).toHaveLength(4);
    expect(s.current.weeks).toBe(8);
  });

  it('never shrinks as the days go by', () => {
    const sessions = weeks('2026-06-01', [
      [0, 2, 4],
      [0, 2],
      [0, 2, 4],
      [],
      [],
      [0, 2, 4],
      [0],
      [0, 2, 4],
      [],
      [0, 2, 4],
    ]);
    let best = 0;
    let prev = 0;
    for (let d = '2026-06-01'; d <= '2026-09-30'; d = addDays(d, 1)) {
      const s = trainingStreak(sessions, d);
      expect(s.best.weeks).toBeGreaterThanOrEqual(prev);
      expect(s.best.weeks).toBeGreaterThanOrEqual(s.current.weeks);
      prev = s.best.weeks;
      best = Math.max(best, s.current.weeks);
    }
    expect(prev).toBe(best);
  });

  it('runsByWeek carries the run through the open week', () => {
    const s = trainingStreak(weeks(OCT5, [[0], [0]]), TODAY);
    const runs = runsByWeek(s.history);
    expect(runs.map((r) => r.weeks)).toEqual([1, 2, 2]);
  });
});

describe('trainingStreak — long histories and odd inputs', () => {
  it('handles ten years of three days a week quickly and exactly', () => {
    const start = '2016-10-24'; // a Monday
    const plan = Array.from({ length: 522 }, () => [0, 2, 4]);
    const sessions = weeks(start, plan);
    const today = addDays(start, 522 * 7 - 1); // the Sunday ending the last week
    const t0 = performance.now();
    const s = trainingStreak(sessions, today);
    const ms = performance.now() - t0;
    expect(s.history).toHaveLength(522);
    expect(s.current.weeks).toBe(522);
    expect(s.best.weeks).toBe(522);
    expect(s.current.days).toBe(522 * 3);
    expect(ms).toBeLessThan(2000);
  });

  it('accepts sessions in any order', () => {
    const sessions = weeks(OCT5, [
      [0, 2, 4],
      [0, 2, 4],
    ]);
    const a = trainingStreak(sessions, TODAY);
    const b = trainingStreak([...sessions].reverse(), TODAY);
    expect(b).toEqual(a);
  });

  it('spans a year end', () => {
    const s = trainingStreak(weeks('2026-12-21', [[0], [0], [0]]), '2027-01-06');
    expect(s.history.map((w) => w.monday)).toEqual(['2026-12-21', '2026-12-28', '2027-01-04']);
    expect(s.history[1]!.month).toBe('2026-12'); // Thu 31 Dec
    expect(s.current.weeks).toBe(3);
  });

  it('keeps weeks whole across the clock changes', () => {
    // Europe's: 29 Mar and 25 Oct 2026; the US's: 8 Mar and 1 Nov. Late-night Sunday sessions
    // still belong to the week that is ending.
    const sessions = [
      session('2026-03-29', { hour: 23 }),
      session('2026-03-08', { hour: 23 }),
      session('2026-10-25', { hour: 23 }),
      session('2026-11-01', { hour: 23 }),
    ];
    const days = [...trainedDays(sessions)].sort();
    expect(days).toEqual(['2026-03-08', '2026-03-29', '2026-10-25', '2026-11-01']);
    expect(days.map(mondayOf)).toEqual(['2026-03-02', '2026-03-23', '2026-10-19', '2026-10-26']);
    const s = trainingStreak(weeks('2026-10-19', [[6], [6]]), '2026-11-02');
    expect(s.history.map((w) => w.days)).toEqual([1, 1, 0]);
    expect(s.history.map((w) => w.monday)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
  });

  it('builds a history with one week per seven days, whatever the zone', () => {
    const s = trainingStreak(weeks('2026-03-02', [[0]]), '2026-11-04');
    for (let i = 1; i < s.history.length; i++) {
      const a = s.history[i - 1]!.monday;
      const b = s.history[i]!.monday;
      expect(addDays(a, 7)).toBe(b);
      expect(fromDateKey(b).getDay()).toBe(1);
    }
    expect(toDateKey(fromDateKey(s.history.at(-1)!.monday))).toBe('2026-11-02');
  });
});

describe('missedDays', () => {
  it('sums the shortfall in the weeks touching a range', () => {
    const s = trainingStreak(weeks(OCT5, [[0, 2], [0], []]), '2026-10-28', { aims: [aim(3)] });
    const h: StreakWeek[] = s.history;
    expect(h.map((w) => w.short)).toEqual([1, 2, 3, 0]);
    expect(missedDays(h, OCT5, '2026-10-11')).toBe(1);
    expect(missedDays(h, '2026-10-12', '2026-10-18')).toBe(2);
    expect(missedDays(h, '2026-10-07', '2026-10-20')).toBe(6);
    expect(missedDays(h, OCT5, '2026-10-28')).toBe(6);
  });

  it('owes nothing for an easier week', () => {
    const s = trainingStreak(weeks(OCT5, [[0, 2, 4], []]), TODAY, {
      aims: [aim(3)],
      easyWeeks: [{ from: '2026-10-12', to: '2026-10-18' }],
    });
    expect(missedDays(s.history, OCT5, TODAY)).toBe(0);
  });
});

describe('skipsCovered', () => {
  it('covers each shortfall from what the month has left, in order', () => {
    // Aim 3: two short (covered), two short (one covered), three short (none), and the week of
    // Thursday 29 Oct is still October's.
    const s = trainingStreak(weeks(OCT5, [[0], [0], [], [], []]), '2026-11-04', {
      aims: [aim(3)],
    });
    const covered = skipsCovered(s.history);
    expect(s.history.map((w) => [w.monday, w.short, w.status])).toEqual([
      ['2026-10-05', 2, 'forgiven'],
      ['2026-10-12', 2, 'missed'],
      ['2026-10-19', 3, 'missed'],
      ['2026-10-26', 3, 'missed'],
      ['2026-11-02', 0, 'open'],
    ]);
    expect([...covered]).toEqual([
      ['2026-10-05', 2],
      ['2026-10-12', 1],
      ['2026-10-19', 0],
      ['2026-10-26', 0],
    ]);
  });

  it('agrees with the streak: a week covered whole is exactly a forgiven one', () => {
    const plans: number[][][] = [
      [[0], [], [0, 1], [], [0, 1, 2], []],
      [[], [], [], [0, 1, 2, 3]],
      [[0, 1, 2], [0], [0, 1], [0, 1, 2]],
    ];
    for (const plan of plans) {
      for (const n of [1, 2, 3, 4]) {
        const s = trainingStreak(weeks('2026-09-07', plan), '2026-12-02', { aims: [aim(n)] });
        const covered = skipsCovered(s.history);
        for (const w of s.history) {
          if (w.short === 0) {
            expect(covered.has(w.monday)).toBe(false);
            continue;
          }
          const c = covered.get(w.monday)!;
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(w.short);
          expect(c === w.short).toBe(w.status === 'forgiven');
        }
      }
    }
  });

  it('never covers more than the allowance in a month', () => {
    const s = trainingStreak(weeks('2026-09-28', [[0], [], [], [], []]), '2026-11-04', {
      aims: [aim(4)],
    });
    const byMonth = new Map<string, number>();
    for (const w of s.history) {
      byMonth.set(
        w.month,
        (byMonth.get(w.month) ?? 0) + (skipsCovered(s.history).get(w.monday) ?? 0),
      );
    }
    for (const total of byMonth.values()) expect(total).toBeLessThanOrEqual(SKIPS_PER_MONTH);
  });

  it('takes another allowance, and none at all', () => {
    const s = trainingStreak(weeks(OCT5, [[0], [0]]), TODAY, { aims: [aim(3)] });
    expect([...skipsCovered(s.history, 5)]).toEqual([
      ['2026-10-05', 2],
      ['2026-10-12', 2],
    ]);
    expect([...skipsCovered(s.history, 0)]).toEqual([
      ['2026-10-05', 0],
      ['2026-10-12', 0],
    ]);
  });

  it('leaves easier weeks out: they owe nothing to cover', () => {
    const s = trainingStreak(weeks(OCT5, [[0, 2, 4], [], [0]]), '2026-10-28', {
      aims: [aim(3)],
      easyWeeks: [{ from: '2026-10-12', to: '2026-10-18' }],
    });
    expect([...skipsCovered(s.history)]).toEqual([['2026-10-19', 2]]);
  });
});

describe('words', () => {
  it('says what this week still needs, and nothing about a run ending', () => {
    expect(weekLine({ days: 0, aim: 3 })).toBe('3 more days this week to make it count');
    expect(weekLine({ days: 2, aim: 3 })).toBe('1 more day this week to make it count');
    expect(weekLine({ days: 3, aim: 3 })).toBe('This week counts');
    expect(weekLine({ days: 5, aim: 3 })).toBe('This week counts');
  });

  it('says weeks in the singular when there is one', () => {
    expect(describeRun(1)).toBe('1 week');
    expect(describeRun(0)).toBe('0 weeks');
    expect(describeRun(12)).toBe('12 weeks');
  });

  it('says how many skips are left, or when they come back', () => {
    const m = '2026-10';
    expect(skipsLine({ month: m, used: 1, left: 2, allowed: 3 }, 'en-GB')).toBe(
      '2 of 3 skips left in October',
    );
    expect(skipsLine({ month: m, used: 3, left: 0, allowed: 3 }, 'en-GB')).toBe(
      'Skips back on 1 Nov',
    );
    expect(skipsLine({ month: '2026-12', used: 3, left: 0, allowed: 3 }, 'en-GB')).toBe(
      'Skips back on 1 Jan',
    );
    expect(skipsLine({ month: m, used: 0, left: 1, allowed: 1 }, 'en-GB')).toBe(
      '1 of 1 skip left in October',
    );
    expect(skipsLine({ month: m, used: 0, left: 0, allowed: 0 }, 'en-GB')).toBe('No skips');
  });

  it('allows three skips a month by default', () => {
    expect(SKIPS_PER_MONTH).toBe(3);
  });
});
