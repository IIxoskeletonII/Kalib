import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { ensureDailyTarget, getDailyTarget, upsertDailyTarget } from './dailyTargets';
import { addFood, getFood, listSearchDocs } from './foods';
import {
  addEntry,
  deleteEntry,
  firstActivityDate,
  foodUsageCounts,
  lastGramsForFood,
  listEntriesForDate,
  updateEntry,
  type LogEntryInput,
} from './logEntries';
import { getCurrentProfile, saveProfileSnapshot } from './profiles';
import { getSetting, setSetting } from './settings';
import { deleteWeighIn, getWeighIn, latestWeighIn, listWeighIns, upsertWeighIn } from './weighIns';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

function entry(over: Partial<LogEntryInput> = {}): LogEntryInput {
  return {
    logged_at: '2026-09-21T08:00:00.000Z',
    date: '2026-09-21',
    meal_slot: 'breakfast',
    name: 'Egg',
    food_id: 'usda_foundation:1',
    grams: 50,
    servings: 1,
    kcal: 72,
    protein_g: 6,
    carb_g: 0.4,
    fat_g: 5,
    fiber_g: 0,
    micros: {},
    entry_method: 'search',
    confidence: 'high',
    ...over,
  };
}

describe('weigh_ins', () => {
  it('upserts one row per date and soft-deletes', async () => {
    const a = await upsertWeighIn('2026-09-21', 110);
    const b = await upsertWeighIn('2026-09-21', 109.5);
    expect(b.id).toBe(a.id);
    expect((await listWeighIns()).map((w) => w.weight_kg)).toEqual([109.5]);
    expect(b.updated_at >= a.updated_at).toBe(true);

    await upsertWeighIn('2026-09-20', 111);
    expect((await listWeighIns()).map((w) => w.date)).toEqual(['2026-09-20', '2026-09-21']);
    expect((await latestWeighIn())?.date).toBe('2026-09-21');

    await deleteWeighIn('2026-09-21');
    expect(await getWeighIn('2026-09-21')).toBeUndefined();
    expect(await db.weigh_ins.count()).toBe(2);

    const c = await upsertWeighIn('2026-09-21', 108);
    expect(c.id).toBe(a.id);
    expect(c.deleted_at).toBeNull();
    expect((await getWeighIn('2026-09-21'))?.weight_kg).toBe(108);
  });

  it('stores body fat only when given', async () => {
    const w = await upsertWeighIn('2026-09-21', 110, { bodyfat_pct: 35 });
    expect(w.bodyfat_pct).toBe(35);
    const w2 = await upsertWeighIn('2026-09-21', 109);
    expect(w2.bodyfat_pct).toBe(35);
  });
});

describe('log_entries', () => {
  it('lists by date in logging order and hides soft-deleted rows', async () => {
    const e2 = await addEntry(entry({ logged_at: '2026-09-21T12:00:00.000Z', name: 'Lunch' }));
    const e1 = await addEntry(entry());
    await addEntry(entry({ date: '2026-09-22' }));
    expect((await listEntriesForDate('2026-09-21')).map((e) => e.id)).toEqual([e1.id, e2.id]);

    await deleteEntry(e1.id);
    expect((await listEntriesForDate('2026-09-21')).map((e) => e.id)).toEqual([e2.id]);
  });

  it('updates fields and bumps updated_at', async () => {
    const e = await addEntry(entry());
    await updateEntry(e.id, { grams: 100, kcal: 144 });
    const [row] = await listEntriesForDate('2026-09-21');
    expect(row?.grams).toBe(100);
    expect(row!.updated_at >= e.updated_at).toBe(true);
  });

  it('reports last grams and usage per food', async () => {
    await addEntry(entry({ grams: 50, logged_at: '2026-09-21T08:00:00.000Z' }));
    await addEntry(
      entry({ grams: 120, logged_at: '2026-09-22T08:00:00.000Z', date: '2026-09-22' }),
    );
    await addEntry(entry({ food_id: 'x', grams: 1 }));
    expect(await lastGramsForFood('usda_foundation:1')).toBe(120);
    expect(await lastGramsForFood('nope')).toBeUndefined();
    const usage = await foodUsageCounts();
    expect(usage.get('usda_foundation:1')).toBe(2);
    expect(usage.get('x')).toBe(1);
  });

  it('firstActivityDate spans entries and weigh-ins', async () => {
    expect(await firstActivityDate()).toBeUndefined();
    await addEntry(entry({ date: '2026-09-23' }));
    expect(await firstActivityDate()).toBe('2026-09-23');
    await upsertWeighIn('2026-09-21', 110);
    expect(await firstActivityDate()).toBe('2026-09-21');
  });
});

describe('daily_targets', () => {
  const values = {
    kcal: 2150,
    protein_g: 160,
    carb_g: 190,
    fat_g: 75,
    fiber_g: 35,
    water_ml: 3850,
    banking_adjustment: 0,
    source: 'formula' as const,
    provisional: true,
  };

  it('ensureDailyTarget computes once and then returns the stored row', async () => {
    let calls = 0;
    const a = await ensureDailyTarget('2026-09-21', () => {
      calls++;
      return values;
    });
    const b = await ensureDailyTarget('2026-09-21', () => {
      calls++;
      return { ...values, kcal: 1 };
    });
    expect(calls).toBe(1);
    expect(b.id).toBe(a.id);
    expect(b.kcal).toBe(2150);
  });

  it('upsertDailyTarget overwrites in place', async () => {
    const a = await upsertDailyTarget('2026-09-21', values);
    const b = await upsertDailyTarget('2026-09-21', { ...values, kcal: 2000 });
    expect(b.id).toBe(a.id);
    expect((await getDailyTarget('2026-09-21'))?.kcal).toBe(2000);
    expect(await db.daily_targets.count()).toBe(1);
  });
});

describe('profiles & settings & foods', () => {
  it('returns the newest profile snapshot', async () => {
    const base = {
      sex: 'male' as const,
      birth_date: '2003-01-01',
      height_cm: 186,
      activity_level: 'light' as const,
      mode: 'CUT' as const,
      goal_rate_kg_per_week: 0.5,
    };
    await saveProfileSnapshot(base);
    await new Promise((r) => setTimeout(r, 2));
    await saveProfileSnapshot({ ...base, height_cm: 187 });
    expect((await getCurrentProfile())?.height_cm).toBe(187);
  });

  it('settings round-trip', async () => {
    expect(await getSetting('x')).toBeUndefined();
    await setSetting('x', { a: 1 });
    expect(await getSetting('x')).toEqual({ a: 1 });
  });

  it('foods are searchable after insert', async () => {
    const f = await addFood({
      source: 'custom',
      name: 'Gyro',
      per_100g: { kcal: 250, protein: 15, carb: 20, fat: 12, fiber: 1 },
      micros: {},
      micro_coverage: 0,
      portions: [],
      verified: false,
    });
    expect((await getFood(f.id))?.name).toBe('Gyro');
    expect((await listSearchDocs()).map((d) => d.id)).toEqual([f.id]);
  });
});
