// SPEC §20.9 — writing a generated week into routines.
//
// The program itself is core/program.ts; this only puts it where the rest of training can use
// it. Each day becomes an ordinary routine, so everything the app already does with a routine
// — editing it, starting it, progression on its lifts — applies without knowing it was
// generated. That is the point: a generated week is a starting point, not a separate mode.
import type { Program } from '@/core/program';
import { uniqueRoutineName } from '@/core/routines';
import { getExercises } from '@/db/repo/exercises';
import { addRoutine, deleteRoutine, listRoutines, nextRoutineOrder } from '@/db/repo/workouts';
import { warmExerciseMedia } from './exerciseMedia';

/**
 * Adds one routine per day, after whatever is already there, and returns their ids so the
 * caller can offer an undo.
 *
 * Alongside rather than instead of: replacing someone's routines because they tried a button
 * would be a strange thing for a preview to do. Names that clash are numbered.
 */
export async function saveProgram(program: Program): Promise<string[]> {
  const taken = (await listRoutines()).map((r) => r.name);
  let order = await nextRoutineOrder();
  const ids: string[] = [];
  for (const day of program.days) {
    if (day.items.length === 0) continue;
    const name = uniqueRoutineName(day.name, taken);
    taken.push(name);
    const row = await addRoutine({
      name,
      items: day.items,
      sort_order: order++,
      source: 'own',
    });
    ids.push(row.id);
  }

  // As the routine editor does on save: the week should work in a basement gym.
  const exercises = await getExercises(
    program.days.flatMap((d) => d.items.map((i) => i.exercise_id)),
  );
  void warmExerciseMedia([...exercises.values()].map((e) => e.media));

  return ids;
}

/** The undo for `saveProgram`. Soft deletes, like every other removal. */
export async function unsaveProgram(ids: readonly string[]): Promise<void> {
  for (const id of ids) await deleteRoutine(id);
}
