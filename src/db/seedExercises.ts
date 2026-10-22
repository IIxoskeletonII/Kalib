// SPEC §20.2 — loading the exercise library on first run.
//
// Mirrors db/seed.ts, which does the same for food, including the version-in-the-URL trick: the
// service worker caches /data/* first-hand, so a new EXERCISE_SEED_VERSION has to be a new
// address or the old file would be served forever.
//
// The library replaces itself wholesale on a version bump. That is safe because every row is
// regenerated from the same CC0 source and the user's own exercises live under a different
// `source` and are never touched. Rows are matched by their deterministic `library:<id>` key,
// so a routine that references one keeps working across a re-seed.
//
// A re-seed may rename (§20.19: "Lever Seated Fly" became "Pec Deck (Machine)"). A routine
// carries a copy of each exercise's name, so its rows are brought along — but only where the
// copy is still the old library name. Logged sessions are left exactly as they were: they are a
// record of what was done, under the name it was done under.
import { phraseKey } from '@/core/exerciseCatalogue';
import type { ExerciseSeedFile } from '@/core/exerciseSeed';
import type { Exercise } from '@/core/types';
import { LOCAL_USER_ID, nowIso } from './db';
import { bulkPutExercises } from './repo/exercises';
import { getSetting, setSetting } from './repo/settings';
import { listRoutines, updateRoutine } from './repo/workouts';

/**
 * Bump when public/data/exercises.json is regenerated with different content.
 *
 * 2 — §20.19, the mainstream catalogue: 211 renames, 32 additions, `popular`.
 */
export const EXERCISE_SEED_VERSION = 2;

const KEY = 'seed_version:exercises';
const URL_PATH = '/data/exercises.json';

export async function areExercisesSeeded(): Promise<boolean> {
  return (await getSetting<number>(KEY)) === EXERCISE_SEED_VERSION;
}

/**
 * Routine rows still carrying an exercise's former name, renamed to its current one. A former
 * name is recognised because the catalogue keeps it as an alias (§20.19); a name that is not
 * one — something written by hand — is left alone. Depends on nothing but the library as it now
 * stands, so it is safe to run again after an interruption. Returns how many routines changed.
 */
export async function renameRoutineItems(
  library: ReadonlyMap<string, Pick<Exercise, 'name' | 'aliases'>>,
): Promise<number> {
  let touched = 0;
  for (const r of await listRoutines()) {
    let changed = false;
    const items = r.items.map((it) => {
      const e = library.get(it.exercise_id);
      if (!e || it.name === e.name || !e.aliases?.includes(phraseKey(it.name))) return it;
      changed = true;
      return { ...it, name: e.name };
    });
    if (changed) {
      await updateRoutine(r.id, { items });
      touched++;
    }
  }
  return touched;
}

/**
 * Loads the library if it is not already at this version. Safe to call on every launch, and
 * resumes if an earlier run was interrupted — a partial `bulkPut` just gets redone, because the
 * version is only recorded once every row has landed.
 */
export async function ensureExercisesSeeded(onProgress?: (done: boolean) => void): Promise<void> {
  if (await areExercisesSeeded()) return;
  onProgress?.(false);
  const res = await fetch(`${URL_PATH}?v=${EXERCISE_SEED_VERSION}`);
  if (!res.ok) throw new Error(`Exercise seed fetch failed (${res.status})`);
  if (!(res.headers.get('content-type') ?? '').includes('json')) {
    // The SPA fallback answering with index.html would parse as JSON garbage; say so plainly.
    throw new Error(`Exercise seed came back as ${res.headers.get('content-type')}`);
  }
  const data = (await res.json()) as ExerciseSeedFile;
  if (data.format !== 1 || !Array.isArray(data.exercises)) {
    throw new Error('Unexpected exercise seed file');
  }
  const ts = nowIso();
  const rows: Exercise[] = data.exercises.map((e) => ({
    ...e,
    user_id: LOCAL_USER_ID,
    source: 'library',
    created_at: ts,
    updated_at: ts,
  }));
  await bulkPutExercises(rows);
  // Before the version is recorded, so an interrupted run redoes this too. Redoing it is
  // harmless: a row already renamed no longer carries the old name.
  await renameRoutineItems(new Map(rows.map((e) => [e.id, e])));
  await setSetting(KEY, EXERCISE_SEED_VERSION);
  onProgress?.(true);
}
