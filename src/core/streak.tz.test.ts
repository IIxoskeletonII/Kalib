// The streak in other time zones. Vitest runs each file in its own process, so changing TZ
// here cannot reach any other test file.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, fromDateKey, toDateKey } from './dates';
import { mondayOf, trainedDays, trainingStreak } from './streak';
import type { WorkoutSession } from './types';

function sessionAt(local: Date): WorkoutSession {
  const iso = local.toISOString();
  return {
    id: iso,
    user_id: 'local',
    created_at: iso,
    updated_at: iso,
    started_at: iso,
    ended_at: iso,
    name: 'Day',
    entries: [
      {
        exercise_id: 'bench',
        name: 'Bench',
        load_type: 'weight_reps',
        sets: [{ kind: 'normal', done: true, weight_kg: 60, reps: 8 }],
      },
    ],
  };
}

/** Local wall-clock time on a day, in whatever zone the process is in. */
function at(day: string, hour: number, minute = 0): Date {
  const d = fromDateKey(day);
  d.setHours(hour, minute);
  return d;
}

const ZONES: { tz: string; changes: string[] }[] = [
  // Days the clocks change in 2026, and the Sunday or Saturday either side.
  { tz: 'Europe/Rome', changes: ['2026-03-29', '2026-10-25'] },
  { tz: 'America/New_York', changes: ['2026-03-08', '2026-11-01'] },
  { tz: 'Pacific/Auckland', changes: ['2026-04-05', '2026-09-27'] },
  { tz: 'Asia/Muscat', changes: [] },
  { tz: 'Pacific/Kiritimati', changes: [] },
];

const original = process.env.TZ;
afterAll(() => {
  if (original == null) delete process.env.TZ;
  else process.env.TZ = original;
});

describe.each(ZONES)('in $tz', ({ tz, changes }) => {
  beforeAll(() => {
    process.env.TZ = tz;
  });

  it('is really running in that zone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(tz);
  });

  it('puts a session just before and just after midnight on the right days', () => {
    const late = sessionAt(at('2026-10-18', 23, 59)); // Sunday
    const early = sessionAt(at('2026-10-19', 0, 1)); // Monday
    expect([...trainedDays([late, early])].sort()).toEqual(['2026-10-18', '2026-10-19']);
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
  });

  it('keeps the weeks around each clock change seven days long', () => {
    for (const day of changes) {
      const monday = mondayOf(day);
      expect(fromDateKey(monday).getDay()).toBe(1);
      expect(addDays(monday, 7)).toBe(toDateKey(at(addDays(monday, 7), 12)));
      // A late session on the change day stays in its own week.
      const s = sessionAt(at(day, 23, 30));
      expect([...trainedDays([s])]).toEqual([day]);
      const streak = trainingStreak(
        [sessionAt(at(addDays(monday, -7), 18)), s],
        addDays(monday, 8),
        { aims: [{ from: '2000-01-03', sessions: 1 }] },
      );
      expect(streak.history.map((w) => w.monday)).toEqual([
        addDays(monday, -7),
        monday,
        addDays(monday, 7),
      ]);
      expect(streak.current.weeks).toBe(2);
    }
  });

  it('runs a year of weekly sessions without losing or gaining a week', () => {
    const start = '2026-01-05';
    const sessions = Array.from({ length: 52 }, (_, k) => sessionAt(at(addDays(start, 7 * k), 7)));
    const s = trainingStreak(sessions, addDays(start, 52 * 7 - 1));
    expect(s.history).toHaveLength(52);
    expect(s.current.weeks).toBe(52);
  });
});
