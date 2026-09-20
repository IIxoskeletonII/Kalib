import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { addFood, getFood } from '@/db/repo/foods';
import { addEntry, listEntriesForDate } from '@/db/repo/logEntries';
import { saveProfileSnapshot } from '@/db/repo/profiles';
import { setSetting } from '@/db/repo/settings';
import { listWeighIns, upsertWeighIn } from '@/db/repo/weighIns';
import { buildBackup, parseBackup, restoreBackup, summarize } from './backup';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function seed() {
  await saveProfileSnapshot({
    sex: 'male',
    birth_date: '2003-01-01',
    height_cm: 186,
    activity_level: 'light',
    mode: 'CUT',
    goal_rate_kg_per_week: 0.5,
  });
  await upsertWeighIn('2026-09-21', 110);
  const food = await addFood({
    source: 'custom',
    name: 'Gyro',
    per_100g: { kcal: 250, protein: 15, carb: 20, fat: 12, fiber: 1 },
    micros: {},
    micro_coverage: 0,
    portions: [],
    verified: false,
  });
  await addEntry({
    logged_at: '2026-09-21T12:00:00.000Z',
    date: '2026-09-21',
    meal_slot: 'lunch',
    name: 'Gyro',
    food_id: food.id,
    grams: 200,
    servings: 1,
    kcal: 500,
    protein_g: 30,
    carb_g: 40,
    fat_g: 24,
    fiber_g: 2,
    micros: {},
    entry_method: 'search',
    confidence: 'high',
  });
  await setSetting('theme', 'dark');
  await setSetting('seed_version:usda_sr', 2);
  return food.id;
}

describe('backup', () => {
  it('round-trips everything the user created, excluding device-only settings', async () => {
    const foodId = await seed();
    const backup = await buildBackup();
    expect(summarize(backup)).toMatchObject({
      profiles: 1,
      foods: 1,
      weigh_ins: 1,
      log_entries: 1,
    });
    expect(backup.settings.map((s) => s.key)).toEqual(['theme']);

    const json = JSON.parse(JSON.stringify(backup)) as unknown;
    await db.delete();
    await db.open();
    expect(await listWeighIns()).toEqual([]);

    await restoreBackup(parseBackup(json));
    expect((await listWeighIns()).map((w) => w.weight_kg)).toEqual([110]);
    expect((await listEntriesForDate('2026-09-21')).map((e) => e.name)).toEqual(['Gyro']);
    expect((await getFood(foodId))?.name).toBe('Gyro');

    // Restoring twice is a no-op, not a duplicate.
    await restoreBackup(parseBackup(json));
    expect(await db.log_entries.count()).toBe(1);
  });

  it('accepts format-1 backups', () => {
    const b = parseBackup({
      app: 'kalib',
      format: 1,
      profile: null,
      weigh_ins: [],
      log_entries: [],
      daily_targets: [],
    });
    expect(b.format).toBe(4);
    expect(b.water_logs).toEqual([]);
    expect(b.profiles).toEqual([]);
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup({ hello: 1 })).toThrow('Not a Kalib backup');
    expect(() => parseBackup({ app: 'kalib', format: 9, weigh_ins: [], log_entries: [] })).toThrow(
      'newer',
    );
    expect(() => parseBackup({ app: 'kalib', format: 2 })).toThrow('missing');
  });
});
