import { describe, expect, it } from 'vitest';
import { nextRoutine } from './rotation';
import type { Routine, WorkoutSession } from './types';

const meta = { user_id: 'local', created_at: '', updated_at: '' };

const routine = (id: string, sort_order: number): Routine => ({
  ...meta,
  id,
  name: id,
  items: [],
  sort_order,
  source: 'own',
});

const A = routine('A', 0);
const B = routine('B', 1);
const C = routine('C', 2);

/** A finished session on a local day, at noon so no time zone moves it across midnight. */
const done = (day: string, routine_id?: string, ended = true): WorkoutSession => ({
  ...meta,
  id: `${day}-${routine_id ?? 'empty'}`,
  started_at: new Date(`${day}T12:00:00`).toISOString(),
  ...(ended ? { ended_at: new Date(`${day}T13:00:00`).toISOString() } : {}),
  ...(routine_id ? { routine_id } : {}),
  name: routine_id ?? 'Workout',
  entries: [],
});

const NOW = new Date('2026-10-19T09:00:00');

describe('nextRoutine', () => {
  it('has nothing to say without routines', () => {
    expect(nextRoutine([], [done('2026-10-18', 'A')], NOW)).toBeUndefined();
  });

  it('starts at the top of the list when nothing has been done', () => {
    expect(nextRoutine([A, B, C], [], NOW)).toEqual({ routine: A, trained_today: false });
  });

  it('is the one after the most recent, whatever order the history arrives in', () => {
    const r = nextRoutine([A, B, C], [done('2026-10-13', 'A'), done('2026-10-15', 'B')], NOW);
    expect(r?.routine.id).toBe('C');
    expect(r?.after?.id).toBe('B');
    expect(r?.after_date).toBe('2026-10-15');
    const reversed = nextRoutine(
      [A, B, C],
      [done('2026-10-15', 'B'), done('2026-10-13', 'A')],
      NOW,
    );
    expect(reversed?.routine.id).toBe('C');
  });

  it('wraps from the last day back to the first', () => {
    expect(nextRoutine([A, B, C], [done('2026-10-17', 'C')], NOW)?.routine.id).toBe('A');
  });

  it('does not skip a day that was missed: a rotation, not a calendar', () => {
    // A was ten days ago. B is still next, not whichever day the calendar would have reached.
    expect(nextRoutine([A, B, C], [done('2026-10-09', 'A')], NOW)?.routine.id).toBe('B');
  });

  it('ignores an empty workout, which belongs to no rotation', () => {
    const r = nextRoutine([A, B, C], [done('2026-10-15', 'A'), done('2026-10-17')], NOW);
    expect(r?.routine.id).toBe('B');
  });

  it('ignores a session still running', () => {
    const r = nextRoutine(
      [A, B, C],
      [done('2026-10-15', 'A'), done('2026-10-19', 'B', false)],
      NOW,
    );
    expect(r?.routine.id).toBe('B');
  });

  it('looks past a deleted routine to the last one that still exists', () => {
    // B was done last and then deleted; the list is now A, C.
    const r = nextRoutine([A, C], [done('2026-10-13', 'A'), done('2026-10-15', 'B')], NOW);
    expect(r?.routine.id).toBe('C');
    expect(r?.after?.id).toBe('A');
  });

  it('follows the order of the list it is given, so a reorder moves it', () => {
    expect(nextRoutine([A, C, B], [done('2026-10-15', 'A')], NOW)?.routine.id).toBe('C');
  });

  it('says so when today is already done, so it can point at next time', () => {
    expect(nextRoutine([A, B], [done('2026-10-19', 'A')], NOW)).toMatchObject({
      routine: B,
      trained_today: true,
    });
    expect(nextRoutine([A, B], [done('2026-10-18', 'A')], NOW)?.trained_today).toBe(false);
  });
});
