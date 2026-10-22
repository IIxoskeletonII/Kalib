// SPEC §20.19 — the mainstream catalogue, laid over the open library.
//
// The library is complete in the way an anatomy atlas is complete: 1,394 movements, every one
// named for what it is ("Lever Seated Fly", "Dumbbell Incline Bench Press"). What it is not is
// the list a gym works from. Someone looking for the pec deck types "pec deck"; someone reading
// a program written in Hevy or Strong reads "Incline Bench Press (Dumbbell)". And a handful of
// staples — the face pull, the barbell hip thrust — are simply not in it.
//
// So `data/exercises-curated.json` names the few hundred exercises people actually do, and this
// folds it in. A curated row keeps its library id, so a routine or a logged session that points
// at it keeps working; its textbook name stays searchable as an alias. Movements the library
// lacks are added under ids of their own. Everything curated is `popular`, which is what the
// picker shows first and what search ranks above the obscure variants.
//
// Pure, so the seed script and the tests run the same code over the same file.
import { autoAliases, loadTypeFor } from './exercises';
import type { SeedExercise } from './exerciseSeed';
import {
  MUSCLES,
  type ExerciseCategory,
  type ExerciseDifficulty,
  type LoadType,
  type Muscle,
} from './types';

export interface CuratedRename {
  name: string;
  /** Typing one of these in full names this exercise outright. One owner per phrase. */
  shorthand?: string[];
  /** Further words it should match on, without the claim shorthand makes. */
  aliases?: string[];
  /** A correction to the library's muscles, where it files a squat under glutes. */
  primary?: string;
  secondary?: string[];
  load_type?: string;
  /** Renamed for clarity but not one people reach for: kept out of the popular list. */
  popular?: boolean;
}

export interface CuratedAddition extends CuratedRename {
  /** Stable for ever: routines and history will point at `library:<id>`. */
  id: string;
  category: string;
  equipment: string;
  primary: string;
  secondary: string[];
  difficulty?: string;
  instructions: string[];
}

export interface CuratedFile {
  library: Record<string, CuratedRename>;
  added: CuratedAddition[];
}

const LOAD_TYPES: readonly LoadType[] = [
  'weight_reps',
  'bodyweight_reps',
  'weighted_bodyweight',
  'time',
  'distance_time',
];
const CATEGORIES: readonly ExerciseCategory[] = [
  'strength',
  'stretching',
  'cardio',
  'mobility',
  'plyometrics',
  'rehabilitation',
  'balance',
];
const DIFFICULTIES: readonly ExerciseDifficulty[] = ['beginner', 'intermediate', 'advanced'];

/** Ids Kalib writes itself; never colliding with the library's numeric ones. */
export const ADDED_ID = /^kalib-[a-z0-9-]+$/;

/** Lower-case, single-spaced: the form shorthand and names are compared in. */
export function phraseKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function muscle(s: string, where: string): Muscle {
  if (!(MUSCLES as readonly string[]).includes(s)) {
    throw new Error(`${where}: "${s}" is not one of the muscles this app counts`);
  }
  return s as Muscle;
}

function loadType(s: string, where: string): LoadType {
  if (!(LOAD_TYPES as readonly string[]).includes(s)) {
    throw new Error(`${where}: "${s}" is not a load type`);
  }
  return s as LoadType;
}

function uniq(xs: readonly string[], drop: string): string[] {
  const out: string[] = [];
  for (const x of xs.map(phraseKey)) if (x && x !== drop && !out.includes(x)) out.push(x);
  return out;
}

/**
 * The library with the curated catalogue laid over it. Throws, rather than quietly doing
 * something else, on anything that would make the result ambiguous: a rename pointing at a row
 * that is not there, two exercises sharing a display name, one phrase claimed as shorthand by
 * two exercises (or that is another exercise's whole name), a muscle or load type the app does
 * not know. Every problem is listed at once, so a bad edit is fixed in one pass.
 */
export function applyCurated(base: readonly SeedExercise[], curated: CuratedFile): SeedExercise[] {
  const byExternal = new Map(base.map((e) => [e.external_id, e]));
  const orphans = Object.keys(curated.library).filter((k) => !byExternal.has(k));
  if (orphans.length) {
    throw new Error(`curated renames point at exercises not in the library: ${orphans.join(', ')}`);
  }

  // Phrases a human assigned. A former name yields to one of these: "air bike" was the library's
  // name for a bicycle crunch, but it is what everyone calls the fan bike.
  const claimed = new Set(
    [...Object.values(curated.library), ...curated.added].flatMap((c) =>
      (c.shorthand ?? []).map(phraseKey),
    ),
  );

  const out: SeedExercise[] = base.map((full) => {
    // Shorthand and popularity are this file's to give: whatever an older build said is dropped.
    const e: SeedExercise = { ...full };
    delete e.shorthand;
    delete e.popular;
    const c = e.external_id ? curated.library[e.external_id] : undefined;
    if (!c) return e;
    const where = `curated ${e.external_id}`;
    const name = c.name.trim();
    const key = phraseKey(name);
    const original = phraseKey(e.name);
    // The textbook name, typed in full, still names this exercise outright: it is nobody
    // else's, and a program printed with it should land here and not on a near neighbour.
    const shorthand = uniq(
      [...(c.shorthand ?? []), ...(claimed.has(original) ? [] : [original])],
      key,
    );
    const aliases = uniq(
      [
        ...autoAliases(name),
        // The textbook name stays findable: someone who learned it, or a program that prints
        // it, still lands here.
        ...(original !== key ? [original, ...autoAliases(e.name)] : []),
        ...(c.aliases ?? []),
        ...shorthand,
      ],
      key,
    );
    const primary = c.primary ? muscle(c.primary, where) : e.primary_muscle;
    const secondary = (c.secondary ?? e.secondary_muscles)
      .map((m) => muscle(m, where))
      .filter((m) => m !== primary);
    const row: SeedExercise = {
      ...e,
      name,
      primary_muscle: primary,
      secondary_muscles: secondary,
      load_type: c.load_type ? loadType(c.load_type, where) : e.load_type,
    };
    if (c.popular !== false) row.popular = true;
    if (aliases.length) row.aliases = aliases;
    else delete row.aliases;
    if (shorthand.length) row.shorthand = shorthand;
    else delete row.shorthand;
    return row;
  });

  for (const a of curated.added) {
    const where = `curated addition ${a.id}`;
    if (!ADDED_ID.test(a.id)) throw new Error(`${where}: ids are kalib-<slug>`);
    if (byExternal.has(a.id)) throw new Error(`${where}: id already in the library`);
    if (!(CATEGORIES as readonly string[]).includes(a.category)) {
      throw new Error(`${where}: unknown category ${a.category}`);
    }
    if (!a.instructions?.length) throw new Error(`${where}: an added exercise needs instructions`);
    const name = a.name.trim();
    const key = phraseKey(name);
    const shorthand = uniq(a.shorthand ?? [], key);
    const category = a.category as ExerciseCategory;
    const primary = muscle(a.primary, where);
    const aliases = uniq([...autoAliases(name), ...(a.aliases ?? []), ...shorthand], key);
    const row: SeedExercise = {
      id: `library:${a.id}`,
      external_id: a.id,
      name,
      category,
      primary_muscle: primary,
      secondary_muscles: a.secondary.map((m) => muscle(m, where)).filter((m) => m !== primary),
      equipment: a.equipment,
      load_type: a.load_type
        ? loadType(a.load_type, where)
        : loadTypeFor({ name, equipment: a.equipment, category }),
      instructions: a.instructions,
      popular: true,
    };
    if (a.difficulty) {
      if (!(DIFFICULTIES as readonly string[]).includes(a.difficulty)) {
        throw new Error(`${where}: unknown difficulty ${a.difficulty}`);
      }
      row.difficulty = a.difficulty as ExerciseDifficulty;
    }
    if (aliases.length) row.aliases = aliases;
    if (shorthand.length) row.shorthand = shorthand;
    out.push(row);
  }

  const problems: string[] = [];
  const names = new Map<string, string>();
  for (const e of out) {
    const k = phraseKey(e.name);
    const prior = names.get(k);
    if (prior) problems.push(`two exercises are called "${e.name}": ${prior} and ${e.id}`);
    else names.set(k, e.id);
  }

  const owners = new Map<string, string>();
  for (const e of out) {
    for (const s of e.shorthand ?? []) {
      const prior = owners.get(s);
      if (prior) problems.push(`shorthand "${s}" is claimed by both ${prior} and ${e.id}`);
      else owners.set(s, e.id);
    }
  }
  // A shorthand that is some other exercise's whole name would make that name lose to it.
  for (const [s, id] of owners) {
    const named = names.get(s);
    if (named && named !== id) problems.push(`shorthand "${s}" on ${id} is the name of ${named}`);
  }
  if (problems.length) throw new Error(`curated catalogue:\n  ${problems.join('\n  ')}`);

  return out;
}
