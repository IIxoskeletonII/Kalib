import { beforeEach, describe, expect, it } from 'vitest';
import { fromDateKey, todayKey } from '@/core/dates';
import { mondayOf } from '@/core/streak';
import type { WorkoutSet } from '@/core/types';
import { db } from '@/db/db';
import { getSetting, setSetting } from '@/db/repo/settings';
import { upsertWeighIn } from '@/db/repo/weighIns';
import { addSession, deleteSession } from '@/db/repo/workouts';
import { startEasyWeek } from './block';
import {
  ACHIEVEMENTS_SEEN_KEY,
  getAims,
  getSeen,
  markSeen,
  momentum,
  setAim,
  WEEKLY_AIM_KEY,
} from './momentum';
import {
  addExercise,
  finishSession,
  startSession,
  toggleSetDone,
  updateSet,
  WEIGHT_UNIT_KEY,
} from './workouts';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const lift = (weight_kg: number, reps: number): WorkoutSet => ({
  kind: 'normal',
  done: true,
  weight_kg,
  reps,
});

async function trainOn(day: string, sets: WorkoutSet[] = [lift(100, 5)], bodyweight = false) {
  const at = fromDateKey(day);
  at.setHours(18);
  return addSession({
    started_at: at.toISOString(),
    ended_at: new Date(at.getTime() + 3_600_000).toISOString(),
    name: 'Day',
    entries: [
      {
        exercise_id: 'x',
        name: 'X',
        load_type: bodyweight ? 'bodyweight_reps' : 'weight_reps',
        sets,
      },
    ],
  });
}

const TODAY = '2026-10-21'; // a Wednesday
const MON = '2026-10-19';

describe('the weekly aim', () => {
  it('is empty until set', async () => {
    expect(await getAims()).toEqual([]);
    expect((await momentum(TODAY)).aim_setting).toBeNull();
  });

  it('applies from this week’s Monday, and a second change this week replaces the first', async () => {
    await setAim(3, TODAY);
    await setAim(4, '2026-10-23');
    expect(await getAims()).toEqual([{ from: MON, sessions: 4 }]);
    expect((await momentum(TODAY)).aim_setting).toBe(4);
  });

  it('keeps earlier weeks’ aims when it changes', async () => {
    await setAim(2, '2026-10-07');
    await setAim(4, TODAY);
    expect(await getAims()).toEqual([
      { from: '2026-10-05', sessions: 2 },
      { from: MON, sessions: 4 },
    ]);
  });

  it('is kept between one and seven, and whole', async () => {
    await setAim(0, TODAY);
    expect((await getAims())[0]!.sessions).toBe(1);
    await setAim(9, TODAY);
    expect((await getAims())[0]!.sessions).toBe(7);
    await setAim(2.6, TODAY);
    expect((await getAims())[0]!.sessions).toBe(3);
  });

  it('can be handed back to the app', async () => {
    await setAim(5, '2026-10-07');
    await setAim(null, TODAY);
    expect((await momentum(TODAY)).aim_setting).toBeNull();
    expect((await momentum('2026-10-08')).aim_setting).toBe(5);
  });

  it('survives a corrupt setting', async () => {
    await setSetting(WEEKLY_AIM_KEY, 'nonsense');
    expect(await getAims()).toEqual([]);
    await setAim(2, TODAY);
    expect(await getSetting(WEEKLY_AIM_KEY)).toEqual([{ from: MON, sessions: 2 }]);
  });
});

describe('momentum', () => {
  it('is a clean slate with no history', async () => {
    const m = await momentum(TODAY);
    expect(m.streak.current.weeks).toBe(0);
    expect(m.report.lifetime).toEqual({ kg: 0, unknown_sets: 0, sessions: 0, best_run: 0 });
    expect(m.fresh).toEqual([]);
  });

  it('counts the run from stored sessions and uses the aim you set', async () => {
    for (const d of ['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14', '2026-10-20']) {
      await trainOn(d);
    }
    await setAim(2, '2026-10-05');
    const m = await momentum(TODAY);
    expect(m.streak.history.map((w) => w.status)).toEqual(['met', 'met', 'open']);
    expect(m.streak.current.weeks).toBe(2);
    expect(m.streak.this_week).toMatchObject({ days: 1, aim: 2 });
  });

  it('lets a declared easier week keep the run', async () => {
    await setAim(3, '2026-10-05');
    for (const d of ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-13']) await trainOn(d);
    await startEasyWeek('2026-10-12');
    const m = await momentum(TODAY);
    expect(m.streak.history[1]!.status).toBe('easy');
    expect(m.streak.current.weeks).toBe(2);
  });

  it('forgets a deleted session', async () => {
    const s = await trainOn('2026-10-20');
    expect((await momentum(TODAY)).streak.current.weeks).toBe(1);
    await deleteSession(s.id);
    const m = await momentum(TODAY);
    expect(m.streak.current.weeks).toBe(0);
    expect(m.report.lifetime.sessions).toBe(0);
  });

  it('prices bodyweight sessions from stored weigh-ins', async () => {
    await trainOn('2026-10-20', [lift(0, 10)], true);
    expect((await momentum(TODAY)).report.lifetime).toMatchObject({ kg: 0, unknown_sets: 1 });
    await upsertWeighIn('2026-10-18', 80);
    expect((await momentum(TODAY)).report.lifetime).toMatchObject({ kg: 800, unknown_sets: 0 });
  });

  it('describes targets in pounds when that is the unit', async () => {
    await setSetting(WEIGHT_UNIT_KEY, 'lb');
    const m = await momentum(TODAY);
    expect(m.report.items.find((a) => a.id === 'volume:whale')!.detail).toContain('330,000 lb');
  });

  it('counts a session finished through the app like any other', async () => {
    const s = await startSession();
    // An empty workout, finished: not a training day, not a session.
    await finishSession(s.id);
    expect((await momentum(todayKey())).report.lifetime.sessions).toBe(0);
  });
});

describe('fresh milestones', () => {
  it('are surfaced once, newest first, and marking them makes them go away', async () => {
    await trainOn('2026-10-12', [lift(100, 5)]); // 500 kg: piano and first session
    await trainOn('2026-10-14', [lift(100, 60)]); // the elephant
    const m = await momentum(TODAY);
    expect(m.fresh.map((a) => a.id)).toEqual(['volume:elephant', 'volume:piano', 'sessions:1']);
    await markSeen(m.fresh.map((a) => a.id));
    expect((await momentum(TODAY)).fresh).toEqual([]);
  });

  it('come back only for something new', async () => {
    await trainOn('2026-10-12', [lift(100, 5)]);
    await markSeen((await momentum(TODAY)).fresh.map((a) => a.id));
    await trainOn('2026-10-14', [lift(100, 60)]);
    expect((await momentum(TODAY)).fresh.map((a) => a.id)).toEqual(['volume:elephant']);
  });

  it('merges seen ids rather than replacing them, and ignores an empty mark', async () => {
    await markSeen(['a']);
    await markSeen(['b', 'a']);
    await markSeen([]);
    expect(await getSeen()).toEqual(['a', 'b']);
  });

  it('survives a corrupt seen list', async () => {
    await setSetting(ACHIEVEMENTS_SEEN_KEY, 42);
    expect(await getSeen()).toEqual([]);
    await trainOn('2026-10-12');
    expect((await momentum(TODAY)).fresh.length).toBeGreaterThan(0);
  });
});

describe('the run through the app', () => {
  it('starts with a real session finished today', async () => {
    const s = await startSession();
    await addExercise(s.id, {
      id: 'bench',
      user_id: 'local',
      created_at: '',
      updated_at: '',
      source: 'custom',
      name: 'Bench',
      category: 'strength',
      primary_muscle: 'chest',
      secondary_muscles: [],
      equipment: 'barbell',
      load_type: 'weight_reps',
    });
    await updateSet(s.id, 0, 0, { weight_kg: 60, reps: 8 });
    await toggleSetDone(s.id, 0, 0);
    await finishSession(s.id);
    const today = todayKey();
    const m = await momentum(today);
    expect(m.streak.this_week.monday).toBe(mondayOf(today));
    expect(m.streak.this_week.days).toBe(1);
    expect(m.streak.current.weeks).toBe(1);
    expect(m.report.lifetime.sessions).toBe(1);
    expect(m.report.lifetime.kg).toBe(480);
    expect(m.fresh.map((a) => a.id)).toContain('volume:piano');
  });
});
