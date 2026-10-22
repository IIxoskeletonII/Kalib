// ETL: the open exercise library → public/data/exercises.json (SPEC §20.2).
// Run with `npm run seed:exercises`. Downloads are cached in .cache/ (git-ignored).
//
// Source: github.com/AbanoubAmir/open-exercise-figures, CC0 1.0 — "You may use, copy, change,
// share and sell any of this, for any purpose, without asking and without giving credit."
// 1,399 exercises with animated figures, muscles, equipment and step-by-step instructions.
// We credit it anyway, in README and in the app's About card, because taking work without
// saying where it came from is a bad habit whatever the licence permits.
//
// Three things happen here that the library does not do for us:
//
//   - its 94 muscle names collapse onto the 19 this app counts volume against (core/muscles.ts),
//     because "sets for shoulders this week" is meaningless while `delts`, `deltoids` and
//     `shoulders` are three different things;
//   - every exercise gets a load type, since the library never says whether a set is weight and
//     reps, reps alone, or seconds (core/exercises.ts);
//   - names get the shorthand a gym actually types, derived automatically (core/exercises.ts);
//   - the few hundred exercises people actually do are renamed the way a gym names them, a few
//     the library lacks are added, and all of them are marked popular (data/exercises-curated.json,
//     merged by core/exerciseCatalogue.ts, SPEC §20.19). The library calls the back squat
//     "Barbell Full Squat"; the gym calls it "Squat (Barbell)".
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCurated, type CuratedFile } from '../src/core/exerciseCatalogue';
import { autoAliases, isCameraVariant, loadTypeFor } from '../src/core/exercises';
import type { ExerciseSeedFile, SeedExercise } from '../src/core/exerciseSeed';
import { normaliseMuscle, normaliseMuscles } from '../src/core/muscles';
import type { ExerciseCategory, ExerciseDifficulty } from '../src/core/types';

const ROOT = join(import.meta.dirname, '..');
const CACHE = join(ROOT, '.cache');
const OUT = join(ROOT, 'public', 'data');

const REPO = 'AbanoubAmir/open-exercise-figures';
const SOURCE_REF =
  'Open Exercise Figures (CC0 1.0), github.com/' +
  REPO +
  "; renamed and extended by Kalib's own catalogue (data/exercises-curated.json)";
const INDEX_URL = `https://cdn.jsdelivr.net/gh/${REPO}@main/exercises.json`;

const CATEGORIES: ExerciseCategory[] = [
  'strength',
  'stretching',
  'cardio',
  'mobility',
  'plyometrics',
  'rehabilitation',
  'balance',
];
const DIFFICULTIES: ExerciseDifficulty[] = ['beginner', 'intermediate', 'advanced'];

interface RawExercise {
  id: string;
  name: string;
  category: string;
  difficulty: string;
  target: string;
  secondary_muscles: string[];
  equipment: string;
  instructions: string[];
  animation: string;
}

async function cached(url: string, file: string): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, file);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  console.log(`fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const text = await res.text();
  writeFileSync(path, text);
  return text;
}

function isCategory(s: string): s is ExerciseCategory {
  return (CATEGORIES as string[]).includes(s);
}

function isDifficulty(s: string): s is ExerciseDifficulty {
  return (DIFFICULTIES as string[]).includes(s);
}

async function main(): Promise<void> {
  const raw = JSON.parse(await cached(INDEX_URL, 'exercise-library.json')) as RawExercise[];
  const curated = JSON.parse(
    readFileSync(join(ROOT, 'data', 'exercises-curated.json'), 'utf8'),
  ) as CuratedFile;

  const base: SeedExercise[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();

  for (const r of raw) {
    // Three exercises ship twice more under a second camera angle; one entry each is plenty.
    if (isCameraVariant(r.name)) {
      dropped.push(`${r.name} (camera angle)`);
      continue;
    }
    if (!isCategory(r.category)) {
      dropped.push(`${r.name} (unknown category ${r.category})`);
      continue;
    }
    // An exercise whose target we cannot place would vanish from every volume count without
    // saying so, which is worse than not shipping it. core/muscles.test.ts guards the list.
    const primary_muscle = normaliseMuscle(r.target);
    if (!primary_muscle) {
      dropped.push(`${r.name} (unmapped target "${r.target}")`);
      continue;
    }
    const name = r.name.trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    if (seen.has(key)) {
      dropped.push(`${name} (duplicate name)`);
      continue;
    }
    seen.add(key);

    const aliases = autoAliases(name).filter((a) => a !== key);

    const load_type = loadTypeFor({ name, equipment: r.equipment, category: r.category });
    const ex: SeedExercise = {
      id: `library:${r.id}`,
      external_id: r.id,
      name,
      category: r.category,
      primary_muscle,
      secondary_muscles: normaliseMuscles(r.secondary_muscles ?? []).filter(
        (m) => m !== primary_muscle,
      ),
      equipment: r.equipment,
      load_type,
      media: r.id,
    };
    if (aliases.length) ex.aliases = aliases;
    if (isDifficulty(r.difficulty)) ex.difficulty = r.difficulty;
    if (r.instructions?.length) ex.instructions = r.instructions;
    base.push(ex);
  }

  // Throws on a rename pointing at a dropped row, a duplicated name or a contested shorthand.
  const out = applyCurated(base, curated);

  out.sort((a, b) => (a.name < b.name ? -1 : 1));
  const seed: ExerciseSeedFile = {
    format: 1,
    generated_at: new Date().toISOString(),
    count: out.length,
    source_ref: SOURCE_REF,
    exercises: out,
  };
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, 'exercises.json');
  writeFileSync(path, JSON.stringify(seed));

  const byLoad = new Map<string, number>();
  const byMuscle = new Map<string, number>();
  for (const e of out) {
    byLoad.set(e.load_type, (byLoad.get(e.load_type) ?? 0) + 1);
    byMuscle.set(e.primary_muscle, (byMuscle.get(e.primary_muscle) ?? 0) + 1);
  }
  console.log(`exercises: ${out.length} kept, ${dropped.length} dropped`);
  for (const d of dropped) console.log(`  drop: ${d}`);
  console.log(
    `load types: ${[...byLoad]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(', ')}`,
  );
  console.log(
    `primary muscles: ${[...byMuscle]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(', ')}`,
  );
  console.log(`with aliases: ${out.filter((e) => e.aliases?.length).length}`);
  console.log(
    `popular: ${out.filter((e) => e.popular).length} (${curated.added.length} added, no demonstration yet)`,
  );
  console.log(`wrote ${path}`);
}

await main();
