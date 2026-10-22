import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayKey } from '@/core/dates';
import { EMPTY_PLAN, flexiblePlan, mondayOfKey } from '@/core/schedule';
import type { Muscle, RoutineItem } from '@/core/types';
import { db } from '@/db/db';
import { addExercise } from '@/db/repo/exercises';
import { saveProfileSnapshot } from '@/db/repo/profiles';
import { getSetting } from '@/db/repo/settings';
import { addRoutine, addSession, deleteRoutine } from '@/db/repo/workouts';
import { myWeeks } from './circle';
import { getAims, momentum, setAim, WEEKLY_AIM_KEY } from './momentum';
import {
  CYCLE_KEY,
  getCycle,
  getPlan,
  getStoredCycle,
  resetCycle,
  restoreCycle,
  schedule,
  setCycle,
  setPlan,
  TRAINING_PLAN_KEY,
} from './schedule';
import { bridgedWeek, setEnergyBridge, weekShape } from './trainingDays';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const MON = 1;
const WED = 3;
const FRI = 5;
// A Monday, so the week ahead is the user's example laid out from its first day.
const MONDAY = '2026-10-19';

async function exercise(id: string, primary: Muscle) {
  await addExercise(
    {
      source: 'custom',
      name: id,
      category: 'strength',
      primary_muscle: primary,
      secondary_muscles: [],
      equipment: 'barbell',
      load_type: 'weight_reps',
    },
    id,
  );
}

const item = (exercise_id: string, sets = 3): RoutineItem => ({
  exercise_id,
  name: exercise_id,
  load_type: 'weight_reps',
  sets,
  rep_low: 8,
  rep_high: 12,
});

/** The user's four routines: chest & tri, back & bi, legs, shoulders & tri. */
async function userRoutines() {
  await exercise('bench', 'chest');
  await exercise('fly', 'chest');
  await exercise('pushdown', 'triceps');
  await exercise('ohp', 'shoulders');
  await exercise('raise', 'shoulders');
  await exercise('row', 'upper back');
  await exercise('pulldown', 'lats');
  await exercise('curl', 'biceps');
  await exercise('squat', 'quads');
  await exercise('rdl', 'hamstrings');
  await exercise('calf', 'calves');
  const CT = await addRoutine(
    {
      name: 'Chest & Tri',
      items: [item('bench'), item('fly'), item('pushdown')],
      sort_order: 0,
      source: 'own',
    },
    'CT',
  );
  const BB = await addRoutine(
    {
      name: 'Back & Bi',
      items: [item('row'), item('pulldown'), item('curl')],
      sort_order: 1,
      source: 'own',
    },
    'BB',
  );
  const LG = await addRoutine(
    {
      name: 'Legs',
      items: [item('squat'), item('rdl'), item('calf')],
      sort_order: 2,
      source: 'own',
    },
    'LG',
  );
  const ST = await addRoutine(
    {
      name: 'Shoulders & Tri',
      items: [item('ohp'), item('raise'), item('pushdown')],
      sort_order: 3,
      source: 'own',
    },
    'ST',
  );
  return { CT, BB, LG, ST };
}

async function trained(day: string, routine_id?: string) {
  const at = new Date(`${day}T12:00:00`);
  return addSession({
    started_at: at.toISOString(),
    ended_at: new Date(at.getTime() + 3_600_000).toISOString(),
    name: routine_id ?? 'Workout',
    ...(routine_id ? { routine_id } : {}),
    entries: [
      {
        exercise_id: 'bench',
        name: 'bench',
        load_type: 'weight_reps',
        sets: [{ kind: 'normal', done: true, weight_kg: 60, reps: 8 }],
      },
    ],
  });
}

describe('the plan is the one number', () => {
  it('starts on Auto, with nothing stored', async () => {
    expect(await getPlan()).toEqual(EMPTY_PLAN);
    expect(await getSetting(TRAINING_PLAN_KEY)).toBeUndefined();
  });

  it('choosing Monday, Wednesday and Friday sets the aim, the circle and the bridge', async () => {
    const today = todayKey();
    await setPlan({ weekdays: [MON, WED, FRI], per_week: 3 }, today);

    expect(await getPlan(today)).toEqual({ weekdays: [MON, WED, FRI], per_week: 3 });
    // The run (§20.15) reads it as a set aim of three, from this week.
    const m = await momentum(today);
    expect(m.streak.this_week).toMatchObject({ aim: 3, aim_source: 'set' });
    expect(m.aim_setting).toBe(3);
    // The circle (§21) plans three days this week.
    await trained(addDays(today, -1));
    expect((await myWeeks(today)).at(-1)?.planned).toBe(3);
    // The energy bridge (§20.7) leans toward exactly those weekdays, as chosen.
    const shape = await weekShape(today);
    expect(shape).toMatchObject({ pattern: [MON, WED, FRI], source: 'chosen' });
    for (const d of shape.days) {
      const weekday = new Date(`${d.date}T12:00:00`).getDay();
      const sessionThatDay = d.date === addDays(today, -1);
      expect(d.training, d.date).toBe([MON, WED, FRI].includes(weekday) || sessionThatDay);
    }
  });

  it('a change of days never rewrites a week already over', async () => {
    const today = todayKey();
    await setPlan({ weekdays: [MON, WED], per_week: 2 }, addDays(today, -21));
    await setPlan({ weekdays: [MON, WED, FRI], per_week: 3 }, today);
    const aims = await getAims();
    expect(aims.map((a) => a.sessions)).toEqual([2, 3]);
    expect(aims[0]!.from).toBe(mondayOfKey(addDays(today, -21)));
    expect(aims[1]!.from).toBe(mondayOfKey(today));
  });

  it('a count with no fixed days sets the aim and leaves the bridge to infer', async () => {
    const today = todayKey();
    await setPlan(flexiblePlan(4), today);
    expect((await momentum(today)).streak.this_week.aim).toBe(4);
    expect((await weekShape(today)).source).toBe('inferred');
  });

  it('back to Auto hands the aim back to the app', async () => {
    const today = todayKey();
    await setPlan({ weekdays: [MON], per_week: 1 }, today);
    await setPlan(EMPTY_PLAN, today);
    expect(await getPlan(today)).toEqual(EMPTY_PLAN);
    const m = await momentum(today);
    expect(m.aim_setting).toBeNull();
    expect(m.streak.this_week.aim_source).not.toBe('set');
  });

  it('an aim set before there were days to choose reads as a count', async () => {
    const today = todayKey();
    await setAim(4, addDays(today, -14));
    expect(await getPlan(today)).toEqual(flexiblePlan(4));
    await setAim(null, today);
    expect(await getPlan(today)).toEqual(EMPTY_PLAN);
  });

  it('a malformed plan from another phone reads as the nearest sensible one', async () => {
    await db.settings.put({
      key: TRAINING_PLAN_KEY,
      value: { weekdays: [5, 1, 'x', 9], per_week: 12 },
    } as never);
    expect(await getPlan()).toEqual({ weekdays: [MON, FRI], per_week: 2 });
  });

  it('the plan and the aim are both synced settings', async () => {
    await setPlan({ weekdays: [MON], per_week: 1 });
    const rows = await db.settings.toArray();
    const keys = rows.map((r) => r.key);
    expect(keys).toContain(TRAINING_PLAN_KEY);
    expect(keys).toContain(WEEKLY_AIM_KEY);
  });
});

describe('the energy bridge on chosen days', () => {
  it('training days carry more and the week sums the same', async () => {
    await saveProfileSnapshot({
      sex: 'male',
      birth_date: '1990-01-01',
      height_cm: 180,
      activity_level: 'moderate',
      mode: 'cut',
      goal_rate_kg_per_week: -0.5,
    } as never);
    await setEnergyBridge({ enabled: true, difference_kcal: 300 });
    await setPlan({ weekdays: [MON, WED, FRI], per_week: 3 }, MONDAY);
    const base = { kcal: 2400, protein_g: 160, carb_g: 260, fat_g: 70, fiber_g: 30 };
    const week = await bridgedWeek(base, MONDAY);
    expect(week?.applied).toBe(true);
    const training = week!.days.filter((d) => d.training).map((d) => d.date);
    expect(training).toEqual(['2026-10-19', '2026-10-21', '2026-10-23']);
    expect(week!.days.reduce((s, d) => s + d.kcal, 0)).toBe(7 * base.kcal);
  });
});

describe('the cycle', () => {
  it('is the list in order until edited', async () => {
    await userRoutines();
    expect(await getCycle()).toEqual(['CT', 'BB', 'LG', 'ST']);
    expect(await getStoredCycle()).toBeUndefined();
  });

  it('keeps a routine twice, drops a deleted one, and adds a new one at the end', async () => {
    await userRoutines();
    await setCycle(['CT', 'BB', 'LG', 'ST', 'BB', 'LG']);
    expect(await getCycle()).toEqual(['CT', 'BB', 'LG', 'ST', 'BB', 'LG']);

    await deleteRoutine('LG');
    expect(await getCycle()).toEqual(['CT', 'BB', 'ST', 'BB']);

    await addRoutine({ name: 'Arms', items: [item('curl')], sort_order: 4, source: 'own' }, 'AR');
    expect(await getCycle()).toEqual(['CT', 'BB', 'ST', 'BB', 'AR']);
  });

  it('resets to the list, and an undo puts the edit back exactly', async () => {
    await userRoutines();
    await setCycle(['ST', 'CT']);
    const before = await getStoredCycle();
    await resetCycle();
    expect(await getCycle()).toEqual(['CT', 'BB', 'LG', 'ST']);
    await restoreCycle(before);
    expect(await getCycle()).toEqual(['ST', 'CT']);
  });

  it('is stored apart from the days, so the two survive sync separately', async () => {
    await userRoutines();
    await setCycle(['CT', 'BB']);
    await setPlan({ weekdays: [MON], per_week: 1 });
    expect(await getSetting(CYCLE_KEY)).toMatchObject({ slots: ['CT', 'BB'] });
    expect(await getSetting(TRAINING_PLAN_KEY)).toMatchObject({ weekdays: [MON] });
  });
});

describe('the schedule', () => {
  it("lays the user's week out, and offers the alternating lap they meant", async () => {
    await userRoutines();
    await setPlan({ weekdays: [MON, WED, FRI], per_week: 3 }, MONDAY);
    let s = await schedule(MONDAY);
    expect(s.kinds).toEqual({ CT: 'push', BB: 'pull', LG: 'legs', ST: 'push' });
    // In list order the second push follows the legs at once: not what was meant.
    expect(s.days.filter((d) => d.slot).map((d) => d.slot!.routine_id)).toEqual([
      'CT',
      'BB',
      'LG',
      'ST',
      'CT',
      'BB',
    ]);
    expect(s.suggestion).toEqual(['CT', 'BB', 'LG', 'ST', 'BB', 'LG']);
    expect(s.cycle_is_default).toBe(true);

    await setCycle(s.suggestion!);
    s = await schedule(MONDAY);
    expect(s.days.filter((d) => d.slot).map((d) => [d.date, d.slot!.routine_id])).toEqual([
      ['2026-10-19', 'CT'],
      ['2026-10-21', 'BB'],
      ['2026-10-23', 'LG'],
      ['2026-10-26', 'ST'],
      ['2026-10-28', 'BB'],
      ['2026-10-30', 'LG'],
    ]);
    expect(s.suggestion).toBeUndefined();
    expect(s.cycle_is_default).toBe(false);
    expect(s.next?.routine.id).toBe('CT');
  });

  it('follows what was done, and says where a missed day went', async () => {
    await userRoutines();
    await setPlan({ weekdays: [MON, WED, FRI], per_week: 3 }, MONDAY);
    await setCycle(['CT', 'BB', 'LG', 'ST', 'BB', 'LG']);
    await trained('2026-10-12', 'ST');
    await trained('2026-10-14', 'BB');
    await trained('2026-10-16', 'LG');
    // Monday 19 missed; it is Wednesday.
    const s = await schedule('2026-10-21');
    expect(s.days[0]!.state).toBe('missed');
    expect(s.days[2]).toMatchObject({ state: 'today', slot: { routine_id: 'CT' } });
    expect(s.missed).toEqual({ missed: MONDAY, moved_to: '2026-10-21', routine_id: 'CT' });
    expect(s.next?.routine.id).toBe('CT');
    expect(s.next?.after?.id).toBe('LG');
  });

  it('a routine deleted drops out of the days ahead at once', async () => {
    await userRoutines();
    await setPlan({ weekdays: [MON, WED, FRI], per_week: 3 }, MONDAY);
    await deleteRoutine('BB');
    const s = await schedule(MONDAY);
    expect(s.days.filter((d) => d.slot).map((d) => d.slot!.routine_id)).toEqual([
      'CT',
      'LG',
      'ST',
      'CT',
      'LG',
      'ST',
    ]);
  });

  it('with no fixed days, lists what comes next instead', async () => {
    await userRoutines();
    await setPlan(flexiblePlan(3), MONDAY);
    await trained('2026-10-17', 'CT');
    const s = await schedule(MONDAY);
    expect(s.days.some((d) => d.slot)).toBe(false);
    expect(s.upcoming.map((u) => u.routine_id)).toEqual(['BB', 'LG', 'ST', 'CT']);
  });

  it('with no routines, has a plan and nothing to lay out', async () => {
    await setPlan({ weekdays: [MON], per_week: 1 }, MONDAY);
    const s = await schedule(MONDAY);
    expect(s.cycle).toEqual([]);
    expect(s.next).toBeUndefined();
    expect(s.days[0]).toMatchObject({ state: 'today', planned: true });
    expect(s.days[0]!.slot).toBeUndefined();
    expect(s.upcoming).toEqual([]);
  });
});
