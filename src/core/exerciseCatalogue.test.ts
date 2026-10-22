// SPEC §20.19 — the curated catalogue, tested twice: the merge as a function, and the file it
// produced, which is what every phone actually loads.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCurated, phraseKey, type CuratedFile } from './exerciseCatalogue';
import { buildExerciseDoc, correctQuery, searchExercises, withinOneEdit } from './exerciseSearch';
import type { ExerciseSeedFile, SeedExercise } from './exerciseSeed';
import { MUSCLES } from './types';

const ROOT = join(__dirname, '..', '..');
const seed = JSON.parse(
  readFileSync(join(ROOT, 'public', 'data', 'exercises.json'), 'utf8'),
) as ExerciseSeedFile;
const curated = JSON.parse(
  readFileSync(join(ROOT, 'data', 'exercises-curated.json'), 'utf8'),
) as CuratedFile;
const docs = seed.exercises.map((e) => buildExerciseDoc({ ...e, source: 'library' }));
const byId = new Map(seed.exercises.map((e) => [e.id, e]));

const top = (q: string) => searchExercises(docs, q)[0]?.name;

function row(over: Partial<SeedExercise> & { external_id: string; name: string }): SeedExercise {
  return {
    id: `library:${over.external_id}`,
    category: 'strength',
    primary_muscle: 'chest',
    secondary_muscles: [],
    equipment: 'barbell',
    load_type: 'weight_reps',
    ...over,
  };
}

describe('applyCurated', () => {
  const base = [
    row({ external_id: '0001', name: 'Lever Seated Fly', media: '0001', equipment: 'lever' }),
    row({ external_id: '0002', name: 'Barbell Full Squat', primary_muscle: 'glutes' }),
    row({ external_id: '0003', name: 'Some Obscure Press', shorthand: ['old'], popular: true }),
  ];

  it('renames a row in place, keeping its id, media and the old name as an alias', () => {
    const out = applyCurated(base, {
      library: { '0001': { name: 'Pec Deck (Machine)', shorthand: ['Pec Deck', 'butterfly'] } },
      added: [],
    });
    const e = out.find((r) => r.external_id === '0001')!;
    expect(e.id).toBe('library:0001');
    expect(e.media).toBe('0001');
    expect(e.name).toBe('Pec Deck (Machine)');
    expect(e.popular).toBe(true);
    // Its own name is never its own shorthand; phrases are normalised; the old name is one.
    expect(e.shorthand).toEqual(['pec deck', 'butterfly', 'lever seated fly']);
    expect(e.aliases).toContain('lever seated fly');
    expect(e.aliases).toContain('pec deck');
  });

  it('corrects muscles when told to, and drops the primary from the secondaries', () => {
    const out = applyCurated(base, {
      library: {
        '0002': { name: 'Squat (Barbell)', primary: 'quads', secondary: ['quads', 'glutes'] },
      },
      added: [],
    });
    const e = out.find((r) => r.external_id === '0002')!;
    expect(e.primary_muscle).toBe('quads');
    expect(e.secondary_muscles).toEqual(['glutes']);
  });

  it('strips shorthand and popularity from rows it does not curate', () => {
    const out = applyCurated(base, { library: {}, added: [] });
    const e = out.find((r) => r.external_id === '0003')!;
    expect(e.shorthand).toBeUndefined();
    expect(e.popular).toBeUndefined();
  });

  it('can rename without making popular', () => {
    const out = applyCurated(base, {
      library: { '0003': { name: 'Obscure Press (Barbell)', popular: false } },
      added: [],
    });
    expect(out.find((r) => r.external_id === '0003')!.popular).toBeUndefined();
  });

  it('adds an exercise under a kalib id, with no media and an inferred load type', () => {
    const out = applyCurated(base, {
      library: {},
      added: [
        {
          id: 'kalib-face-pull-cable',
          name: 'Face Pull (Cable)',
          category: 'strength',
          equipment: 'cable',
          primary: 'shoulders',
          secondary: ['upper back', 'shoulders'],
          instructions: ['Pull.'],
          shorthand: ['face pull'],
        },
      ],
    });
    const e = out.find((r) => r.external_id === 'kalib-face-pull-cable')!;
    expect(e.id).toBe('library:kalib-face-pull-cable');
    expect(e.media).toBeUndefined();
    expect(e.load_type).toBe('weight_reps');
    expect(e.secondary_muscles).toEqual(['upper back']);
    expect(e.popular).toBe(true);
  });

  it('refuses a rename that points at nothing', () => {
    expect(() => applyCurated(base, { library: { '9999': { name: 'X' } }, added: [] })).toThrow(
      /9999/,
    );
  });

  it('refuses two exercises with one name, listing every problem at once', () => {
    expect(() =>
      applyCurated(base, {
        library: {
          '0001': { name: 'Same', shorthand: ['shared'] },
          '0002': { name: 'same', shorthand: ['shared'] },
        },
        added: [],
      }),
    ).toThrow(/called "same"[\s\S]*claimed by both/);
  });

  it('refuses a shorthand that is another exercise’s whole name', () => {
    expect(() =>
      applyCurated(base, {
        library: { '0001': { name: 'Pec Deck (Machine)', shorthand: ['barbell full squat'] } },
        added: [],
      }),
    ).toThrow(/is the name of library:0002/);
  });

  it('refuses unknown muscles, load types, categories and ids', () => {
    expect(() =>
      applyCurated(base, { library: { '0001': { name: 'A', primary: 'pecs' } }, added: [] }),
    ).toThrow(/pecs/);
    expect(() =>
      applyCurated(base, { library: { '0001': { name: 'A', load_type: 'reps' } }, added: [] }),
    ).toThrow(/load type/);
    const add = {
      id: 'kalib-x',
      name: 'X',
      category: 'strength',
      equipment: 'cable',
      primary: 'chest',
      secondary: [],
      instructions: ['Do it.'],
    };
    expect(() => applyCurated(base, { library: {}, added: [{ ...add, id: '0004' }] })).toThrow(
      /kalib-/,
    );
    expect(() =>
      applyCurated(base, { library: {}, added: [{ ...add, category: 'yoga' }] }),
    ).toThrow(/category/);
    expect(() =>
      applyCurated(base, { library: {}, added: [{ ...add, instructions: [] }] }),
    ).toThrow(/instructions/);
  });
});

describe('the generated library', () => {
  it('has unique ids and unique names', () => {
    expect(new Set(seed.exercises.map((e) => e.id)).size).toBe(seed.exercises.length);
    expect(new Set(seed.exercises.map((e) => phraseKey(e.name))).size).toBe(seed.exercises.length);
    expect(seed.count).toBe(seed.exercises.length);
  });

  it('keeps every id a phone may already point at', () => {
    // The open library's ids: numeric, or the handful of pulse-* rows. None may ever vanish,
    // since routines and sessions reference them.
    const libraryIds = seed.exercises.filter((e) => !e.id.startsWith('library:kalib-'));
    expect(libraryIds.length).toBe(1394);
    for (const e of libraryIds) expect(e.id).toMatch(/^library:(\d{4}|pulse-\d{4})$/);
    for (const e of seed.exercises) expect(e.id).toBe(`library:${e.external_id}`);
  });

  it('carries only muscles, load types and categories the app knows', () => {
    for (const e of seed.exercises) {
      expect(MUSCLES).toContain(e.primary_muscle);
      for (const m of e.secondary_muscles) expect(MUSCLES).toContain(m);
      expect(e.secondary_muscles).not.toContain(e.primary_muscle);
      expect([
        'weight_reps',
        'bodyweight_reps',
        'weighted_bodyweight',
        'time',
        'distance_time',
      ]).toContain(e.load_type);
    }
  });

  it('marks exactly the curated rows popular, and gives every added one instructions', () => {
    const popular = seed.exercises.filter((e) => e.popular);
    const renamedPopular = Object.values(curated.library).filter((c) => c.popular !== false);
    expect(popular.length).toBe(renamedPopular.length + curated.added.length);
    for (const [ext, c] of Object.entries(curated.library)) {
      const e = byId.get(`library:${ext}`)!;
      expect(e.name).toBe(c.name);
    }
    for (const a of curated.added) {
      const e = byId.get(`library:${a.id}`)!;
      expect(e.name).toBe(a.name);
      expect(e.instructions?.length).toBeGreaterThan(0);
      expect(e.media).toBeUndefined();
    }
  });

  it('has a few hundred mainstream exercises', () => {
    const popular = seed.exercises.filter((e) => e.popular).length;
    expect(popular).toBeGreaterThanOrEqual(250);
    expect(popular).toBeLessThanOrEqual(400);
  });

  it('names mainstream exercises movement first, implement in parentheses', () => {
    const implement =
      /\((Barbell|Dumbbell|Cable|Machine|Smith Machine|EZ Bar|Kettlebell|Band|Landmine|Assisted|Leg Press|Bodyweight|Stationary Bike|Outdoor|Two-Arm)\)$|^[^()]+$|\(outdoor\)$/;
    for (const e of seed.exercises.filter((x) => x.popular)) expect(e.name).toMatch(implement);
  });
});

describe('every curated shorthand finds its exercise first', () => {
  const cases: [string, string][] = [];
  for (const [ext, c] of Object.entries(curated.library)) {
    for (const s of c.shorthand ?? []) cases.push([s, byId.get(`library:${ext}`)!.name]);
  }
  for (const a of curated.added) for (const s of a.shorthand ?? []) cases.push([s, a.name]);

  it('covers every phrase in the file', () => {
    expect(cases.length).toBeGreaterThan(900);
  });

  it.each(cases)('"%s" → %s', (q, name) => {
    expect(top(q)).toBe(name);
  });

  it('and typing a mainstream name in full finds it first', () => {
    for (const e of seed.exercises.filter((x) => x.popular)) expect(top(e.name)).toBe(e.name);
  });
});

describe('what people type', () => {
  it.each([
    ['pec deck', 'Pec Deck (Machine)'],
    ['incline dumbbell press', 'Incline Bench Press (Dumbbell)'],
    // The misspelling the user actually typed.
    ['incline dumbell press', 'Incline Bench Press (Dumbbell)'],
    ['face pull', 'Face Pull (Cable)'],
    ['hip thrust', 'Hip Thrust (Barbell)'],
    ['rdl', 'Romanian Deadlift (Barbell)'],
    ['ohp', 'Overhead Press (Barbell)'],
    ['skullcrusher', 'Skull Crusher (Barbell)'],
    ['lat pulldown', 'Lat Pulldown (Cable)'],
    ['bulgarian split squat', 'Bulgarian Split Squat (Dumbbell)'],
    ['romanain deadlift', 'Romanian Deadlift (Barbell)'],
    ['barbel row', 'Bent Over Row (Barbell)'],
    ['lever seated fly', 'Pec Deck (Machine)'],
    ['barbell full squat', 'Squat (Barbell)'],
  ])('"%s" → %s', (q, name) => {
    expect(top(q)).toBe(name);
  });

  it('puts mainstream exercises first for a generic word', () => {
    for (const q of ['fly', 'curl', 'row', 'press', 'squat', 'raise', 'pulldown', 'extension']) {
      const hits = searchExercises(docs, q, new Map(), 5);
      for (const h of hits) expect(h.popular, `${q} → ${h.name}`).toBe(true);
    }
  });

  it('still finds the obscure variant when it is asked for', () => {
    expect(top('cable incline fly on stability ball')).toBe(
      'Cable Incline Fly (on Stability Ball)',
    );
  });
});

describe('withinOneEdit', () => {
  it.each([
    ['dumbell', 'dumbbell', true],
    ['dumbbel', 'dumbbell', true],
    ['dumbel', 'dumbbell', false],
    ['dubmbell', 'dumbbell', true],
    ['dumbbelll', 'dumbbell', true],
    ['dunbbell', 'dumbbell', true],
    ['dumbbell', 'dumbbell', true],
    ['dumell', 'dumbbell', false],
    ['bench', 'beach', true],
    ['press', 'dress', true],
    ['abcde', 'edcba', false],
  ])('%s ~ %s is %s', (a, b, want) => {
    expect(withinOneEdit(a, b)).toBe(want);
    expect(withinOneEdit(b, a)).toBe(want);
  });

  it('does not rescue short words, where one letter is a different word', () => {
    expect(searchExercises(docs, 'raw')).toEqual([]);
  });
});

describe('correctQuery', () => {
  it('fixes a slip in any word', () => {
    expect(correctQuery(['incline', 'dumbell', 'press'], docs)).toEqual([
      'incline',
      'dumbbell',
      'press',
    ]);
    expect(correctQuery(['romanain', 'deadlift'], docs)).toEqual(['romanian', 'deadlift']);
  });

  it('leaves the last word alone while it could still be being typed', () => {
    expect(correctQuery(['incline', 'dumbb'], docs)).toEqual(['incline', 'dumbb']);
  });

  it('finishes an earlier word that was cut short', () => {
    expect(correctQuery(['barbel', 'row'], docs)).toEqual(['barbell', 'row']);
  });

  it('never touches short words or real ones', () => {
    expect(correctQuery(['db', 'raw', 'press', 'bench'], docs)).toEqual([
      'db',
      'raw',
      'press',
      'bench',
    ]);
  });

  it('leaves a word with nothing near it as it was, so the search honestly finds nothing', () => {
    expect(correctQuery(['zzzzzz'], docs)).toEqual(['zzzzzz']);
    expect(searchExercises(docs, 'zzzzzz')).toEqual([]);
  });
});
