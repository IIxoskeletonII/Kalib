import { describe, expect, it } from 'vitest';
import { e1rm } from './sets';
import { bodyweightOn, describeProgress, progressMetric, progressSeries } from './strength';
import type { WorkoutEntry, WorkoutSession, WorkoutSet } from './types';

const set = (o: Partial<WorkoutSet>): WorkoutSet => ({ kind: 'normal', done: true, ...o });
const EX = 'library:0025';

function session(
  day: string,
  sets: WorkoutSet[],
  o: { load_type?: WorkoutEntry['load_type']; exercise_id?: string; ended?: boolean } = {},
): WorkoutSession {
  // Midday UTC, so the local date key is the same day in every timezone the tests run in.
  const at = `${day}T12:00:00.000Z`;
  return {
    id: day + (o.exercise_id ?? ''),
    user_id: 'local',
    created_at: at,
    updated_at: at,
    started_at: at,
    ...(o.ended === false ? {} : { ended_at: at }),
    name: 'Day',
    entries: [
      {
        exercise_id: o.exercise_id ?? EX,
        name: 'Bench',
        load_type: o.load_type ?? 'weight_reps',
        sets,
      },
    ],
  };
}

describe('progressSeries', () => {
  it('draws one estimated 1RM per session, oldest first, marking only real improvements', () => {
    const p = progressSeries(
      [
        session('2026-09-15', [set({ weight_kg: 85, reps: 5 })]),
        session('2026-09-01', [set({ weight_kg: 80, reps: 8 }), set({ weight_kg: 80, reps: 6 })]),
        session('2026-09-08', [set({ weight_kg: 80, reps: 5 })]),
        session('2026-09-22', [set({ weight_kg: 90, reps: 5 })]),
      ],
      EX,
      'weight_reps',
    )!;
    expect(p.metric).toBe('e1rm');
    expect(p.points.map((x) => x.date)).toEqual([
      '2026-09-01',
      '2026-09-08',
      '2026-09-15',
      '2026-09-22',
    ]);
    expect(p.points[0]!.value).toBeCloseTo(e1rm(80, 8)!, 9);
    // The first outing is never a record; a dip is not one; only beating everything before is.
    expect(p.points.map((x) => x.record)).toEqual([false, false, false, true]);
    expect(p.first.date).toBe('2026-09-01');
    expect(p.latest.date).toBe('2026-09-22');
    expect(p.best.date).toBe('2026-09-22');
  });

  it('keeps the earliest of tied bests, which is when it was first done', () => {
    const p = progressSeries(
      [
        session('2026-09-01', [set({ weight_kg: 80, reps: 5 })]),
        session('2026-09-08', [set({ weight_kg: 90, reps: 5 })]),
        session('2026-09-15', [set({ weight_kg: 90, reps: 5 })]),
      ],
      EX,
      'weight_reps',
    )!;
    expect(p.best.date).toBe('2026-09-08');
    expect(p.points[2]!.record).toBe(false);
  });

  it('needs two points, and skips sessions that cannot be estimated or are unfinished', () => {
    const one = [session('2026-09-01', [set({ weight_kg: 80, reps: 5 })])];
    expect(progressSeries(one, EX, 'weight_reps')).toBeUndefined();
    const p = progressSeries(
      [
        ...one,
        session('2026-09-04', [set({ weight_kg: 40, reps: 20 })]), // past 12 reps: no estimate
        session('2026-09-06', [set({ weight_kg: 60, reps: 5, done: false })]),
        session('2026-09-07', [set({ weight_kg: 60, reps: 5, kind: 'warmup' })]),
        session('2026-09-09', [set({ weight_kg: 120, reps: 5 })], { ended: false }),
        session('2026-09-10', [set({ weight_kg: 120, reps: 5 })], { exercise_id: 'other' }),
        session('2026-09-11', [set({ weight_kg: 82.5, reps: 5 })]),
      ],
      EX,
      'weight_reps',
    )!;
    expect(p.points.map((x) => x.date)).toEqual(['2026-09-01', '2026-09-11']);
  });

  it('takes the better entry when a session did the exercise twice', () => {
    const s = session('2026-09-08', [set({ weight_kg: 80, reps: 5 })]);
    s.entries.push({ ...s.entries[0]!, sets: [set({ weight_kg: 100, reps: 2 })] });
    const p = progressSeries(
      [session('2026-09-01', [set({ weight_kg: 80, reps: 5 })]), s],
      EX,
      'weight_reps',
    )!;
    expect(p.points[1]!.value).toBeCloseTo(e1rm(100, 2)!, 9);
  });

  it('counts reps on bodyweight work, and seconds on a hold', () => {
    const reps = progressSeries(
      [
        session('2026-09-01', [set({ reps: 12 }), set({ reps: 15 })], {
          load_type: 'bodyweight_reps',
        }),
        session('2026-09-08', [set({ reps: 18 })], { load_type: 'bodyweight_reps' }),
      ],
      EX,
      'bodyweight_reps',
    )!;
    expect(reps.metric).toBe('reps');
    expect(reps.points.map((x) => x.value)).toEqual([15, 18]);

    const hold = progressSeries(
      [
        session('2026-09-01', [set({ seconds: 45 })], { load_type: 'time' }),
        session('2026-09-08', [set({ seconds: 60 })], { load_type: 'time' }),
      ],
      EX,
      'time',
    )!;
    expect(hold.metric).toBe('seconds');
    expect(hold.points.map((x) => x.value)).toEqual([45, 60]);
  });

  it('has no line for distance work', () => {
    const s = (day: string) =>
      session(day, [set({ seconds: 600, distance_m: 2000 })], { load_type: 'distance_time' });
    expect(progressSeries([s('2026-09-01'), s('2026-09-08')], EX, 'distance_time')).toBeUndefined();
  });

  it('prices a belted lift with the bodyweight of the day, not of today', () => {
    const wb = { load_type: 'weighted_bodyweight' as const };
    const sessions = [
      session('2026-03-01', [set({ weight_kg: 10, reps: 5 })], wb),
      session('2026-09-01', [set({ weight_kg: 20, reps: 5 })], wb),
    ];
    const weighIns = [
      { date: '2026-02-20', weight_kg: 90 },
      { date: '2026-08-30', weight_kg: 80 },
    ];
    const p = progressSeries(sessions, EX, 'weighted_bodyweight', weighIns)!;
    expect(p.metric).toBe('e1rm');
    expect(p.points[0]!.value).toBeCloseTo(e1rm(100, 5)!, 9);
    expect(p.points[1]!.value).toBeCloseTo(e1rm(100, 5)!, 9);
    // Ten kilos lighter carrying ten more: the same lift, not a record and not a decline.
    expect(p.points[1]!.record).toBe(false);
  });

  it('counts reps on bodyweight work until a belt is used, or without any bodyweight', () => {
    const wb = { load_type: 'weighted_bodyweight' as const };
    const bare = [
      session('2026-09-01', [set({ reps: 20 })], wb),
      session('2026-09-08', [set({ reps: 24 })], wb),
    ];
    expect(
      progressSeries(bare, EX, 'weighted_bodyweight', [{ date: '2026-09-01', weight_kg: 80 }])!
        .metric,
    ).toBe('reps');
    const belted = [
      session('2026-09-01', [set({ weight_kg: 10, reps: 6 })], wb),
      session('2026-09-08', [set({ weight_kg: 10, reps: 8 })], wb),
    ];
    const p = progressSeries(belted, EX, 'weighted_bodyweight')!;
    expect(p.metric).toBe('reps');
    expect(p.points.map((x) => x.value)).toEqual([6, 8]);
  });
});

describe('progressMetric', () => {
  it('follows the load type', () => {
    expect(progressMetric('weight_reps', [], false)).toBe('e1rm');
    expect(progressMetric('bodyweight_reps', [], true)).toBe('reps');
    expect(progressMetric('time', [], true)).toBe('seconds');
    expect(progressMetric('distance_time', [], true)).toBeUndefined();
  });
});

describe('bodyweightOn', () => {
  const w = [
    { date: '2026-09-10', weight_kg: 82 },
    { date: '2026-09-01', weight_kg: 84 },
    { date: '2026-09-20', weight_kg: 80 },
  ];
  it('takes the last weigh-in on or before the day', () => {
    expect(bodyweightOn(w, '2026-09-15')).toBe(82);
    expect(bodyweightOn(w, '2026-09-10')).toBe(82);
    expect(bodyweightOn(w, '2026-12-01')).toBe(80);
  });
  it('falls back to the first one after, and is undefined with none', () => {
    expect(bodyweightOn(w, '2026-08-01')).toBe(84);
    expect(bodyweightOn([], '2026-08-01')).toBeUndefined();
  });
});

describe('describeProgress', () => {
  const kg = (v: number) => `${Math.round(v)} kg`;
  const series = (...vs: [string, number][]) =>
    progressSeries(
      vs.map(([d, w]) => session(d, [set({ weight_kg: w, reps: 1 })])),
      EX,
      'weight_reps',
    )!;

  it('says where it is against where it began, and the best when that is not now', () => {
    const p = series(['2026-06-03', 80], ['2026-09-12', 95], ['2026-10-01', 92]);
    const text = describeProgress(p, kg);
    expect(text).toMatch(/^92 kg last time, up from 80 kg on /);
    expect(text).toMatch(/Best 95 kg on /);
  });

  it('says down when it is down, and leaves out a best that is the latest', () => {
    expect(describeProgress(series(['2026-06-03', 90], ['2026-10-01', 85]), kg)).toMatch(
      /^85 kg last time, down from 90 kg on [^.]+\.$/,
    );
  });

  it('calls a change too small to print the same, not up', () => {
    expect(describeProgress(series(['2026-06-03', 80], ['2026-10-01', 80.2]), kg)).toMatch(
      /^80 kg last time, the same as on /,
    );
  });
});
