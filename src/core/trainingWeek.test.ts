import { describe, expect, it } from 'vitest';
import { trainingWeek, weekStart } from './trainingWeek';
import type { WorkoutSession, WorkoutSet } from './types';

const set = (o: Partial<WorkoutSet> = {}): WorkoutSet => ({
  kind: 'normal',
  weight_kg: 100,
  reps: 5,
  done: true,
  ...o,
});

function session(
  startedAt: string,
  o: { ended?: boolean; sets?: WorkoutSet[] } = {},
): WorkoutSession {
  return {
    id: startedAt,
    user_id: 'local',
    created_at: startedAt,
    updated_at: startedAt,
    started_at: startedAt,
    ...(o.ended === false ? {} : { ended_at: startedAt }),
    name: 'Push',
    entries: [
      {
        exercise_id: 'library:0025',
        name: 'Barbell Bench Press',
        load_type: 'weight_reps',
        sets: o.sets ?? [set()],
      },
    ],
  };
}

describe('weekStart', () => {
  it('is the Monday of that week', () => {
    // 14 Oct 2026 is a Wednesday.
    expect(weekStart(new Date('2026-10-14T15:00:00')).toDateString()).toBe(
      new Date('2026-10-12T00:00:00').toDateString(),
    );
  });

  it('treats Sunday as the end of the week, not the start', () => {
    // 18 Oct 2026 is a Sunday; its week began on the 12th.
    expect(weekStart(new Date('2026-10-18T10:00:00')).toDateString()).toBe(
      new Date('2026-10-12T00:00:00').toDateString(),
    );
  });

  it('is already midnight on a Monday', () => {
    const d = weekStart(new Date('2026-10-12T23:59:00'));
    expect(d.getHours()).toBe(0);
    expect(d.toDateString()).toBe(new Date('2026-10-12T00:00:00').toDateString());
  });
});

describe('trainingWeek', () => {
  const from = new Date('2026-10-12T00:00:00');

  it('counts sessions, sets and volume', () => {
    const w = trainingWeek(
      [
        session('2026-10-12T09:00:00', { sets: [set(), set()] }),
        session('2026-10-14T09:00:00', { sets: [set()] }),
      ],
      from,
    );
    expect(w.sessions).toBe(2);
    expect(w.working_sets).toBe(3);
    expect(w.volume_kg).toBe(1500);
    expect(w.days).toEqual(['2026-10-12', '2026-10-14']);
  });

  it('leaves out anything before the week began', () => {
    const w = trainingWeek([session('2026-10-11T09:00:00'), session('2026-10-13T09:00:00')], from);
    expect(w.sessions).toBe(1);
  });

  it('leaves out the session in progress', () => {
    // Otherwise the figures move while someone is standing in the gym reading them.
    const w = trainingWeek([session('2026-10-13T09:00:00', { ended: false })], from);
    expect(w.sessions).toBe(0);
    expect(w.working_sets).toBe(0);
  });

  it('ignores warm-ups and unticked sets, as volume does everywhere', () => {
    const w = trainingWeek(
      [
        session('2026-10-13T09:00:00', {
          sets: [set({ kind: 'warmup' }), set({ done: false }), set()],
        }),
      ],
      from,
    );
    expect(w.working_sets).toBe(1);
    expect(w.volume_kg).toBe(500);
  });

  it('counts two sessions on one day as one day trained', () => {
    const w = trainingWeek([session('2026-10-13T09:00:00'), session('2026-10-13T18:00:00')], from);
    expect(w.sessions).toBe(2);
    expect(w.days).toEqual(['2026-10-13']);
  });

  it('reports sets it could not price rather than hiding them', () => {
    const s = session('2026-10-13T09:00:00');
    s.entries[0]!.load_type = 'bodyweight_reps';
    const w = trainingWeek([s], from);
    expect(w.unknown_sets).toBe(1);
    expect(w.volume_kg).toBe(0);
  });

  it('is all zeroes for a week with nothing in it', () => {
    expect(trainingWeek([], from)).toEqual({
      sessions: 0,
      working_sets: 0,
      volume_kg: 0,
      unknown_sets: 0,
      days: [],
    });
  });
});
