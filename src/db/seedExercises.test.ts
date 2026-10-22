// SPEC §20.19 — upgrading a phone that already has the old library, routines and history.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExerciseSeedFile } from '@/core/exerciseSeed';
import type { Exercise } from '@/core/types';
import { db, LOCAL_USER_ID } from './db';
import {
  addExercise,
  bulkPutExercises,
  countExercises,
  getExercise,
  listExerciseDocs,
} from './repo/exercises';
import { setSetting } from './repo/settings';
import { addRoutine, addSession, getRoutine, getSession } from './repo/workouts';
import {
  areExercisesSeeded,
  ensureExercisesSeeded,
  EXERCISE_SEED_VERSION,
  renameRoutineItems,
} from './seedExercises';

const seed = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'public', 'data', 'exercises.json'), 'utf8'),
) as ExerciseSeedFile;

/** What three of these rows were called before the catalogue (version 1). */
const FORMER: Record<string, string> = {
  'library:0596': 'Lever Seated Fly',
  'library:0043': 'Barbell Full Squat',
  'library:0314': 'Dumbbell Incline Bench Press',
};

/** The version-1 library: every row that existed, three under their old names, nothing popular. */
function oldLibrary(): Exercise[] {
  return seed.exercises
    .filter((e) => !e.id.startsWith('library:kalib-'))
    .map((e) => {
      const row: Exercise = {
        ...e,
        name: FORMER[e.id] ?? e.name,
        user_id: LOCAL_USER_ID,
        source: 'library',
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      };
      delete row.popular;
      delete row.shorthand;
      return row;
    });
}

function serveNew() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(seed), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function phoneOnVersionOne() {
  await bulkPutExercises(oldLibrary());
  await setSetting('seed_version:exercises', 1);
  await addExercise(
    {
      source: 'custom',
      name: 'My Odd Press',
      category: 'strength',
      primary_muscle: 'chest',
      secondary_muscles: [],
      equipment: 'cable',
      load_type: 'weight_reps',
    },
    'mine',
  );
  const routine = await addRoutine({
    name: 'Push',
    items: [
      { exercise_id: 'library:0596', name: 'Lever Seated Fly', load_type: 'weight_reps', sets: 3 },
      { exercise_id: 'library:0314', name: 'My incline', load_type: 'weight_reps', sets: 3 },
      { exercise_id: 'mine', name: 'My Odd Press', load_type: 'weight_reps', sets: 2 },
      // Not renamed by this catalogue: must come through untouched.
      { exercise_id: 'library:0001', name: '3/4 Sit-Up', load_type: 'bodyweight_reps', sets: 2 },
    ],
    sort_order: 0,
    source: 'own',
  });
  const session = await addSession({
    started_at: '2026-10-10T09:00:00.000Z',
    ended_at: '2026-10-10T10:00:00.000Z',
    name: 'Legs',
    entries: [
      {
        exercise_id: 'library:0043',
        name: 'Barbell Full Squat',
        load_type: 'weight_reps',
        sets: [{ kind: 'normal', done: true, weight_kg: 100, reps: 5 }],
      },
    ],
  });
  return { routine, session };
}

// Each test writes the whole library into fake-indexeddb once or twice.
describe('upgrading the library to the mainstream catalogue', { timeout: 30_000 }, () => {
  it('renames in place, adds the new rows, and leaves the user’s own alone', async () => {
    await phoneOnVersionOne();
    expect(await areExercisesSeeded()).toBe(false);
    serveNew();
    await ensureExercisesSeeded();

    expect(await areExercisesSeeded()).toBe(true);
    expect(await countExercises()).toBe(seed.exercises.length + 1);
    expect((await getExercise('library:0596'))?.name).toBe('Pec Deck (Machine)');
    expect((await getExercise('library:0596'))?.popular).toBe(true);
    expect((await getExercise('library:0596'))?.media).toBe('0596');
    expect((await getExercise('library:kalib-face-pull-cable'))?.name).toBe('Face Pull (Cable)');
    expect((await getExercise('library:kalib-face-pull-cable'))?.media).toBeUndefined();
    expect((await getExercise('mine'))?.name).toBe('My Odd Press');
    expect((await getExercise('mine'))?.source).toBe('custom');
  });

  it('brings routine rows along, but only the ones still carrying the old name', async () => {
    const { routine } = await phoneOnVersionOne();
    serveNew();
    await ensureExercisesSeeded();
    const items = (await getRoutine(routine.id))!.items.map((i) => [i.exercise_id, i.name]);
    expect(items).toEqual([
      ['library:0596', 'Pec Deck (Machine)'],
      // A name nobody would mistake for the library's is a choice, and stays.
      ['library:0314', 'My incline'],
      ['mine', 'My Odd Press'],
      ['library:0001', '3/4 Sit-Up'],
    ]);
  });

  it('leaves logged history exactly as it was, still pointing at a live exercise', async () => {
    const { session } = await phoneOnVersionOne();
    serveNew();
    await ensureExercisesSeeded();
    const s = (await getSession(session.id))!;
    expect(s.entries[0]!.name).toBe('Barbell Full Squat');
    expect((await getExercise(s.entries[0]!.exercise_id))?.name).toBe('Squat (Barbell)');
  });

  it('finds the renamed exercise by its old name and its new one', async () => {
    await phoneOnVersionOne();
    serveNew();
    await ensureExercisesSeeded();
    const docs = await listExerciseDocs();
    const pec = docs.find((d) => d.id === 'library:0596')!;
    expect(pec.popular).toBe(true);
    expect(pec.shorthandKeys).toContain('pec deck');
    expect(pec.shorthandKeys).toContain('lever seated fly');
  });

  it('finishes the routine renames on the next launch if the first one was cut short', async () => {
    const { routine } = await phoneOnVersionOne();
    // The library landed but the app closed before the routines were touched or the version
    // was written down.
    await bulkPutExercises(
      seed.exercises.map((e) => ({
        ...e,
        user_id: LOCAL_USER_ID,
        source: 'library' as const,
        created_at: 'x',
        updated_at: 'x',
      })),
    );
    expect((await getRoutine(routine.id))!.items[0]!.name).toBe('Lever Seated Fly');
    serveNew();
    await ensureExercisesSeeded();
    expect((await getRoutine(routine.id))!.items[0]!.name).toBe('Pec Deck (Machine)');
  });

  it('is a no-op the second time', async () => {
    const { routine } = await phoneOnVersionOne();
    serveNew();
    await ensureExercisesSeeded();
    const once = await getRoutine(routine.id);
    const fetches = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls
      .length;
    await ensureExercisesSeeded();
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      fetches,
    );
    expect(await getRoutine(routine.id)).toEqual(once);
    const library = new Map(seed.exercises.map((e) => [e.id, e]));
    expect(await renameRoutineItems(library)).toBe(0);
  });

  it('seeds a fresh phone at this version', async () => {
    serveNew();
    await ensureExercisesSeeded();
    expect(await countExercises()).toBe(seed.exercises.length);
    expect(EXERCISE_SEED_VERSION).toBe(2);
    const docs = await listExerciseDocs();
    expect(docs.filter((d) => d.popular).length).toBe(
      seed.exercises.filter((e) => e.popular).length,
    );
  });
});
