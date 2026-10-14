import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkoutEntry } from '@/core/types';
import { db } from '../db';
import {
  addExercise,
  deleteExercise,
  getExercise,
  listCustomExercises,
  listCustomExercisesForSync,
  listExerciseDocs,
  restoreExercise,
  updateExercise,
  type ExerciseInput,
} from './exercises';
import {
  activeSession,
  addRoutine,
  addSession,
  deleteRoutine,
  deleteSession,
  getRoutine,
  listRoutines,
  listSessions,
  nextRoutineOrder,
  reorderRoutines,
  restoreRoutine,
  sessionsSince,
  updateSession,
  type RoutineInput,
  type WorkoutSessionInput,
} from './workouts';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

function exercise(over: Partial<ExerciseInput> = {}): ExerciseInput {
  return {
    source: 'custom',
    name: 'Trap Bar Deadlift',
    category: 'strength',
    primary_muscle: 'glutes',
    secondary_muscles: ['quads', 'lower back'],
    equipment: 'trap bar',
    load_type: 'weight_reps',
    ...over,
  };
}

function routine(over: Partial<RoutineInput> = {}): RoutineInput {
  return {
    name: 'Push A',
    items: [
      {
        exercise_id: 'library:0025',
        name: 'Barbell Bench Press',
        load_type: 'weight_reps',
        sets: 3,
        rep_low: 5,
        rep_high: 8,
      },
    ],
    sort_order: 0,
    source: 'own',
    ...over,
  };
}

const entry = (over: Partial<WorkoutEntry> = {}): WorkoutEntry => ({
  exercise_id: 'library:0025',
  name: 'Barbell Bench Press',
  load_type: 'weight_reps',
  sets: [{ kind: 'normal', weight_kg: 80, reps: 8, done: true }],
  ...over,
});

function session(over: Partial<WorkoutSessionInput> = {}): WorkoutSessionInput {
  return {
    started_at: '2026-10-14T09:00:00.000Z',
    name: 'Push A',
    entries: [entry()],
    ...over,
  };
}

describe('exercises repo', () => {
  it('round-trips a custom exercise', async () => {
    const e = await addExercise(exercise());
    expect(await getExercise(e.id)).toMatchObject({ name: 'Trap Bar Deadlift', source: 'custom' });
  });

  it('hides a deleted exercise but keeps the row for sync', async () => {
    const e = await addExercise(exercise());
    await deleteExercise(e.id);
    expect(await getExercise(e.id)).toBeUndefined();
    expect(await listCustomExercises()).toEqual([]);
    // The row survives, carrying deleted_at, so the delete reaches the other phone.
    expect(await listCustomExercisesForSync()).toHaveLength(1);
  });

  it('restores a deleted exercise', async () => {
    const e = await addExercise(exercise());
    await deleteExercise(e.id);
    await restoreExercise(e.id);
    expect(await getExercise(e.id)).toBeDefined();
  });

  it('bumps updated_at on every change, because sync is last-write-wins', async () => {
    const e = await addExercise(exercise());
    await new Promise((r) => setTimeout(r, 2));
    await updateExercise(e.id, { name: 'Hex Bar Deadlift' });
    const after = await getExercise(e.id);
    expect(after!.updated_at > e.updated_at).toBe(true);
  });

  it('offers only custom exercises to sync, never the library', async () => {
    await addExercise(exercise());
    await addExercise(exercise({ source: 'library', name: 'Barbell Bench Press' }));
    const forSync = await listCustomExercisesForSync();
    expect(forSync.map((e) => e.name)).toEqual(['Trap Bar Deadlift']);
  });

  it('indexes live exercises for search, library and custom alike', async () => {
    await addExercise(exercise());
    await addExercise(exercise({ source: 'library', name: 'Barbell Bench Press' }));
    const docs = await listExerciseDocs();
    expect(docs.map((d) => d.name).sort()).toEqual(['Barbell Bench Press', 'Trap Bar Deadlift']);
    expect(docs.find((d) => d.name === 'Trap Bar Deadlift')!.custom).toBe(true);
  });
});

describe('routines repo', () => {
  it('lists in the chosen order, not insertion order', async () => {
    await addRoutine(routine({ name: 'Legs', sort_order: 2 }));
    await addRoutine(routine({ name: 'Push', sort_order: 0 }));
    await addRoutine(routine({ name: 'Pull', sort_order: 1 }));
    expect((await listRoutines()).map((r) => r.name)).toEqual(['Push', 'Pull', 'Legs']);
  });

  it('reorders atomically', async () => {
    const a = await addRoutine(routine({ name: 'A', sort_order: 0 }));
    const b = await addRoutine(routine({ name: 'B', sort_order: 1 }));
    const c = await addRoutine(routine({ name: 'C', sort_order: 2 }));
    await reorderRoutines([c.id, a.id, b.id]);
    expect((await listRoutines()).map((r) => r.name)).toEqual(['C', 'A', 'B']);
  });

  it('puts a new routine at the end', async () => {
    expect(await nextRoutineOrder()).toBe(0);
    await addRoutine(routine({ sort_order: 0 }));
    await addRoutine(routine({ name: 'Pull', sort_order: 1 }));
    expect(await nextRoutineOrder()).toBe(2);
  });

  it('soft-deletes and restores', async () => {
    const r = await addRoutine(routine());
    await deleteRoutine(r.id);
    expect(await getRoutine(r.id)).toBeUndefined();
    await restoreRoutine(r.id);
    expect(await getRoutine(r.id)).toBeDefined();
  });

  it('keeps embedded items intact through a round trip', async () => {
    const r = await addRoutine(routine());
    const back = await getRoutine(r.id);
    expect(back!.items[0]).toMatchObject({ sets: 3, rep_low: 5, rep_high: 8 });
  });
});

describe('sessions repo', () => {
  it('finds the running session and ignores finished ones', async () => {
    await addSession(
      session({ started_at: '2026-10-13T09:00:00.000Z', ended_at: '2026-10-13T10:00:00.000Z' }),
    );
    const live = await addSession(session());
    expect((await activeSession())!.id).toBe(live.id);
  });

  it('has no active session once it is finished', async () => {
    const s = await addSession(session());
    await updateSession(s.id, { ended_at: '2026-10-14T10:00:00.000Z' });
    expect(await activeSession()).toBeUndefined();
  });

  it('returns the newest running session if a crash ever left two', async () => {
    await addSession(session({ started_at: '2026-10-14T07:00:00.000Z' }));
    const newer = await addSession(session({ started_at: '2026-10-14T09:00:00.000Z' }));
    expect((await activeSession())!.id).toBe(newer.id);
  });

  it('lists finished sessions newest first and leaves the running one out', async () => {
    await addSession(
      session({
        started_at: '2026-10-12T09:00:00.000Z',
        ended_at: '2026-10-12T10:00:00.000Z',
        name: 'Old',
      }),
    );
    await addSession(
      session({
        started_at: '2026-10-13T09:00:00.000Z',
        ended_at: '2026-10-13T10:00:00.000Z',
        name: 'New',
      }),
    );
    await addSession(session({ name: 'Running' }));
    expect((await listSessions()).map((s) => s.name)).toEqual(['New', 'Old']);
  });

  it('respects a limit', async () => {
    for (let i = 1; i <= 5; i++) {
      await addSession(
        session({
          started_at: `2026-10-0${i}T09:00:00.000Z`,
          ended_at: `2026-10-0${i}T10:00:00.000Z`,
        }),
      );
    }
    expect(await listSessions(2)).toHaveLength(2);
  });

  it('returns a window oldest first, which is what every derived figure wants', async () => {
    await addSession(
      session({
        started_at: '2026-09-01T09:00:00.000Z',
        ended_at: '2026-09-01T10:00:00.000Z',
        name: 'Before',
      }),
    );
    await addSession(
      session({
        started_at: '2026-10-05T09:00:00.000Z',
        ended_at: '2026-10-05T10:00:00.000Z',
        name: 'A',
      }),
    );
    await addSession(
      session({
        started_at: '2026-10-10T09:00:00.000Z',
        ended_at: '2026-10-10T10:00:00.000Z',
        name: 'B',
      }),
    );
    expect((await sessionsSince('2026-10-01')).map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('keeps embedded sets intact, including the ones not yet done', async () => {
    const s = await addSession(
      session({
        entries: [
          entry({
            sets: [
              { kind: 'warmup', weight_kg: 40, reps: 10, done: true },
              { kind: 'normal', weight_kg: 80, reps: 8, rir: 2, done: true },
              { kind: 'normal', weight_kg: 80, reps: 0, done: false },
            ],
          }),
        ],
      }),
    );
    await updateSession(s.id, { ended_at: '2026-10-14T10:05:00.000Z' });
    const back = (await listSessions())[0]!;
    expect(back.entries[0]!.sets).toHaveLength(3);
    expect(back.entries[0]!.sets[1]).toMatchObject({ weight_kg: 80, reps: 8, rir: 2, done: true });
    expect(back.entries[0]!.sets[2]!.done).toBe(false);
  });

  it('a deleted session disappears from history and from the active slot', async () => {
    const s = await addSession(session());
    await deleteSession(s.id);
    expect(await activeSession()).toBeUndefined();
    expect(await listSessions()).toEqual([]);
  });
});
