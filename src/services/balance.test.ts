import { beforeEach, describe, expect, it } from 'vitest';
import type { BalanceFix } from '@/core/balance';
import type { ExerciseCategory, Muscle, RoutineItem } from '@/core/types';
import { db } from '@/db/db';
import { addExercise, deleteExercise } from '@/db/repo/exercises';
import { addRoutine, deleteRoutine, getRoutine, updateRoutine } from '@/db/repo/workouts';
import { applyFix, balance, routineBalance, routineFrequency } from './balance';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function exercise(
  id: string,
  name: string,
  primary: Muscle,
  secondary: Muscle[] = [],
  equipment = 'barbell',
  category: ExerciseCategory = 'strength',
) {
  return addExercise(
    {
      source: 'library',
      name,
      category,
      difficulty: 'beginner',
      primary_muscle: primary,
      secondary_muscles: secondary,
      equipment,
      load_type: 'weight_reps',
    },
    id,
  );
}

const item = (exercise_id: string, name: string, sets = 3): RoutineItem => ({
  exercise_id,
  name,
  load_type: 'weight_reps',
  sets,
});

async function library() {
  await exercise('bench', 'Bench Press (Barbell)', 'chest', ['shoulders', 'triceps']);
  await exercise('pushdown', 'Triceps Pushdown (Cable)', 'triceps', [], 'cable');
  await exercise('pulldown', 'Lat Pulldown (Cable)', 'lats', ['biceps'], 'cable');
  await exercise('seatedrow', 'Seated Row (Cable)', 'upper back', ['lats', 'biceps'], 'cable');
  await exercise('curl', 'Bicep Curl (Barbell)', 'biceps', ['forearms']);
  await exercise('squat', 'Squat (Barbell)', 'quads', ['glutes', 'hamstrings']);
  await exercise('legcurl', 'Lying Leg Curl (Machine)', 'hamstrings', [], 'leverage machine');
  await exercise('calf', 'Standing Calf Raise (Machine)', 'calves', [], 'leverage machine');
  await exercise('revfly', 'Reverse Fly (Dumbbell)', 'shoulders', ['upper back'], 'dumbbell');
  await exercise('ohp', 'Overhead Press (Barbell)', 'shoulders', ['triceps']);
  await exercise('plank', 'Front Plank', 'abs', [], 'body weight', 'stretching');
}

async function split() {
  await library();
  await addRoutine(
    {
      name: 'Push',
      items: [
        item('bench', 'Bench Press (Barbell)', 4),
        item('pushdown', 'Triceps Pushdown (Cable)'),
      ],
      sort_order: 0,
      source: 'own',
    },
    'push',
  );
  await addRoutine(
    {
      name: 'Pull',
      items: [item('pulldown', 'Lat Pulldown (Cable)', 4), item('curl', 'Bicep Curl (Barbell)')],
      sort_order: 1,
      source: 'own',
    },
    'pull',
  );
  await addRoutine(
    { name: 'Legs', items: [item('squat', 'Squat (Barbell)', 4)], sort_order: 2, source: 'own' },
    'legs',
  );
}

describe('balance', () => {
  it('is empty with no routines', async () => {
    await library();
    const b = await balance();
    expect(b.report.routines).toBe(0);
    expect(b.fixes).toEqual([]);
  });

  it('reads the routines and offers fixes from the library', async () => {
    await split();
    const b = await balance();
    expect(b.report.routines).toBe(3);
    expect(b.report.muscles.find((m) => m.muscle === 'chest')!.sets).toBe(4);
    const calves = b.fixes.find((f) => f.for.muscle === 'calves');
    expect(calves).toMatchObject({ kind: 'add', routine_id: 'legs' });
    expect(calves!.item.exercise_id).toBe('calf');
  });

  it('leaves deleted routines out', async () => {
    await split();
    await deleteRoutine('legs');
    const b = await balance();
    expect(b.report.routines).toBe(2);
    expect(b.report.muscles.find((m) => m.muscle === 'quads')!.sets).toBe(0);
  });

  it('never offers a deleted exercise', async () => {
    await split();
    await deleteExercise('calf');
    const b = await balance();
    expect(b.fixes.some((f) => f.item.exercise_id === 'calf')).toBe(false);
  });

  it("counts a routine's own exercise whatever its category", async () => {
    await library();
    await addRoutine(
      { name: 'Core', items: [item('plank', 'Front Plank', 4)], sort_order: 0, source: 'own' },
      'core',
    );
    const b = await balance();
    expect(b.report.muscles.find((m) => m.muscle === 'abs')!.sets).toBe(4);
    expect(b.report.unknown_sets).toBe(0);
  });

  it('takes the frequency it is given, and says it was scheduled', async () => {
    await split();
    const b = await balance(new Map([['push', 2]]));
    expect(b.report.muscles.find((m) => m.muscle === 'chest')!.sets).toBe(8);
    expect(b.scheduled).toBe(true);
    expect((await balance()).scheduled).toBe(false);
  });

  it('counts each routine once a week until the week has a schedule', async () => {
    expect(await routineFrequency()).toBeUndefined();
  });
});

describe('routineBalance', () => {
  it('reads one routine on its own', async () => {
    await split();
    const r = await routineBalance('pull');
    expect(r!.routines).toBe(1);
    expect(r!.muscles.find((m) => m.muscle === 'lats')!.sets).toBe(4);
    expect(r!.muscles.find((m) => m.muscle === 'chest')!.sets).toBe(0);
  });

  it('is undefined for a routine that is not there', async () => {
    expect(await routineBalance('nope')).toBeUndefined();
  });
});

describe('applyFix', () => {
  it('adds an exercise, and the undo puts the routine back exactly', async () => {
    await split();
    const before = (await getRoutine('legs'))!.items;
    const fix = (await balance()).fixes.find((f) => f.for.muscle === 'calves')!;
    const undo = await applyFix(fix);
    const now = (await getRoutine('legs'))!.items;
    expect(now.map((i) => i.exercise_id)).toEqual(['squat', 'calf']);
    expect(now[1]).toMatchObject({ name: 'Standing Calf Raise (Machine)', sets: 3 });

    // The balance reads the change straight away: calves are no longer untrained.
    const after = await balance();
    expect(after.report.muscles.find((m) => m.muscle === 'calves')!.status).not.toBe('untrained');
    expect(after.fixes.some((f) => f.for.muscle === 'calves' && f.for.reason === 'untrained')).toBe(
      false,
    );

    await undo();
    expect((await getRoutine('legs'))!.items).toEqual(before);
  });

  it('swaps in place, and the undo puts the old exercise back', async () => {
    await split();
    const fix: BalanceFix = {
      kind: 'swap',
      id: 'swap:push:1:revfly',
      routine_id: 'push',
      routine_name: 'Push',
      for: { muscle: 'shoulders', head: 'rear', reason: 'front-rear-delts', need: 2 },
      before: 0,
      after: 3,
      index: 1,
      item: item('revfly', 'Reverse Fly (Dumbbell)'),
      out: {
        exercise_id: 'pushdown',
        name: 'Triceps Pushdown (Cable)',
        muscle: 'triceps',
        before: 5,
        after: 2,
      },
    };
    const undo = await applyFix(fix);
    expect((await getRoutine('push'))!.items.map((i) => i.exercise_id)).toEqual([
      'bench',
      'revfly',
    ]);
    await undo();
    expect((await getRoutine('push'))!.items.map((i) => i.exercise_id)).toEqual([
      'bench',
      'pushdown',
    ]);
  });

  it('refuses a swap when the slot now holds something else', async () => {
    await split();
    const fix: BalanceFix = {
      kind: 'swap',
      id: 'x',
      routine_id: 'push',
      routine_name: 'Push',
      for: { muscle: 'calves', reason: 'untrained', need: 10 },
      before: 0,
      after: 3,
      index: 1,
      item: item('calf', 'Standing Calf Raise (Machine)'),
      out: {
        exercise_id: 'pushdown',
        name: 'Triceps Pushdown (Cable)',
        muscle: 'triceps',
        before: 5,
        after: 2,
      },
    };
    await updateRoutine('push', { items: [item('bench', 'Bench Press (Barbell)')] });
    await expect(applyFix(fix)).rejects.toThrow(/changed since/);
    expect((await getRoutine('push'))!.items).toHaveLength(1);
  });

  it('refuses to add an exercise the routine already has', async () => {
    await split();
    const fix = (await balance()).fixes.find((f) => f.for.muscle === 'calves')!;
    await applyFix(fix);
    await expect(applyFix(fix)).rejects.toThrow(/already in Legs/);
    expect((await getRoutine('legs'))!.items).toHaveLength(2);
  });

  it('refuses a routine that has been deleted', async () => {
    await split();
    const fix = (await balance()).fixes.find((f) => f.for.muscle === 'calves')!;
    await deleteRoutine('legs');
    await expect(applyFix(fix)).rejects.toThrow(/no longer there/);
  });

  it('applies every offered fix in order without a refusal', async () => {
    await split();
    const { fixes } = await balance();
    expect(fixes.length).toBeGreaterThan(1);
    for (const f of fixes) await applyFix(f);
    const after = await balance();
    // Everything that was untrained has been given work.
    for (const f of fixes.filter((x) => x.for.reason === 'untrained')) {
      expect(after.report.muscles.find((m) => m.muscle === f.for.muscle)!.sets).toBeGreaterThan(0);
    }
  });
});
