import { describe, expect, it } from 'vitest';
import {
  achievements,
  earnedLine,
  comparison,
  formatMass,
  MASSES,
  nextUp,
  progressOf,
  SESSION_COUNTS,
  STREAK_WEEKS,
  unseen,
  type Achievement,
} from './achievements';
import { addDays, fromDateKey } from './dates';
import { trainingStreak } from './streak';
import type { LoadType, WorkoutSession, WorkoutSet } from './types';
import { KG_PER_LB } from './weightUnit';

const lift = (weight_kg: number, reps: number, extra: Partial<WorkoutSet> = {}): WorkoutSet => ({
  kind: 'normal',
  done: true,
  weight_kg,
  reps,
  ...extra,
});

function session(
  day: string,
  sets: WorkoutSet[],
  o: { load_type?: LoadType; ended?: boolean; deleted?: boolean; id?: string } = {},
): WorkoutSession {
  const t = fromDateKey(day);
  t.setHours(18);
  const iso = t.toISOString();
  return {
    id: o.id ?? `${day}-${Math.random()}`,
    user_id: 'local',
    created_at: iso,
    updated_at: iso,
    started_at: iso,
    ...(o.ended === false ? {} : { ended_at: iso }),
    ...(o.deleted ? { deleted_at: iso } : {}),
    name: 'Day',
    entries: [{ exercise_id: 'x', name: 'X', load_type: o.load_type ?? 'weight_reps', sets }],
  };
}

const byId = (items: readonly Achievement[], id: string) => items.find((a) => a.id === id)!;

describe('the masses', () => {
  it('climb, and each is the figure its source gives', () => {
    const kg = MASSES.map((m) => m.kg);
    expect([...kg].sort((a, b) => a - b)).toEqual(kg);
    expect(MASSES.find((m) => m.id === 'piano')!.kg).toBe(480);
    expect(MASSES.find((m) => m.id === 'whale')!.kg).toBeCloseTo(149_685, 0);
    expect(MASSES.find((m) => m.id === 'jumbo')!.kg).toBeCloseTo(447_696, 0);
    expect(MASSES.find((m) => m.id === 'saturn')!.kg).toBe(2_800_000);
    expect(MASSES.find((m) => m.id === 'eiffel')!.kg).toBe(7_300_000);
  });

  it('have unique ids, and so do all the milestones', () => {
    const r = achievements([]);
    const ids = r.items.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(MASSES.length + SESSION_COUNTS.length + STREAK_WEEKS.length);
  });
});

describe('achievements — volume', () => {
  it('earns the piano exactly at 480 kg, not a kilo before', () => {
    const below = achievements([session('2026-10-01', [lift(479, 1)])]);
    expect(byId(below.items, 'volume:piano').earned_on).toBeUndefined();
    const at = achievements([session('2026-10-01', [lift(48, 10)])]);
    expect(byId(at.items, 'volume:piano').earned_on).toBe('2026-10-01');
    const above = achievements([session('2026-10-01', [lift(481, 1)])]);
    expect(byId(above.items, 'volume:piano').earned_on).toBe('2026-10-01');
  });

  it('dates each one to the session that crossed it', () => {
    const r = achievements([
      session('2026-10-01', [lift(100, 4)]), // 400
      session('2026-10-03', [lift(100, 1)]), // 500: the piano
      session('2026-10-05', [lift(100, 55)]), // 6,000: the elephant
    ]);
    expect(byId(r.items, 'volume:piano').earned_on).toBe('2026-10-03');
    expect(byId(r.items, 'volume:elephant').earned_on).toBe('2026-10-05');
    expect(byId(r.items, 'volume:whale').earned_on).toBeUndefined();
    expect(r.lifetime.kg).toBe(6_000);
  });

  it('dates them by time, whatever order sessions arrive in', () => {
    const a = session('2026-10-01', [lift(100, 4)]);
    const b = session('2026-10-03', [lift(100, 1)]);
    expect(byId(achievements([b, a]).items, 'volume:piano').earned_on).toBe('2026-10-03');
  });

  it('counts working sets only', () => {
    const r = achievements([
      session('2026-10-01', [
        lift(200, 5, { kind: 'warmup' }),
        lift(200, 5, { done: false }),
        lift(10, 5),
      ]),
    ]);
    expect(r.lifetime.kg).toBe(50);
  });

  it('ignores deleted, running and empty sessions', () => {
    const r = achievements([
      session('2026-10-01', [lift(500, 1)], { deleted: true }),
      session('2026-10-02', [lift(500, 1)], { ended: false }),
      session('2026-10-03', []),
      session('2026-10-04', [lift(500, 1, { done: false })]),
    ]);
    expect(r.lifetime).toEqual({ kg: 0, unknown_sets: 0, sessions: 0, best_run: 0 });
    expect(r.items.every((a) => a.earned_on == null)).toBe(true);
  });

  it('prices bodyweight work at the weigh-in nearest before it, and leaves it out without one', () => {
    const pullups = [lift(0, 10)];
    const s = [
      session('2026-10-01', pullups, { load_type: 'bodyweight_reps' }),
      session('2026-10-10', pullups, { load_type: 'bodyweight_reps' }),
    ];
    const none = achievements(s);
    expect(none.lifetime).toMatchObject({ kg: 0, unknown_sets: 2, sessions: 2 });
    const priced = achievements(s, {
      weighIns: [
        { date: '2026-09-20', weight_kg: 80 },
        { date: '2026-10-05', weight_kg: 78 },
      ],
    });
    expect(priced.lifetime).toMatchObject({ kg: 800 + 780, unknown_sets: 0 });
  });

  it('uses the first weigh-in after for sessions before any', () => {
    const r = achievements(
      [session('2026-10-01', [lift(0, 10)], { load_type: 'bodyweight_reps' })],
      { weighIns: [{ date: '2026-10-20', weight_kg: 70 }] },
    );
    expect(r.lifetime.kg).toBe(700);
  });

  it('adds the belt to bodyweight for weighted bodyweight work', () => {
    const r = achievements(
      [session('2026-10-01', [lift(20, 5)], { load_type: 'weighted_bodyweight' })],
      { weighIns: [{ date: '2026-10-01', weight_kg: 80 }] },
    );
    expect(r.lifetime.kg).toBe(500);
  });

  it('counts timed and distance sessions, but adds no kilograms for them', () => {
    const r = achievements([
      session('2026-10-01', [{ kind: 'normal', done: true, seconds: 60 }], { load_type: 'time' }),
      session('2026-10-02', [{ kind: 'normal', done: true, seconds: 600, distance_m: 2000 }], {
        load_type: 'distance_time',
      }),
    ]);
    expect(r.lifetime).toMatchObject({ kg: 0, sessions: 2, unknown_sets: 0 });
    expect(byId(r.items, 'sessions:1').earned_on).toBe('2026-10-01');
  });

  it('describes the target in the unit you use', () => {
    const kg = achievements([], { unit: 'kg' });
    const lb = achievements([], { unit: 'lb' });
    expect(byId(kg.items, 'volume:whale').detail).toBe('Lift 150 t in all — a blue whale');
    expect(byId(lb.items, 'volume:whale').detail).toBe('Lift 330,000 lb in all — a blue whale');
    expect(byId(lb.items, 'volume:eiffel').detail).toBe(
      'Lift 16.1 million lb in all — the iron of the Eiffel Tower',
    );
  });
});

describe('achievements — sessions', () => {
  it('earns each count on the session that reaches it', () => {
    const sessions = Array.from({ length: 25 }, (_, i) =>
      session(addDays('2026-01-01', i), [lift(20, 5)]),
    );
    const r = achievements(sessions);
    expect(byId(r.items, 'sessions:1').earned_on).toBe('2026-01-01');
    expect(byId(r.items, 'sessions:10').earned_on).toBe('2026-01-10');
    expect(byId(r.items, 'sessions:25').earned_on).toBe('2026-01-25');
    expect(byId(r.items, 'sessions:50').earned_on).toBeUndefined();
    expect(byId(r.items, 'sessions:50').value).toBe(25);
  });

  it('counts two sessions on one day as two sessions', () => {
    const r = achievements([
      session('2026-10-01', [lift(20, 5)]),
      session('2026-10-01', [lift(20, 5)]),
    ]);
    expect(r.lifetime.sessions).toBe(2);
  });

  it('names them plainly', () => {
    const r = achievements([]);
    expect(byId(r.items, 'sessions:1')).toMatchObject({
      title: 'First session',
      detail: 'Finish a workout',
    });
    expect(byId(r.items, 'sessions:1000')).toMatchObject({
      title: '1,000 sessions',
      detail: 'Finish 1,000 workouts',
    });
  });
});

describe('achievements — streaks', () => {
  const weekly = (monday: string, n: number) =>
    Array.from({ length: n }, (_, k) => session(addDays(monday, 7 * k + 2), [lift(20, 5)]));

  it('earns four weeks running on the last training day of the fourth week', () => {
    const sessions = weekly('2026-09-07', 4);
    const { history } = trainingStreak(sessions, '2026-10-07');
    const r = achievements(sessions, { history });
    expect(byId(r.items, 'streak:4').earned_on).toBe('2026-09-30');
    expect(byId(r.items, 'streak:12').earned_on).toBeUndefined();
    expect(r.lifetime.best_run).toBe(4);
  });

  it('is not earned three weeks in', () => {
    const sessions = weekly('2026-09-07', 3);
    const r = achievements(sessions, { history: trainingStreak(sessions, '2026-10-07').history });
    expect(byId(r.items, 'streak:4').earned_on).toBeUndefined();
    expect(byId(r.items, 'streak:4').value).toBe(3);
  });

  it('is not earned in a week with no training, even one that keeps the run', () => {
    // Three weeks, then an empty week the month forgives: the run is four weeks long, but the
    // milestone waits for a week that was trained.
    const sessions = weekly('2026-09-07', 3);
    const { history } = trainingStreak(sessions, '2026-10-05');
    expect(history.map((w) => w.status)).toEqual(['met', 'met', 'met', 'forgiven', 'open']);
    expect(byId(achievements(sessions, { history }).items, 'streak:4').earned_on).toBeUndefined();
    const more = [...sessions, session('2026-10-06', [lift(20, 5)])];
    const next = trainingStreak(more, '2026-10-06').history;
    expect(byId(achievements(more, { history: next }).items, 'streak:4').earned_on).toBe(
      '2026-10-06',
    );
  });

  it('stays earned after the run ends', () => {
    const sessions = [...weekly('2026-06-01', 13), session('2026-11-25', [lift(20, 5)])];
    const r = achievements(sessions, { history: trainingStreak(sessions, '2026-11-25').history });
    expect(byId(r.items, 'streak:12').earned_on).toBeDefined();
    expect(r.lifetime.best_run).toBeGreaterThanOrEqual(13);
  });

  it('earns nothing for streaks without a history', () => {
    const r = achievements(weekly('2026-09-07', 10));
    expect(r.items.filter((a) => a.kind === 'streak').every((a) => !a.earned_on)).toBe(true);
  });
});

describe('unseen', () => {
  const items = achievements(
    [
      session('2026-10-01', [lift(100, 5)]), // 500 kg: piano, first session
      session('2026-10-08', [lift(100, 60)]), // 6,500: elephant
    ],
    {},
  ).items;

  it('lists earned ones not yet shown, newest first', () => {
    const u = unseen(items, []);
    expect(u.map((a) => a.id)).toEqual(['volume:elephant', 'volume:piano', 'sessions:1']);
  });

  it('leaves out what has been shown', () => {
    expect(unseen(items, ['volume:elephant']).map((a) => a.id)).toEqual([
      'volume:piano',
      'sessions:1',
    ]);
    expect(
      unseen(
        items,
        items.map((a) => a.id),
      ),
    ).toEqual([]);
  });

  it('ignores seen ids that no longer exist', () => {
    expect(unseen(items, ['volume:moon'])).toHaveLength(3);
  });
});

describe('nextUp and progressOf', () => {
  it('names the next one of a kind and how far along it is', () => {
    const r = achievements([session('2026-10-01', [lift(100, 30)])]); // 3,000 kg
    const next = nextUp(r.items, 'volume')!;
    expect(next.id).toBe('volume:elephant');
    expect(progressOf(next)).toBeCloseTo(0.5, 5);
    expect(nextUp(r.items, 'sessions')!.id).toBe('sessions:10');
  });

  it('is undefined once everything of a kind is earned', () => {
    const r = achievements([session('2026-10-01', [lift(1_000_000, 8)])]);
    expect(nextUp(r.items, 'volume')).toBeUndefined();
  });

  it('clamps progress to 0–1', () => {
    const base = { id: 'x', kind: 'volume' as const, title: '', detail: '' };
    expect(progressOf({ ...base, threshold: 10, value: 20 })).toBe(1);
    expect(progressOf({ ...base, threshold: 10, value: -1 })).toBe(0);
    expect(progressOf({ ...base, threshold: 0, value: 0 })).toBe(1);
  });
});

describe('formatMass', () => {
  it('shows kilograms up to ten tonnes, then tonnes', () => {
    expect(formatMass(480, 'kg')).toBe('480 kg');
    expect(formatMass(6_000, 'kg')).toBe('6,000 kg');
    expect(formatMass(9_999.4, 'kg')).toBe('9,999 kg');
    expect(formatMass(10_000, 'kg')).toBe('10 t');
    expect(formatMass(12_345, 'kg')).toBe('12.3 t');
    expect(formatMass(149_685, 'kg')).toBe('150 t');
    expect(formatMass(7_300_000, 'kg')).toBe('7,300 t');
  });

  it('shows pounds, and millions of them from a million', () => {
    expect(formatMass(480, 'lb')).toBe('1,058 lb');
    expect(formatMass(330_000 * KG_PER_LB, 'lb')).toBe('330,000 lb');
    expect(formatMass(2_800_000, 'lb')).toBe('6.2 million lb');
    expect(formatMass(1_000_000 * KG_PER_LB, 'lb')).toBe('1 million lb');
  });
});

describe('comparison', () => {
  it('is nothing for nothing', () => {
    expect(comparison(0)).toBeUndefined();
    expect(comparison(-5)).toBeUndefined();
    expect(comparison(Number.NaN)).toBeUndefined();
  });

  it('is a share of a piano before the first milestone, never 0%', () => {
    expect(comparison(240)).toBe('50% of a concert grand piano');
    expect(comparison(1)).toBe('1% of a concert grand piano');
  });

  it('names the biggest thing beaten', () => {
    expect(comparison(480)).toBe('a concert grand piano');
    expect(comparison(500)).toBe('a concert grand piano');
    expect(comparison(960)).toBe('2 concert grand pianos');
    expect(comparison(210_000)).toBe('1.4 blue whales');
    expect(comparison(7_300_000)).toBe('the iron of the Eiffel Tower');
    expect(comparison(73_000_000)).toBe('10 Eiffel Towers of iron');
  });

  it('rounds to whole numbers from ten', () => {
    expect(comparison(480 * 11.4)).toBe('11 concert grand pianos');
  });
});

describe('earnedLine', () => {
  const items = achievements([]).items;
  it('says each kind as done', () => {
    expect(earnedLine(byId(items, 'volume:whale'), 'kg')).toBe(
      '150 t lifted in all — a blue whale',
    );
    expect(earnedLine(byId(items, 'volume:piano'), 'lb')).toBe(
      '1,058 lb lifted in all — a concert grand piano',
    );
    expect(earnedLine(byId(items, 'sessions:1'), 'kg')).toBe('Your first workout, finished');
    expect(earnedLine(byId(items, 'sessions:250'), 'kg')).toBe('250 workouts finished');
    expect(earnedLine(byId(items, 'streak:12'), 'kg')).toBe('A run of 12 weeks');
  });
});
