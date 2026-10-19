// SPEC §20.2 — the exercise catalogue: a seeded library plus whatever the user adds.
//
// Mirrors repo/foods.ts, including the split that matters for sync: library rows are
// regenerable from a CC0 source and never leave the device, so only `custom` ones are offered
// to the sync engine (see sync/local.ts).
import { buildExerciseDoc, type ExerciseDoc } from '@/core/exerciseSearch';
import type { Exercise, SyncMeta } from '@/core/types';
import { db, isLive, LOCAL_USER_ID, newMeta, nowIso } from '../db';

export async function getExercise(id: string): Promise<Exercise | undefined> {
  const row = await db.exercises.get(id);
  return row && isLive(row) ? row : undefined;
}

export async function getExercises(ids: readonly string[]): Promise<Map<string, Exercise>> {
  const rows = await db.exercises.bulkGet([...ids]);
  const out = new Map<string, Exercise>();
  for (const r of rows) if (r && isLive(r)) out.set(r.id, r);
  return out;
}

/** Chunked like the food seed, so the library lands while the first screen stays responsive. */
export async function bulkPutExercises(rows: readonly Exercise[], chunk = 150): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    await db.exercises.bulkPut(rows.slice(i, i + chunk));
    if (i + chunk < rows.length) await new Promise((r) => setTimeout(r, 0));
  }
}

export async function countExercises(): Promise<number> {
  return db.exercises.count();
}

/** Projection of every live exercise for the in-memory search index. */
export async function listExerciseDocs(): Promise<ExerciseDoc[]> {
  const docs: ExerciseDoc[] = [];
  await db.exercises.each((e) => {
    if (isLive(e)) docs.push(buildExerciseDoc(e));
  });
  return docs;
}

/** Everything a program may be written from: live strength movements, library and own alike. */
export async function listStrengthExercises(): Promise<Exercise[]> {
  const out: Exercise[] = [];
  await db.exercises.each((e) => {
    if (isLive(e) && e.category === 'strength') out.push(e);
  });
  return out;
}

/** The user's own exercises, newest first. The library is reached through search instead. */
export async function listCustomExercises(): Promise<Exercise[]> {
  const rows = await db.exercises.where('source').equals('custom').toArray();
  return rows
    .filter((e) => e.user_id === LOCAL_USER_ID && isLive(e))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export type ExerciseInput = Omit<Exercise, keyof SyncMeta>;

export async function addExercise(input: ExerciseInput, id?: string): Promise<Exercise> {
  const row: Exercise = { ...newMeta(id), ...input };
  await db.exercises.add(row);
  return row;
}

/** Patch; a property set to `undefined` is removed from the row (Dexie semantics). */
export async function updateExercise(
  id: string,
  patch: { [K in keyof ExerciseInput]?: ExerciseInput[K] | undefined },
): Promise<void> {
  await db.exercises.update(id, { ...patch, updated_at: nowIso() } as Partial<Exercise>);
}

export async function deleteExercise(id: string): Promise<void> {
  const ts = nowIso();
  await db.exercises.update(id, { deleted_at: ts, updated_at: ts });
}

export async function restoreExercise(id: string): Promise<void> {
  await db.exercises.update(id, { deleted_at: null, updated_at: nowIso() });
}

/** Everything, deleted rows included, for backup and sync. */
export async function listAllExercises(): Promise<Exercise[]> {
  return db.exercises.toArray();
}

/** Only the user's own: the library is regenerable and has no business in a backup or on a wire. */
export async function listCustomExercisesForSync(): Promise<Exercise[]> {
  return db.exercises.where('source').equals('custom').toArray();
}
