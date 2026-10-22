// The schedule in other time zones. Vitest runs each file in its own process, so changing TZ
// here cannot reach any other test file.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, fromDateKey } from './dates';
import { mondayOfKey, projectSchedule } from './schedule';
import type { WorkoutSession } from './types';

function sessionAt(local: Date, routine_id: string): WorkoutSession {
  const iso = local.toISOString();
  return {
    id: `${iso}-${routine_id}`,
    user_id: 'local',
    created_at: iso,
    updated_at: iso,
    started_at: iso,
    ended_at: iso,
    routine_id,
    name: routine_id,
    entries: [],
  };
}

function at(day: string, hour: number, minute = 0): Date {
  const d = fromDateKey(day);
  d.setHours(hour, minute);
  return d;
}

const ZONES: { tz: string; changes: string[] }[] = [
  { tz: 'Europe/Rome', changes: ['2026-03-29', '2026-10-25'] },
  { tz: 'America/New_York', changes: ['2026-03-08', '2026-11-01'] },
  { tz: 'Pacific/Auckland', changes: ['2026-04-05', '2026-09-27'] },
  { tz: 'Asia/Muscat', changes: [] },
];

const original = process.env.TZ;
afterAll(() => {
  if (original == null) delete process.env.TZ;
  else process.env.TZ = original;
});

const PPL = ['CT', 'BB', 'LG', 'ST', 'BB', 'LG'];

describe.each(ZONES)('in $tz', ({ tz, changes }) => {
  beforeAll(() => {
    process.env.TZ = tz;
  });

  it('is really running in that zone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(tz);
  });

  it('a session just before midnight belongs to its own day, and moves the cycle on', () => {
    // Sunday 23:59 counts on Sunday; Monday's slot is the routine after it.
    const sunday = '2026-10-18';
    const days = projectSchedule({
      cycle: PPL,
      weekdays: [1, 3, 5],
      sessions: [sessionAt(at(sunday, 23, 59), 'CT')],
      from: sunday,
      days: 2,
      today: '2026-10-19',
    });
    expect(days[0]).toMatchObject({ date: sunday, state: 'done' });
    expect(days[1]).toMatchObject({
      date: '2026-10-19',
      state: 'today',
      slot: { routine_id: 'BB' },
    });
  });

  it('weeks around each clock change keep their weekdays and their slots', () => {
    for (const day of changes) {
      const monday = mondayOfKey(day);
      expect(fromDateKey(monday).getDay()).toBe(1);
      const days = projectSchedule({
        cycle: PPL,
        weekdays: [1, 3, 5, 0],
        sessions: [],
        from: monday,
        days: 14,
        today: monday,
      });
      expect(days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6, 0]);
      expect(days.map((d) => d.date)).toEqual(
        Array.from({ length: 14 }, (_, k) => addDays(monday, k)),
      );
      expect(days.filter((d) => d.slot).map((d) => d.slot!.routine_id)).toEqual([
        'CT',
        'BB',
        'LG',
        'ST',
        'BB',
        'LG',
        'CT',
        'BB',
      ]);
    }
  });
});
