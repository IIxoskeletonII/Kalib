import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayKey } from '@/core/dates';
import type { WorkoutEntry, WorkoutSet } from '@/core/types';
import { db } from '@/db/db';
import { addExercise } from '@/db/repo/exercises';
import { addRoutine, addSession } from '@/db/repo/workouts';
import { declineEasyWeek, endEasyWeekNow, getEasyWeeks, startEasyWeek } from './block';
import { currentBlock, prescriptionsFor } from './training';
import { startSession } from './workouts';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const set = (weight_kg: number, reps: number): WorkoutSet => ({
  kind: 'normal',
  done: true,
  weight_kg,
  reps,
});
const entry = (sets: WorkoutSet[]): WorkoutEntry => ({
  exercise_id: 'bench',
  name: 'Bench',
  load_type: 'weight_reps',
  sets,
});

async function past(daysAgo: number, sets: WorkoutSet[], routine_id?: string) {
  const at = new Date();
  at.setDate(at.getDate() - daysAgo);
  return addSession({
    started_at: at.toISOString(),
    ended_at: new Date(at.getTime() + 3_600_000).toISOString(),
    name: 'Push',
    entries: [entry(sets)],
    ...(routine_id ? { routine_id } : {}),
  });
}

async function setup() {
  await addExercise(
    {
      source: 'custom',
      name: 'Bench',
      category: 'strength',
      primary_muscle: 'chest',
      secondary_muscles: [],
      equipment: 'barbell',
      load_type: 'weight_reps',
    },
    'bench',
  );
  return addRoutine({
    name: 'Push',
    items: [
      {
        exercise_id: 'bench',
        name: 'Bench',
        load_type: 'weight_reps',
        sets: 4,
        rep_low: 6,
        rep_high: 10,
      },
    ],
    sort_order: 0,
    source: 'own',
  });
}

describe('easier weeks', () => {
  it('start, end early, and keep only what was actually taken', async () => {
    const today = todayKey();
    await startEasyWeek(addDays(today, -3));
    expect(await getEasyWeeks()).toEqual([{ from: addDays(today, -3), to: addDays(today, 3) }]);
    await endEasyWeekNow(today);
    expect(await getEasyWeeks()).toEqual([{ from: addDays(today, -3), to: addDays(today, -1) }]);
  });

  it('run a routine at half its sets, at last time’s weight, to the bottom of the range', async () => {
    const routine = await setup();
    await past(5, [set(80, 10), set(80, 10), set(80, 10), set(80, 10)], routine.id);
    await startEasyWeek();
    const s = await startSession(routine);
    expect(s.entries[0]!.sets).toHaveLength(2);
    const advice = (await prescriptionsFor(s)).get('bench');
    // Cleared the range last time, which would ordinarily mean going up. Not this week.
    expect(advice).toEqual({ kind: 'easy', reason: 'easy_week', weight_kg: 80, reps: 6 });
  });

  it('are invisible to progression afterwards, so their short sets are not a stall', async () => {
    const routine = await setup();
    await past(12, [set(80, 9), set(80, 9)], routine.id);
    // Three easier-week sessions at the bottom of the range would read as a stall otherwise.
    await startEasyWeek(addDays(todayKey(), -8));
    await past(7, [set(80, 6)], routine.id);
    await past(5, [set(80, 6)], routine.id);
    await past(3, [set(80, 6)], routine.id);
    await endEasyWeekNow(addDays(todayKey(), -2));
    const advice = (
      await prescriptionsFor({ id: 'now', routine_id: routine.id, entries: [entry([])] })
    ).get('bench');
    expect(advice).toMatchObject({ kind: 'add_reps', weight_kg: 80, reps: 10 });
  });

  it('turning one down starts a fresh block', async () => {
    await setup();
    await past(100, [set(80, 8)]);
    expect(await currentBlock()).toMatchObject({ kind: 'block', offer: { reason: 'scheduled' } });
    await declineEasyWeek();
    const after = await currentBlock();
    expect(after).toMatchObject({ kind: 'block', week: 1 });
    expect(after).not.toHaveProperty('offer');
  });

  it('show as the current state while one runs', async () => {
    await setup();
    await past(100, [set(80, 8)]);
    await startEasyWeek();
    expect(await currentBlock()).toMatchObject({ kind: 'easy' });
  });
});
