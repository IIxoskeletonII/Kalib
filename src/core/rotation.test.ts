import { describe, expect, it } from 'vitest';
import { cyclePosition, nextRoutine } from './rotation';
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

// §20.17: a cycle that names a routine more than once. The user's own week: push, pull, legs,
// with the push day alternating chest and shoulders.
describe('cyclePosition and nextRoutine with a repeating cycle', () => {
  const CT = routine('CT', 0); // Chest & Tri
  const BB = routine('BB', 1); // Back & Bi
  const LG = routine('LG', 2); // Legs
  const ST = routine('ST', 3); // Shoulders & Tri
  const ALL = [CT, BB, LG, ST];
  const PPL = ['CT', 'BB', 'LG', 'ST', 'BB', 'LG'];

  it('starts at the first slot with nothing done', () => {
    expect(cyclePosition(PPL, [])).toEqual({ next: 0 });
    expect(nextRoutine(ALL, [], NOW, PPL)?.routine.id).toBe('CT');
  });

  it('has nothing to say about an empty cycle', () => {
    expect(cyclePosition([], [done('2026-10-18', 'CT')])).toBeUndefined();
    expect(nextRoutine(ALL, [], NOW, [])).toBeUndefined();
  });

  it('walks the whole lap in order, telling the two pulls and the two leg days apart', () => {
    const days = ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12', '2026-10-14'];
    const expected = ['BB', 'LG', 'ST', 'BB', 'LG', 'CT'];
    for (let k = 0; k <= days.length; k++) {
      const history = days.slice(0, k).map((d, i) => done(d, PPL[i]));
      const r = nextRoutine(ALL, history, NOW, PPL);
      expect(r?.routine.id, `after ${k} sessions`).toBe(k === 0 ? 'CT' : expected[k - 1]);
    }
  });

  it('knows the second Back & Bi follows Shoulders & Tri, not Chest & Tri', () => {
    const history = [done('2026-10-12', 'ST'), done('2026-10-14', 'BB')];
    expect(cyclePosition(PPL, history)).toMatchObject({ last: 4, next: 5 });
    expect(nextRoutine(ALL, history, NOW, PPL)?.routine.id).toBe('LG');
  });

  it('after the second leg day comes Chest & Tri again', () => {
    const history = [done('2026-10-12', 'ST'), done('2026-10-14', 'BB'), done('2026-10-16', 'LG')];
    expect(cyclePosition(PPL, history)).toMatchObject({ last: 5, next: 0 });
  });

  it('reads further back when the last two sessions match two places', () => {
    // BB, LG appear at slots 1–2 and 4–5; CT before them settles it at 1–2.
    const history = [done('2026-10-09', 'CT'), done('2026-10-12', 'BB'), done('2026-10-14', 'LG')];
    expect(cyclePosition(PPL, history)).toMatchObject({ last: 2, next: 3 });
  });

  it('takes the earliest slot when history cannot tell', () => {
    expect(cyclePosition(PPL, [done('2026-10-14', 'BB')])).toMatchObject({ last: 1, next: 2 });
  });

  it('done out of order, carries on from the routine actually done', () => {
    // Legs done straight after Chest & Tri: skip ahead to after legs, not back to Back & Bi.
    const history = [done('2026-10-12', 'CT'), done('2026-10-14', 'LG')];
    expect(nextRoutine(ALL, history, NOW, PPL)?.routine.id).toBe('ST');
  });

  it('ignores sessions of routines not in the cycle, and deleted sessions', () => {
    const arms = done('2026-10-15', 'ARMS');
    const gone = { ...done('2026-10-16', 'LG'), deleted_at: '2026-10-16T14:00:00.000Z' };
    const history = [done('2026-10-14', 'CT'), arms, gone];
    expect(cyclePosition(PPL, history)).toMatchObject({ last: 0, next: 1 });
  });

  it('a cycle of one is always that routine', () => {
    expect(cyclePosition(['CT'], [done('2026-10-14', 'CT')])).toMatchObject({ next: 0, last: 0 });
  });

  it('drops ids that no longer name a routine before placing the cycle', () => {
    // ST deleted: the cycle reads CT, BB, LG, BB, LG.
    const r = nextRoutine([CT, BB, LG], [done('2026-10-14', 'CT')], NOW, PPL);
    expect(r?.routine.id).toBe('BB');
  });

  it('is unchanged from the plain rotation when nothing repeats', () => {
    const h = [done('2026-10-13', 'A'), done('2026-10-15', 'B')];
    expect(nextRoutine([A, B, C], h, NOW, ['A', 'B', 'C'])).toEqual(nextRoutine([A, B, C], h, NOW));
  });

  it('two sessions at the same instant do not break the ordering', () => {
    const same = new Date('2026-10-14T12:00:00').toISOString();
    const a = { ...done('2026-10-14', 'CT'), started_at: same };
    const b = { ...done('2026-10-14', 'CT'), id: 'x', started_at: same };
    expect(cyclePosition(PPL, [a, b])?.next).toBe(1);
  });
});
