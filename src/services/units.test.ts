import { beforeEach, describe, expect, it } from 'vitest';
import { MARKET_KEY } from '@/core/market';
import { flOzToMl, fromBodyUnit, fromFoodUnit, fromLengthUnit, toBodyUnit } from '@/core/measure';
import { db } from '@/db/db';
import { getSetting, setSetting } from '@/db/repo/settings';
import { addWater, listWaterForDate } from '@/db/repo/water';
import { listWeighIns, upsertWeighIn } from '@/db/repo/weighIns';
import { dexieLocal } from './sync/local';
import {
  adoptUnitSystem,
  getUnits,
  getUnitSystem,
  GYM_UNIT_KEY,
  setGymChoice,
  setUnitSystem,
  UNIT_SYSTEM_KEY,
} from './units';
import { WEIGHT_UNIT_KEY } from './workouts';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('the units setting', () => {
  it('guesses metric for a market that weighs in kilos', async () => {
    await setSetting(MARKET_KEY, 'IT');
    const u = await getUnits();
    expect(u.system).toBe('metric');
    expect(u.chosen).toBe(false);
    expect(u.gymUnit).toBe('kg');
  });

  it('guesses US for the US market', async () => {
    await setSetting(MARKET_KEY, 'US');
    const u = await getUnits();
    expect(u.system).toBe('us');
    expect(u.chosen).toBe(false);
    expect(u.gymUnit).toBe('lb');
  });

  it('keeps a choice whatever the market says', async () => {
    await setSetting(MARKET_KEY, 'US');
    await setUnitSystem('metric');
    expect(await getUnitSystem()).toBe('metric');
    expect((await getUnits()).chosen).toBe(true);
  });

  it('writes the first guess down, so a trip abroad does not change it', async () => {
    await setSetting(MARKET_KEY, 'IT');
    await adoptUnitSystem();
    expect(await getSetting(UNIT_SYSTEM_KEY)).toBe('metric');
    // A week in New York: the market moves, the units do not.
    await setSetting(MARKET_KEY, 'US');
    expect(await getUnitSystem()).toBe('metric');
  });

  it('never overwrites a choice when adopting', async () => {
    await setSetting(MARKET_KEY, 'IT');
    await setUnitSystem('us');
    await adoptUnitSystem();
    expect(await getSetting(UNIT_SYSTEM_KEY)).toBe('us');
  });

  it('ignores a malformed stored value rather than failing', async () => {
    await setSetting(UNIT_SYSTEM_KEY, 'imperial');
    await setSetting(MARKET_KEY, 'IT');
    expect(await getUnitSystem()).toBe('metric');
  });

  it('syncs, like every setting that is not about this one device', async () => {
    await setUnitSystem('us');
    await setGymChoice('kg');
    const rows = await dexieLocal.changedSince('settings', null);
    const keys = rows.map((r) => String((r as unknown as { key: string }).key));
    expect(keys).toContain(UNIT_SYSTEM_KEY);
    expect(keys).toContain(GYM_UNIT_KEY);
  });
});

describe('the gym override', () => {
  it('follows the app by default', async () => {
    await setUnitSystem('us');
    expect((await getUnits()).gymUnit).toBe('lb');
    await setUnitSystem('metric');
    expect((await getUnits()).gymUnit).toBe('kg');
  });

  it('keeps pounds at the bar for someone who chose them before units existed', async () => {
    await setSetting(MARKET_KEY, 'IT');
    await setSetting(WEIGHT_UNIT_KEY, 'lb');
    const u = await getUnits();
    expect(u.system).toBe('metric'); // body weight unchanged on update
    expect(u.gym).toBe('lb');
    expect(u.gymUnit).toBe('lb');
  });

  it('lets an old "kg" follow the app', async () => {
    await setSetting(WEIGHT_UNIT_KEY, 'kg');
    await setUnitSystem('us');
    expect((await getUnits()).gymUnit).toBe('lb');
  });

  it('can hold the other unit from the app', async () => {
    await setUnitSystem('us');
    await setGymChoice('kg');
    expect((await getUnits()).gymUnit).toBe('kg');
    await setGymChoice('follow');
    expect((await getUnits()).gymUnit).toBe('lb');
  });
});

describe('every write stays metric', () => {
  it('stores a weigh-in typed in pounds as unrounded kilograms', async () => {
    await upsertWeighIn('2026-10-21', fromBodyUnit(180, 'us'), {
      waist_cm: fromLengthUnit(34, 'us'),
    });
    const [w] = await listWeighIns();
    expect(w!.weight_kg).toBeCloseTo(81.6466266, 7);
    expect(w!.waist_cm).toBeCloseTo(86.36, 10);
    // And it reads back as what the scale said.
    expect(toBodyUnit(w!.weight_kg, 'us').toFixed(1)).toBe('180.0');
  });

  it('stores water typed in fluid ounces as whole millilitres', async () => {
    await addWater('2026-10-21', flOzToMl(16));
    const [l] = await listWaterForDate('2026-10-21');
    expect(l!.ml).toBe(473);
  });

  it('converts ounces to grams by the definition', () => {
    expect(fromFoodUnit(4, 'us')).toBeCloseTo(113.398092, 6);
  });
});
