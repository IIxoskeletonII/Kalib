import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import type { Muscle, WorkoutEntry, WorkoutSet } from '@/core/types';
import { addExercise } from '@/db/repo/exercises';
import { addRoutine, addSession } from '@/db/repo/workouts';
import { prescriptionsFor, weeklyLoad } from './training';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function exercise(id: string, primary: Muscle, secondary: Muscle[] = []) {
  return addExercise(
    {
      source: 'custom',
      name: id,
      category: 'strength',
      primary_muscle: primary,
      secondary_muscles: secondary,
      equipment: 'barbell',
      load_type: 'weight_reps',
    },
    id,
  );
}

const set = (weight_kg: number, reps: number): WorkoutSet => ({
  kind: 'normal',
  done: true,
  weight_kg,
  reps,
});

function entry(exercise_id: string, sets: WorkoutSet[]): WorkoutEntry {
  return { exercise_id, name: exercise_id, load_type: 'weight_reps', sets };
}

/** A finished session `daysAgo` days back. */
async function past(daysAgo: number, entries: WorkoutEntry[], routine_id?: string) {
  const at = new Date();
  at.setDate(at.getDate() - daysAgo);
  const ended = new Date(at.getTime() + 60 * 60 * 1000);
  return addSession({
    started_at: at.toISOString(),
    ended_at: ended.toISOString(),
    name: 'past',
    entries,
    ...(routine_id ? { routine_id } : {}),
  });
}

describe('prescriptionsFor', () => {
  it('reads the rep range off the routine the session came from', async () => {
    // The range is the one thing a logged entry does not carry, so without the routine there
    // is no top of the range to clear and no advice to give.
    await exercise('bench', 'chest');
    const routine = await addRoutine({
      name: 'push',
      items: [
        {
          exercise_id: 'bench',
          name: 'bench',
          load_type: 'weight_reps',
          sets: 3,
          rep_low: 6,
          rep_high: 8,
        },
      ],
      sort_order: 0,
      source: 'own',
    });
    await past(7, [entry('bench', [set(60, 8), set(60, 8), set(60, 8)])], routine.id);

    const out = await prescriptionsFor({
      id: 'today',
      routine_id: routine.id,
      entries: [entry('bench', [])],
    });
    expect(out.get('bench')).toMatchObject({
      kind: 'add_load',
      weight_kg: 62.5,
      reps: 6,
      from_weight_kg: 60,
    });
  });

  it('gives no advice for a session started from nothing', async () => {
    await exercise('bench', 'chest');
    await past(7, [entry('bench', [set(60, 8), set(60, 8)])]);
    const out = await prescriptionsFor({ id: 'today', entries: [entry('bench', [])] });
    expect(out.get('bench')).toEqual({ kind: 'no_advice', reason: 'no_rep_range' });
  });

  it('does not progress from the session being logged right now', async () => {
    await exercise('bench', 'chest');
    const routine = await addRoutine({
      name: 'push',
      items: [
        {
          exercise_id: 'bench',
          name: 'bench',
          load_type: 'weight_reps',
          sets: 3,
          rep_low: 6,
          rep_high: 8,
        },
      ],
      sort_order: 0,
      source: 'own',
    });
    const today = await past(0, [entry('bench', [set(80, 8), set(80, 8)])], routine.id);
    await past(7, [entry('bench', [set(60, 6), set(60, 6)])], routine.id);

    // Today's 80 kg is excluded, so the advice still comes off the 60 kg session.
    const out = await prescriptionsFor({
      id: today.id,
      routine_id: routine.id,
      entries: [entry('bench', [])],
    });
    expect(out.get('bench')?.weight_kg).toBe(60);
    expect(out.get('bench')?.kind).toBe('add_reps');
  });

  it('says first time when the exercise is new', async () => {
    await exercise('row', 'lats');
    const routine = await addRoutine({
      name: 'pull',
      items: [
        {
          exercise_id: 'row',
          name: 'row',
          load_type: 'weight_reps',
          sets: 3,
          rep_low: 6,
          rep_high: 8,
        },
      ],
      sort_order: 0,
      source: 'own',
    });
    const out = await prescriptionsFor({
      id: 'today',
      routine_id: routine.id,
      entries: [entry('row', [])],
    });
    expect(out.get('row')?.kind).toBe('first_time');
  });
});

describe('weeklyLoad', () => {
  it('counts this week per muscle and names what the routines did not cover', async () => {
    await exercise('bench', 'chest', ['triceps']);
    await exercise('squat', 'quads');
    await addRoutine({
      name: 'full',
      items: [
        { exercise_id: 'bench', name: 'bench', load_type: 'weight_reps', sets: 3 },
        { exercise_id: 'squat', name: 'squat', load_type: 'weight_reps', sets: 3 },
      ],
      sort_order: 0,
      source: 'own',
    });
    // Benched today; the squat is planned but has not happened.
    await past(0, [entry('bench', [set(60, 8), set(60, 8), set(60, 8)])]);

    const report = await weeklyLoad();
    expect(report.muscles.find((m) => m.muscle === 'chest')?.sets).toBe(3);
    expect(report.muscles.find((m) => m.muscle === 'triceps')?.sets).toBe(1.5);
    expect(report.untrained).toContain('quads');
    // three sets is under the band, so chest is short too
    expect(report.under).toContain('chest');
  });

  it('reports sets whose exercise is not in the catalogue rather than dropping them', async () => {
    await past(0, [entry('ghost-machine', [set(40, 10), set(40, 10)])]);
    const report = await weeklyLoad();
    expect(report.unknown_sets).toBe(2);
    expect(report.muscles).toEqual([]);
  });

  it('leaves out last week', async () => {
    await exercise('curl', 'biceps');
    await past(9, [entry('curl', [set(20, 10), set(20, 10)])]);
    const report = await weeklyLoad();
    expect(report.muscles).toEqual([]);
  });
});
