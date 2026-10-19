import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import {
  HOME_STAPLES,
  KITS,
  STAPLES,
  buildProgram,
  type Kit,
  type Program,
  type ProgramExercise,
} from '@/core/program';
import { addRoutine, listRoutines } from '@/db/repo/workouts';
import { saveProgram, unsaveProgram } from './program';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const program: Program = {
  days: [
    {
      name: 'Upper A',
      muscles: ['chest'],
      items: [{ exercise_id: 'a', name: 'Bench', load_type: 'weight_reps', sets: 3 }],
    },
    {
      name: 'Lower A',
      muscles: ['quads'],
      items: [{ exercise_id: 'b', name: 'Squat', load_type: 'weight_reps', sets: 3 }],
    },
  ],
  weekly: [],
  uncovered: [],
  improvised: [],
};

describe('saveProgram', () => {
  it('adds one routine per day, after the ones already there', async () => {
    await addRoutine({ name: 'Mine', items: [], sort_order: 0, source: 'own' });
    await saveProgram(program);
    expect((await listRoutines()).map((r) => r.name)).toEqual(['Mine', 'Upper A', 'Lower A']);
  });

  it('numbers a day whose name is already taken instead of making two the same', async () => {
    await addRoutine({ name: 'Upper A', items: [], sort_order: 0, source: 'own' });
    await saveProgram(program);
    expect((await listRoutines()).map((r) => r.name)).toEqual([
      'Upper A',
      'Upper A (2)',
      'Lower A',
    ]);
  });

  it('can be undone, leaving what was there before', async () => {
    await addRoutine({ name: 'Mine', items: [], sort_order: 0, source: 'own' });
    await unsaveProgram(await saveProgram(program));
    expect((await listRoutines()).map((r) => r.name)).toEqual(['Mine']);
  });

  it('skips a day with nothing in it rather than saving an empty routine', async () => {
    const thin = { ...program, days: [...program.days, { name: 'Core', muscles: [], items: [] }] };
    expect(await saveProgram(thin)).toHaveLength(2);
  });
});

// Against the real library. The named movements are only a preference if they exist, and a
// rename upstream would quietly send the generator back to "Kick Out Sit".
describe('the shipped library', () => {
  const raw = JSON.parse(readFileSync('public/data/exercises.json', 'utf8')) as
    ProgramExercise[] | { exercises: ProgramExercise[] };
  const rows = Array.isArray(raw) ? raw : raw.exercises;
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r]));

  it('has every home staple, as a strength movement not marked advanced', () => {
    for (const name of Object.values(HOME_STAPLES).flat()) {
      const e = byName.get(name.toLowerCase());
      expect(e, name).toBeDefined();
      expect(e?.category, name).toBe('strength');
      expect(e?.difficulty, name).not.toBe('advanced');
    }
  });

  it('has every gym staple, as a strength movement not marked advanced', () => {
    // Advanced movements are filtered out by default, so a staple marked advanced is one that
    // can never be chosen. Pull-Up and Hanging Leg Raise sat on this list that way for a release.
    for (const name of Object.values(STAPLES).flat()) {
      const e = byName.get(name.toLowerCase());
      expect(e, name).toBeDefined();
      expect(e?.category, name).toBe('strength');
      expect(e?.difficulty, name).not.toBe('advanced');
    }
  });

  it.each<Kit>(['gym', 'dumbbells'])('writes a %s week from named movements only', (kit) => {
    for (const days of [2, 3, 4, 5, 6]) {
      const p = buildProgram(rows, { days, equipment: KITS[kit].equipment });
      expect(p.uncovered, `${days} days`).toEqual([]);
      expect(p.improvised, `${days} days`).toEqual([]);
    }
  });

  it('owns up to what body weight alone cannot do, and covers the rest', () => {
    const p = buildProgram(rows, { days: 3, equipment: KITS.bodyweight.equipment });
    expect(p.uncovered).toEqual([]);
    expect(p.improvised.sort()).toEqual(['biceps', 'shoulders']);
  });
});
