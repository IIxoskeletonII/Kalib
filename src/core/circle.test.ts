import { describe, expect, it } from 'vitest';
import type { EasyWeek } from './block';
import { addDays } from './dates';
import { dotsCoefficient } from './dots';
import {
  BOARD_WEEKS,
  circleWeeks,
  consistencyScore,
  daysLeftInWeek,
  E1RM_CEILING_KG,
  expectedOutcome,
  firstJudgedWeek,
  hardRating,
  judgeWeeks,
  pastWeeks,
  plausibleCeiling,
  progressScore,
  rankBoard,
  rateWeek,
  RATING_K,
  RATING_START,
  screenLift,
  SKIPS_PER_MONTH,
  strengthChange,
  weekConsistency,
  weekScore,
  type BoardWeek,
  type CircleInputs,
  type JudgedWeek,
  type LiftReading,
} from './circle';
import { trainingStreak, type StreakWeek, type WeeklyAim } from './streak';
import type { WorkoutEntry, WorkoutSession, WorkoutSet } from './types';

const set = (o: Partial<WorkoutSet>): WorkoutSet => ({ kind: 'normal', done: true, ...o });

/** One finished session; `lifts` maps an exercise to the weight of a single rep. */
function session(
  day: string,
  lifts: Record<string, number> = { bench: 100 },
  o: { ended?: boolean; load_type?: WorkoutEntry['load_type']; sets?: WorkoutSet[] } = {},
): WorkoutSession {
  // Midday UTC, so the local date key is the same day in every timezone the tests run in.
  const at = `${day}T12:00:00.000Z`;
  return {
    id: `${day}-${Object.keys(lifts).join('-')}`,
    user_id: 'local',
    created_at: at,
    updated_at: at,
    started_at: at,
    ...(o.ended === false ? {} : { ended_at: at }),
    name: 'Day',
    entries: Object.entries(lifts).map(([id, kg]) => ({
      exercise_id: id,
      name: id,
      load_type: o.load_type ?? 'weight_reps',
      sets: o.sets ?? [set({ weight_kg: kg, reps: 1 })],
    })),
  };
}

const r = (date: string, value: number): LiftReading => ({ date, value });

/** An aim of `sessions` days a week, from long before any test's history. */
const aim = (sessions: number | null, from = '2000-01-03'): WeeklyAim => ({ from, sessions });

/** One session on each day, one lift each, all at the same weight. */
const days = (...d: string[]): WorkoutSession[] => d.map((x) => session(x));

/** The streak's weeks, which is what the circle counts from. */
function history(
  sessions: readonly WorkoutSession[],
  today: string,
  aims: readonly WeeklyAim[] = [aim(3)],
  easyWeeks: readonly EasyWeek[] = [],
): StreakWeek[] {
  return trainingStreak(sessions, today, { aims, easyWeeks }).history;
}

/** What `judgeWeeks` reports, as [week, planned, done, missed, skipped]. */
const judged = (j: readonly JudgedWeek[]) =>
  j.map((w) => [w.week, w.planned, w.done, w.missed, w.skipped]);

describe('weeks', () => {
  it('lists the whole weeks before this one, oldest first, as Mondays', () => {
    expect(pastWeeks('2026-10-21', 4)).toEqual([
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
    ]);
    // A Sunday is the end of its week, not the start of the next.
    expect(pastWeeks('2026-10-25', 1)).toEqual(['2026-10-12']);
    expect(pastWeeks('2026-10-26', 1)).toEqual(['2026-10-19']);
  });

  it('crosses a year end', () => {
    expect(pastWeeks('2027-01-01', 2)).toEqual(['2026-12-14', '2026-12-21']);
  });

  it('counts the days left in the week', () => {
    expect(daysLeftInWeek('2026-10-19')).toBe(6);
    expect(daysLeftInWeek('2026-10-21')).toBe(4);
    expect(daysLeftInWeek('2026-10-25')).toBe(0);
  });
});

describe('showing up', () => {
  it('counts training days exactly as the streak does', () => {
    const sessions = [
      session('2026-10-19'),
      session('2026-10-19', { squat: 120 }), // a second session the same day is the same day
      session('2026-10-20', { bench: 100 }, { ended: false }), // still running
      session(
        '2026-10-21',
        { bench: 100 },
        { sets: [set({ weight_kg: 60, reps: 5, kind: 'warmup' })] },
      ),
      session(
        '2026-10-22',
        { bench: 100 },
        { sets: [set({ weight_kg: 60, reps: 5, done: false })] },
      ),
      { ...session('2026-10-23'), deleted_at: '2026-10-23T13:00:00Z' },
      session('2026-10-24'),
    ];
    const today = '2026-10-25';
    const weeks = circleWeeks({ sessions, weighIns: [], aims: [aim(3)], today });
    expect(weeks.at(-1)).toMatchObject({ week: '2026-10-19', done: 2, planned: 3 });
    expect(weeks.at(-1)!.done).toBe(trainingStreak(sessions, today).this_week.days);
  });

  it('plans each week with the aim it had then: a change never rewrites the past', () => {
    const today = '2026-10-21';
    const sessions = days('2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19');
    const weeks = circleWeeks({
      sessions,
      weighIns: [],
      aims: [aim(2), aim(4, '2026-10-05')],
      today,
    });
    expect(weeks.map((w) => [w.week, w.planned, w.done])).toEqual([
      ['2026-09-21', 2, 1],
      ['2026-09-28', 2, 1],
      ['2026-10-05', 4, 1],
      ['2026-10-12', 4, 1],
      ['2026-10-19', 4, 1],
    ]);
    expect(weeks.map((w) => w.consistency)).toEqual([50, 50, 25, 25, 25]);
  });

  it('a change made this week applies to this week only', () => {
    const today = '2026-10-21';
    const sessions = days('2026-10-05', '2026-10-12', '2026-10-19');
    const before = circleWeeks({ sessions, weighIns: [], aims: [aim(2)], today });
    const after = circleWeeks({
      sessions,
      weighIns: [],
      aims: [aim(2), aim(5, '2026-10-19')],
      today,
    });
    expect(before.map((w) => w.planned)).toEqual([2, 2, 2]);
    expect(after.map((w) => w.planned)).toEqual([2, 2, 5]);
  });

  it('reads the aim from your weeks when you have not set one', () => {
    // Two days a week for four weeks: Auto makes that the aim from the third week on.
    const today = '2026-10-21';
    const sessions = days(
      '2026-09-21',
      '2026-09-23',
      '2026-09-28',
      '2026-09-30',
      '2026-10-05',
      '2026-10-07',
      '2026-10-12',
      '2026-10-14',
      '2026-10-19',
    );
    const weeks = circleWeeks({ sessions, weighIns: [], today });
    const streak = trainingStreak(sessions, today).history.slice(-5);
    expect(weeks.map((w) => w.planned)).toEqual(streak.map((w) => w.aim));
    expect(weeks.map((w) => w.planned)).toEqual([1, 1, 2, 2, 2]);
    expect(weeks.slice(0, 4).every((w) => w.consistency === 100)).toBe(true);
    expect(weeks.at(-1)!.consistency).toBe(50); // one of two so far
  });

  it('holds the aim to between one and seven, as the streak does', () => {
    const today = '2026-10-21';
    const sessions = days('2026-10-19');
    expect(circleWeeks({ sessions, weighIns: [], aims: [aim(9)], today }).at(-1)!.planned).toBe(7);
    expect(circleWeeks({ sessions, weighIns: [], aims: [aim(0)], today }).at(-1)!.planned).toBe(1);
  });

  it('scores the share of the plan met, and nothing extra for going over', () => {
    expect(consistencyScore({ planned: 3, done: 0 })).toBe(0);
    expect(consistencyScore({ planned: 3, done: 1 })).toBe(33);
    expect(consistencyScore({ planned: 3, done: 2 })).toBe(67);
    expect(consistencyScore({ planned: 3, done: 3 })).toBe(100);
    expect(consistencyScore({ planned: 3, done: 6 })).toBe(100);
    expect(consistencyScore({ planned: 0, done: 2 })).toBe(0);
  });

  it('scores an easier week short of the aim as kept, and every other week by the count', () => {
    expect(weekConsistency({ aim: 3, days: 1, status: 'easy' })).toBe(100);
    expect(weekConsistency({ aim: 3, days: 0, status: 'easy' })).toBe(100);
    expect(weekConsistency({ aim: 3, days: 1, status: 'forgiven' })).toBe(33);
    expect(weekConsistency({ aim: 3, days: 0, status: 'missed' })).toBe(0);
    expect(weekConsistency({ aim: 3, days: 3, status: 'met' })).toBe(100);
    expect(weekConsistency({ aim: 3, days: 1, status: 'open' })).toBe(33);
  });

  it('publishes an easier week with its real numbers and full marks for showing up', () => {
    const today = '2026-10-28';
    const sessions = days('2026-10-05', '2026-10-07', '2026-10-09', '2026-10-13');
    const weeks = circleWeeks({
      sessions,
      weighIns: [],
      aims: [aim(3)],
      easyWeeks: [{ from: '2026-10-12', to: '2026-10-18' }],
      today,
    });
    expect(weeks.find((w) => w.week === '2026-10-12')).toMatchObject({
      planned: 3,
      done: 1,
      consistency: 100,
    });
    // The week after is an ordinary week again, and empty.
    expect(weeks.find((w) => w.week === '2026-10-19')).toMatchObject({ done: 0, consistency: 0 });
  });
});

describe('screenLift', () => {
  it('accepts a steady climb', () => {
    const s = screenLift([r('2026-09-01', 100), r('2026-09-08', 102.5), r('2026-09-15', 105)]);
    expect(s.flagged).toEqual([]);
    expect(s.accepted).toHaveLength(3);
  });

  it('accepts a genuine beginner climbing a plate a week from light loads', () => {
    const climb = [40, 50, 60, 70, 80].map((v, i) => r(addDays('2026-09-01', i * 7), v));
    expect(screenLift(climb).flagged).toEqual([]);
  });

  it('allows up to 15% plus 7.5 kg above the best accepted before', () => {
    expect(plausibleCeiling(100)).toBeCloseTo(122.5, 10);
    expect(screenLift([r('2026-09-01', 100), r('2026-09-08', 122.5)]).flagged).toEqual([]);
    expect(screenLift([r('2026-09-01', 100), r('2026-09-08', 123)]).flagged).toEqual([
      r('2026-09-08', 123),
    ]);
  });

  it('holds back a slipped digit and carries on from the real best', () => {
    const s = screenLift([
      r('2026-09-01', 100),
      r('2026-09-08', 180), // 80 typed as 180
      r('2026-09-15', 102.5),
      r('2026-09-22', 105),
    ]);
    expect(s.flagged).toEqual([r('2026-09-08', 180)]);
    expect(s.accepted.map((x) => x.value)).toEqual([100, 102.5, 105]);
  });

  it('accepts a real step up once a second session confirms it', () => {
    const s = screenLift([r('2026-09-01', 100), r('2026-09-08', 130), r('2026-09-15', 128)]);
    expect(s.flagged).toEqual([]);
    expect(s.accepted.map((x) => x.value)).toEqual([100, 130, 128]);
  });

  it('does not let two different wild numbers confirm each other', () => {
    const s = screenLift([r('2026-09-01', 100), r('2026-09-08', 150), r('2026-09-15', 180)]);
    expect(s.flagged.map((x) => x.value)).toEqual([150, 180]);
  });

  it('a confirmed step becomes the bar for the next', () => {
    const s = screenLift([
      r('2026-09-01', 100),
      r('2026-09-08', 130),
      r('2026-09-15', 131),
      r('2026-09-22', 150), // within 130 × 1.15 + 7.5
    ]);
    expect(s.flagged).toEqual([]);
  });

  it('never believes a lift past the ceiling, even twice', () => {
    const s = screenLift([r('2026-09-01', 600), r('2026-09-08', 600)]);
    expect(s.accepted).toEqual([]);
    expect(s.flagged).toHaveLength(2);
    expect(screenLift([r('2026-09-01', E1RM_CEILING_KG)]).accepted).toHaveLength(1);
  });

  it('does not screen falls: a low number hurts only its owner', () => {
    const s = screenLift([r('2026-09-01', 100), r('2026-09-08', 10), r('2026-09-15', 100)]);
    expect(s.flagged).toEqual([]);
  });

  it('reads in date order whatever order it is given', () => {
    const s = screenLift([r('2026-09-15', 128), r('2026-09-01', 100), r('2026-09-08', 130)]);
    expect(s.flagged).toEqual([]);
    expect(s.accepted.map((x) => x.date)).toEqual(['2026-09-01', '2026-09-08', '2026-09-15']);
  });

  it('accepts the first reading of a lift as its own baseline', () => {
    expect(screenLift([r('2026-09-01', 220)]).accepted).toHaveLength(1);
  });

  it('flags nonsense values', () => {
    expect(screenLift([r('2026-09-01', 0), r('2026-09-02', Number.NaN)]).accepted).toEqual([]);
  });
});

describe('strengthChange', () => {
  const asOf = '2026-10-25';
  // The current window is 28 Sep – 25 Oct; the baseline 31 Aug – 27 Sep.
  const base = (lifts: Record<string, number>) => session('2026-09-10', lifts);
  const now = (lifts: Record<string, number>) => session('2026-10-10', lifts);

  it('is undefined with only one window of history', () => {
    expect(strengthChange({ sessions: [now({ bench: 100 })], weighIns: [] }, asOf)).toBeUndefined();
    expect(strengthChange({ sessions: [], weighIns: [] }, asOf)).toBeUndefined();
  });

  it('is zero on a plateau', () => {
    const c = strengthChange(
      { sessions: [base({ bench: 100 }), now({ bench: 100 })], weighIns: [] },
      asOf,
    )!;
    expect(c.change).toBe(0);
    expect(c.lifts).toBe(1);
    expect(c.normalised).toBe(false);
  });

  it('sums the lifts trained in both windows and ignores the rest', () => {
    const c = strengthChange(
      {
        sessions: [
          base({ bench: 100, squat: 140 }),
          now({ bench: 105, squat: 147, curl: 40 }), // curl is new this month
          session('2026-09-12', { row: 80 }), // row was dropped
        ],
        weighIns: [],
      },
      asOf,
    )!;
    expect(c.lifts).toBe(2);
    expect(c.change).toBeCloseTo(252 / 240 - 1, 10);
  });

  it('takes the best session in each window', () => {
    const c = strengthChange(
      {
        sessions: [
          session('2026-09-03', { bench: 95 }),
          session('2026-09-17', { bench: 100 }),
          session('2026-10-01', { bench: 98 }),
          session('2026-10-20', { bench: 102 }),
        ],
        weighIns: [],
      },
      asOf,
    )!;
    expect(c.change).toBeCloseTo(0.02, 10);
  });

  it('counts holding strength on a cut as the improvement it is', () => {
    const c = strengthChange(
      {
        sessions: [base({ bench: 100 }), now({ bench: 100 })],
        weighIns: [
          { date: '2026-09-27', weight_kg: 90 },
          { date: '2026-10-25', weight_kg: 86 },
        ],
        sex: 'male',
      },
      asOf,
    )!;
    expect(c.normalised).toBe(true);
    expect(c.change).toBeGreaterThan(0);
    expect(c.change).toBeCloseTo(
      dotsCoefficient('male', 86)! / dotsCoefficient('male', 90)! - 1,
      10,
    );
  });

  it('falls back to kilograms without a sex or without weigh-ins', () => {
    const sessions = [base({ bench: 100 }), now({ bench: 110 })];
    const weighIns = [{ date: '2026-09-01', weight_kg: 80 }];
    expect(strengthChange({ sessions, weighIns }, asOf)!.normalised).toBe(false);
    expect(strengthChange({ sessions, weighIns: [], sex: 'female' }, asOf)!.normalised).toBe(false);
    expect(strengthChange({ sessions, weighIns: [], sex: 'female' }, asOf)!.change).toBeCloseTo(
      0.1,
    );
  });

  it('leaves a flagged jump out of the comparison and counts it', () => {
    const c = strengthChange(
      {
        sessions: [
          base({ bench: 100 }),
          now({ bench: 200 }),
          session('2026-10-15', { bench: 101 }),
        ],
        weighIns: [],
      },
      asOf,
    )!;
    expect(c.flagged).toBe(1);
    expect(c.change).toBeCloseTo(0.01, 10);
  });

  it('leaves easier-week sessions out, since they are light on purpose', () => {
    const c = strengthChange(
      {
        sessions: [base({ bench: 100 }), session('2026-10-06', { bench: 80 })],
        weighIns: [],
        easyWeeks: [{ from: '2026-10-05', to: '2026-10-11' }],
      },
      asOf,
    );
    expect(c).toBeUndefined();
  });

  it('ignores reps-only and timed work, which have no common scale with a bar', () => {
    const c = strengthChange(
      {
        sessions: [
          session(
            '2026-09-10',
            { pushup: 0 },
            { load_type: 'bodyweight_reps', sets: [set({ reps: 10 })] },
          ),
          session(
            '2026-10-10',
            { pushup: 0 },
            { load_type: 'bodyweight_reps', sets: [set({ reps: 12 })] },
          ),
        ],
        weighIns: [],
      },
      asOf,
    );
    expect(c).toBeUndefined();
  });

  it('prices belted bodyweight work as lifter plus belt', () => {
    const belted = (day: string, belt: number) =>
      session(
        day,
        { dip: belt },
        { load_type: 'weighted_bodyweight', sets: [set({ weight_kg: belt, reps: 1 })] },
      );
    const c = strengthChange(
      {
        sessions: [belted('2026-09-10', 20), belted('2026-10-10', 30)],
        weighIns: [{ date: '2026-09-01', weight_kg: 80 }],
      },
      asOf,
    )!;
    expect(c.change).toBeCloseTo(110 / 100 - 1, 10);
  });

  it('only looks at what had happened by the date asked about', () => {
    const c = strengthChange(
      {
        sessions: [
          base({ bench: 100 }),
          now({ bench: 100 }),
          session('2026-10-30', { bench: 120 }),
        ],
        weighIns: [],
      },
      asOf,
    )!;
    expect(c.change).toBe(0);
  });
});

describe('scores', () => {
  it('maps progress so steady is 50 and a good month is full marks', () => {
    expect(progressScore(0)).toBe(50);
    expect(progressScore(0.025)).toBe(100);
    expect(progressScore(0.1)).toBe(100);
    expect(progressScore(-0.025)).toBe(0);
    expect(progressScore(-0.5)).toBe(0);
    expect(progressScore(0.01)).toBe(70);
    expect(progressScore(Number.NaN)).toBe(50);
  });

  it('weights showing up above progress', () => {
    expect(weekScore(100, 50)).toBe(80);
    expect(weekScore(50, 100)).toBe(70);
    expect(weekScore(0, 100)).toBe(40);
  });

  it('scores on consistency alone, not halved, when there is no progress figure', () => {
    expect(weekScore(100)).toBe(100);
    expect(weekScore(67)).toBe(67);
  });
});

describe('hard mode', () => {
  it('judges from the first Monday on or after switching on', () => {
    expect(firstJudgedWeek('2026-10-19')).toBe('2026-10-19');
    expect(firstJudgedWeek('2026-10-21')).toBe('2026-10-26');
    expect(firstJudgedWeek('2026-10-25')).toBe('2026-10-26');
  });

  it('forgives three days short a month and no more', () => {
    const today = '2026-10-28';
    const h = history(
      days(
        '2026-10-05',
        '2026-10-06',
        '2026-10-12',
        '2026-10-13',
        ...['19', '20', '21', '22'].map((d) => `2026-10-${d}`),
      ),
      today,
      [aim(4)],
    );
    const j = judgeWeeks(h, '2026-10-05', today);
    expect(judged(j)).toEqual([
      ['2026-10-05', 4, 2, 2, 2],
      ['2026-10-12', 4, 2, 2, 1],
      ['2026-10-19', 4, 4, 0, 0],
    ]);
    expect(j.map((w) => w.outcome)).toEqual([1, 0.75, 1]);
    expect(SKIPS_PER_MONTH).toBe(3);
  });

  it('starts a fresh allowance with the month, by the week’s Thursday', () => {
    // A full week on 14 Sep starts the history; then three empty weeks.
    const today = '2026-10-14';
    const h = history(days('2026-09-14', '2026-09-15', '2026-09-16'), today, [aim(3)]);
    const j = judgeWeeks(h, '2026-09-21', today);
    expect(judged(j)).toEqual([
      ['2026-09-21', 3, 0, 3, 3], // September: 3 forgiven
      ['2026-09-28', 3, 0, 3, 3], // Thursday 1 Oct: October's allowance
      ['2026-10-05', 3, 0, 3, 0], // October's allowance is spent
    ]);
    expect(j.map((w) => w.outcome)).toEqual([1, 1, 0]);
  });

  it('does not carry an unused allowance over', () => {
    const today = '2026-10-14';
    const h = history(days('2026-09-21', '2026-09-22', '2026-09-23'), today, [
      aim(3),
      aim(5, '2026-10-05'),
    ]);
    const j = judgeWeeks(h, '2026-09-21', today);
    // 28 Sep: 3 short, all of October's three. 5 Oct: 5 short, nothing left.
    expect(judged(j)).toEqual([
      ['2026-09-21', 3, 3, 0, 0],
      ['2026-09-28', 3, 0, 3, 3],
      ['2026-10-05', 5, 0, 5, 0],
    ]);
    // A month that used none: September's unused three are gone by October.
    const h2 = history(days('2026-09-21', '2026-09-22', '2026-09-23'), today, [
      aim(3),
      aim(5, '2026-09-28'),
    ]);
    const second = judgeWeeks(h2, '2026-09-21', today);
    expect(second[1]!.skipped).toBe(3);
    expect(second[1]!.outcome).toBeCloseTo(0.6);
  });

  it('shares the month’s skips with the run: days short before switching on still spent them', () => {
    // 5 Oct, before hard mode: two short of three. Hard mode from 12 Oct, two short again.
    const today = '2026-10-21';
    const sessions = days('2026-10-05', '2026-10-12');
    const h = history(sessions, today, [aim(3)]);
    const j = judgeWeeks(h, firstJudgedWeek('2026-10-12'), today);
    expect(judged(j)).toEqual([['2026-10-12', 3, 1, 2, 1]]);
    // Exactly what the run says is left this month: nothing.
    expect(trainingStreak(sessions, today, { aims: [aim(3)] }).skips.left).toBe(0);
  });

  it('never judges the week in progress, nor anything before `from`', () => {
    const today = '2026-10-21';
    const h = history(days('2026-10-05', '2026-10-12', '2026-10-19'), today, [aim(1)]);
    expect(judgeWeeks(h, '2026-10-12', today).map((w) => w.week)).toEqual(['2026-10-12']);
    expect(judgeWeeks(h, '2026-10-19', today)).toEqual([]);
  });

  it('does not judge an easier week short of the aim, and judges one met anyway', () => {
    const today = '2026-11-04';
    const easyWeeks = [
      { from: '2026-10-12', to: '2026-10-18' },
      { from: '2026-10-26', to: '2026-11-01' },
    ];
    const sessions = days(
      '2026-10-05',
      '2026-10-06',
      '2026-10-13', // easy, short
      '2026-10-19',
      '2026-10-20',
      '2026-10-26', // easy, met
      '2026-10-27',
    );
    const h = history(sessions, today, [aim(2)], easyWeeks);
    const j = judgeWeeks(h, '2026-10-05', today);
    expect(judged(j)).toEqual([
      ['2026-10-05', 2, 2, 0, 0],
      ['2026-10-19', 2, 2, 0, 0],
      ['2026-10-26', 2, 2, 0, 0],
    ]);
    // And it spends no skips: a short week later in the month still has all three.
    const later = history([...sessions.slice(0, 3)], '2026-10-28', [aim(2)], easyWeeks);
    expect(judged(judgeWeeks(later, '2026-10-05', '2026-10-28'))).toEqual([
      ['2026-10-05', 2, 2, 0, 0],
      ['2026-10-19', 2, 0, 2, 2],
    ]);
  });

  it('takes the allowance as a parameter', () => {
    const today = '2026-10-21';
    const h = history(days('2026-10-05', '2026-10-12'), today, [aim(3)]);
    expect(judgeWeeks(h, '2026-10-05', today, 0).map((w) => w.skipped)).toEqual([0, 0]);
    expect(judgeWeeks(h, '2026-10-05', today, 10).map((w) => w.skipped)).toEqual([2, 2]);
  });

  it('expects half a week of a newcomer and more of a better record', () => {
    expect(expectedOutcome(RATING_START)).toBe(0.5);
    expect(expectedOutcome(1400)).toBeCloseTo(10 / 11, 10);
    expect(expectedOutcome(600)).toBeCloseTo(1 / 11, 10);
  });

  it('moves a newcomer by half of K either way', () => {
    expect(rateWeek(RATING_START, 1)).toBe(RATING_START + RATING_K / 2);
    expect(rateWeek(RATING_START, 0)).toBe(RATING_START - RATING_K / 2);
    expect(rateWeek(RATING_START, 0.5)).toBe(RATING_START);
  });

  it('is symmetric: a full week at 1000 + d gains what an empty one at 1000 − d loses', () => {
    for (const d of [0, 50, 200, 400]) {
      const gain = rateWeek(RATING_START + d, 1) - (RATING_START + d);
      const loss = RATING_START - d - rateWeek(RATING_START - d, 0);
      expect(gain).toBeCloseTo(loss, 10);
    }
  });

  it('costs a strong record more for a miss, and pays it less for a full week', () => {
    const high = 1300;
    expect(high - rateWeek(high, 0)).toBeGreaterThan(RATING_START - rateWeek(RATING_START, 0));
    expect(rateWeek(high, 1) - high).toBeLessThan(rateWeek(RATING_START, 1) - RATING_START);
  });

  it('never moves more than K in a week, and clamps an outcome outside 0–1', () => {
    for (const rating of [0, 500, 1000, 1500, 3000]) {
      for (const o of [0, 0.3, 1]) {
        expect(Math.abs(rateWeek(rating, o) - rating)).toBeLessThanOrEqual(RATING_K);
      }
    }
    expect(rateWeek(RATING_START, 2)).toBe(rateWeek(RATING_START, 1));
    expect(rateWeek(RATING_START, -1)).toBe(rateWeek(RATING_START, 0));
  });

  const week = (monday: string, outcome: number): JudgedWeek => ({
    week: monday,
    planned: 3,
    done: outcome * 3,
    missed: 3 - outcome * 3,
    skipped: 0,
    outcome,
  });

  it('climbs with a perfect record but ever more slowly, and is bounded by it', () => {
    const perfect = Array.from({ length: 52 }, (_, i) => week(addDays('2026-01-05', i * 7), 1));
    const after1 = hardRating(perfect.slice(0, 1));
    const after26 = hardRating(perfect.slice(0, 26));
    const after52 = hardRating(perfect);
    expect(after1).toBeGreaterThan(RATING_START);
    expect(after52).toBeGreaterThan(after26);
    expect(after52 - after26).toBeLessThan(after26 - RATING_START);
    expect(after52).toBeLessThan(RATING_START + 52 * RATING_K);
  });

  it('a year of empty weeks cannot drive the rating below zero', () => {
    const empty = Array.from({ length: 52 }, (_, i) => week(addDays('2026-01-05', i * 7), 0));
    expect(hardRating(empty)).toBeGreaterThan(0);
    expect(hardRating([])).toBe(RATING_START);
  });

  it('a perfect year from the streak’s own weeks rates the same as the hand-built one', () => {
    const sessions: WorkoutSession[] = [];
    for (let i = 0; i < 52; i++) {
      const monday = addDays('2025-10-20', i * 7);
      sessions.push(...days(monday, addDays(monday, 2), addDays(monday, 4)));
    }
    const today = '2026-10-21';
    const j = judgeWeeks(history(sessions, today, [aim(3)]), '2025-10-20', today);
    expect(j).toHaveLength(52);
    expect(j.every((w) => w.outcome === 1)).toBe(true);
    expect(hardRating(j)).toBeCloseTo(
      hardRating(Array.from({ length: 52 }, (_, i) => week(addDays('2026-01-05', i * 7), 1))),
      10,
    );
  });
});

describe('circleWeeks', () => {
  const today = '2026-10-21'; // a Wednesday
  const base = (o: Partial<CircleInputs>): CircleInputs => ({
    sessions: [],
    weighIns: [],
    aims: [aim(3)],
    today,
    ...o,
  });

  it('publishes the four whole weeks and the week in progress', () => {
    const weeks = circleWeeks(base({ sessions: days('2026-08-26') }));
    expect(weeks.map((w) => w.week)).toEqual([...pastWeeks(today, BOARD_WEEKS), '2026-10-19']);
    for (const w of weeks) {
      expect(w).toEqual({
        week: w.week,
        planned: 3,
        done: 0,
        consistency: 0,
        score: 0,
        flagged: 0,
        hard: false,
      });
    }
  });

  it('publishes nothing from before the first week trained, so a newcomer starts level', () => {
    expect(circleWeeks(base({})).map((w) => w.week)).toEqual(['2026-10-19']);
    expect(circleWeeks(base({ sessions: days('2026-10-07') })).map((w) => w.week)).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ]);
  });

  it('publishes integers only, and nothing it was computed from', () => {
    const sessions = [
      session('2026-08-26', { bench: 100 }),
      session('2026-09-23', { bench: 100 }),
      session('2026-10-13', { bench: 103 }),
      session('2026-10-20', { bench: 104 }),
    ];
    const weeks = circleWeeks(
      base({
        sessions,
        weighIns: [{ date: '2026-09-01', weight_kg: 82 }],
        sex: 'male',
        aims: [aim(2)],
        hardSince: '2026-09-01',
      }),
    );
    const allowed = [
      'week',
      'planned',
      'done',
      'consistency',
      'progress',
      'score',
      'flagged',
      'hard',
      'rating',
    ];
    for (const w of weeks) {
      for (const [k, v] of Object.entries(w)) {
        expect(allowed).toContain(k);
        if (typeof v === 'number') expect(Number.isInteger(v)).toBe(true);
      }
    }
    const json = JSON.stringify(weeks);
    expect(json).not.toMatch(/bench|82|kg|weight|sets|aim_source|status|short/);
  });

  it('scores progress at each week’s Sunday and the week in progress at today', () => {
    const sessions = [session('2026-09-02', { bench: 100 }), session('2026-10-20', { bench: 102 })];
    const weeks = circleWeeks(base({ sessions, aims: [aim(1)] }));
    const current = weeks.at(-1)!;
    expect(current.progress).toBe(progressScore(0.02));
    expect(current.done).toBe(1);
    expect(current.score).toBe(weekScore(100, progressScore(0.02)));
    // On 18 Oct the bench at 102 had not happened, and 2 Sep was the only session in reach.
    expect(weeks.at(-2)!.progress).toBeUndefined();
  });

  it('marks and rates only the weeks hard mode was on for', () => {
    const sessions = days('2026-09-21', '2026-09-23', '2026-10-05', '2026-10-12', '2026-10-14');
    const weeks = circleWeeks(base({ sessions, aims: [aim(2)], hardSince: '2026-10-01' }));
    expect(weeks.map((w) => w.hard)).toEqual([false, false, true, true, true]);
    expect(weeks.slice(0, 2).every((w) => w.rating == null)).toBe(true);
    // 28 Sep, before hard mode, was two short and spent two of October's skips. Judged from
    // 5 Oct: 1 of 2, the last skip makes it whole; then 2 of 2.
    expect(weeks[2]!.rating).toBe(Math.round(rateWeek(RATING_START, 1)));
    expect(weeks[3]!.rating).toBe(Math.round(rateWeek(rateWeek(RATING_START, 1), 1)));
    // The week in progress shows the rating as it stood at the last whole week.
    expect(weeks[4]!.rating).toBe(weeks[3]!.rating);
  });

  it('costs hard mode the miss the run could no longer forgive', () => {
    // As above, but 28 Sep spent all three of October's skips (aim 3, nothing done).
    const sessions = days('2026-09-21', '2026-09-22', '2026-09-23', '2026-10-05', '2026-10-12');
    const weeks = circleWeeks(base({ sessions, aims: [aim(3)], hardSince: '2026-10-01' }));
    const first = rateWeek(RATING_START, 1 / 3);
    expect(weeks[2]!.rating).toBe(Math.round(first));
    expect(weeks[3]!.rating).toBe(Math.round(rateWeek(first, 1 / 3)));
    expect(weeks[3]!.rating!).toBeLessThan(RATING_START);
  });

  it('leaves the rating alone over an easier week short of the aim', () => {
    const sessions = days('2026-09-28', '2026-09-29', '2026-10-05', '2026-10-12', '2026-10-13');
    const easyWeeks = [{ from: '2026-10-05', to: '2026-10-11' }];
    const weeks = circleWeeks(
      base({ sessions, aims: [aim(2)], easyWeeks, hardSince: '2026-09-28' }),
    );
    const byWeek = new Map(weeks.map((w) => [w.week, w]));
    const afterFirst = Math.round(rateWeek(RATING_START, 1));
    expect(byWeek.get('2026-09-28')!.rating).toBe(afterFirst);
    expect(byWeek.get('2026-10-05')).toMatchObject({ hard: true, consistency: 100 });
    expect(byWeek.get('2026-10-05')!.rating).toBe(afterFirst);
    expect(byWeek.get('2026-10-12')!.rating).toBe(
      Math.round(rateWeek(rateWeek(RATING_START, 1), 1)),
    );
  });

  it('shows the open week against the whole week’s aim, unjudged', () => {
    const weeks = circleWeeks(
      base({ sessions: days('2026-10-12', '2026-10-13', '2026-10-14', '2026-10-19') }),
    );
    expect(weeks.at(-1)).toMatchObject({
      week: '2026-10-19',
      planned: 3,
      done: 1,
      consistency: 33,
    });
  });

  it('a rating switched on this week starts at the start', () => {
    const weeks = circleWeeks(base({ hardSince: today }));
    expect(weeks.at(-1)).toMatchObject({ hard: true, rating: RATING_START });
  });

  it('counts the flagged bests of the current window', () => {
    const sessions = [session('2026-09-02', { bench: 100 }), session('2026-10-20', { bench: 300 })];
    const weeks = circleWeeks(base({ sessions, aims: [aim(1)] }));
    expect(weeks.at(-1)!.flagged).toBe(1);
    expect(weeks.at(-1)!.progress).toBeUndefined();
  });
});

describe('rankBoard', () => {
  const today = '2026-10-21';
  const weeks = pastWeeks(today, BOARD_WEEKS);
  const row = (
    member: string,
    week: string,
    score: number,
    o: Partial<BoardWeek> = {},
  ): BoardWeek => ({
    member_id: member,
    display_name: member.toUpperCase(),
    is_me: false,
    is_owner: false,
    week,
    planned: 3,
    done: 2,
    consistency: score,
    progress: null,
    score,
    flagged: 0,
    hard: false,
    rating: null,
    ...o,
  });

  it('ranks by the mean of the whole weeks, not the week in progress', () => {
    const b = rankBoard(
      [
        ...weeks.map((w) => row('a', w, 80)),
        ...weeks.map((w) => row('b', w, 90)),
        row('a', '2026-10-19', 100, { done: 3 }),
        row('b', '2026-10-19', 0, { done: 0 }),
      ],
      today,
    );
    expect(b.map((x) => [x.member_id, x.score, x.rank, x.done])).toEqual([
      ['b', 90, 1, 0],
      ['a', 80, 2, 3],
    ]);
  });

  it('counts a missing whole week as nothing done', () => {
    const b = rankBoard([row('a', weeks[0]!, 100), row('a', weeks[3]!, 100)], today);
    expect(b[0]!.score).toBe(50);
    expect(b[0]!.weeks).toBe(4);
  });

  it('measures a newcomer from their first week, not before it', () => {
    const b = rankBoard([row('a', weeks[2]!, 90), row('a', weeks[3]!, 70)], today);
    expect(b[0]).toMatchObject({ score: 80, weeks: 2 });
  });

  it('shares a rank on a tie and skips the next', () => {
    const b = rankBoard(
      [row('c', weeks[3]!, 70), row('a', weeks[3]!, 90), row('b', weeks[3]!, 90)],
      today,
    );
    expect(b.map((x) => [x.member_id, x.rank])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
    ]);
  });

  it('leaves someone with only the week in progress unranked rather than zero', () => {
    const b = rankBoard([row('a', weeks[3]!, 10), row('n', '2026-10-19', 100, { done: 1 })], today);
    expect(b.map((x) => [x.member_id, x.rank])).toEqual([
      ['a', 1],
      ['n', undefined],
    ]);
    expect(b[1]!.score).toBeUndefined();
  });

  it('ignores weeks older than the board', () => {
    const b = rankBoard([row('a', '2026-08-03', 100), row('a', weeks[3]!, 40)], today);
    expect(b[0]!.score).toBe(40);
  });

  it('shows a rating only for a member in hard mode', () => {
    const b = rankBoard(
      [
        row('a', weeks[3]!, 50, { hard: true, rating: 1016 }),
        row('b', weeks[3]!, 50, { hard: false, rating: 1100 }),
      ],
      today,
    );
    expect(b.find((x) => x.member_id === 'a')!.rating).toBe(1016);
    expect(b.find((x) => x.member_id === 'b')!.rating).toBeUndefined();
  });

  it('is empty for an empty circle', () => {
    expect(rankBoard([], today)).toEqual([]);
  });
});
