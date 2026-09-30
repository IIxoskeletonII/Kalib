import { beforeEach, describe, expect, it } from 'vitest';
import { relativeFatMass } from '@/core/body';
import { db } from '@/db/db';
import { saveProfileSnapshot } from '@/db/repo/profiles';
import { clearWaist, upsertWeighIn } from '@/db/repo/weighIns';
import { listWeighIns } from '@/db/repo/weighIns';
import { getCurrentProfile } from '@/db/repo/profiles';
import { bodyFatFor, currentTargets } from './targets';

const DAY1 = '2026-09-21';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await saveProfileSnapshot({
    sex: 'male',
    birth_date: '2003-03-15',
    height_cm: 186,
    activity_level: 'light',
    mode: 'CUT',
    goal_rate_kg_per_week: 0.5,
    bodyfat_pct: 35, // §14's low-confidence self-estimate
  });
});

async function resolve(date: string) {
  const [profile, weighIns] = await Promise.all([getCurrentProfile(), listWeighIns()]);
  return bodyFatFor(profile!, weighIns, date);
}

describe('bodyFatFor', () => {
  it('falls back to the onboarding estimate when nothing has been measured', async () => {
    await upsertWeighIn(DAY1, 110);
    expect(await resolve(DAY1)).toEqual({ pct: 35, source: 'profile' });
  });

  it('prefers RFM from a waist measurement over the self-estimate', async () => {
    await upsertWeighIn(DAY1, 110, { waist_cm: 110 });
    const e = (await resolve(DAY1))!;
    expect(e.source).toBe('waist');
    expect(e.pct).toBeCloseTo(relativeFatMass(186, 110, 'male'), 6);
    expect(e.pct).toBeCloseTo(30.18, 2);
  });

  it('prefers an entered reading over the waist', async () => {
    await upsertWeighIn(DAY1, 110, { waist_cm: 110, bodyfat_pct: 28 });
    expect(await resolve(DAY1)).toEqual({ pct: 28, source: 'measured' });
  });

  it('carries the last known waist forward on days without one', async () => {
    await upsertWeighIn(DAY1, 110, { waist_cm: 110 });
    await upsertWeighIn('2026-09-28', 108);
    const e = (await resolve('2026-09-28'))!;
    expect(e.source).toBe('waist');
    expect(e.waist_cm).toBe(110);
  });

  it('uses the newest waist, not the first', async () => {
    await upsertWeighIn(DAY1, 110, { waist_cm: 110 });
    await upsertWeighIn('2026-09-28', 108, { waist_cm: 106 });
    expect((await resolve('2026-09-28'))!.waist_cm).toBe(106);
  });

  it('ignores measurements taken after the day being asked about', async () => {
    await upsertWeighIn(DAY1, 110);
    await upsertWeighIn('2026-10-15', 106, { waist_cm: 100 });
    expect(await resolve(DAY1)).toEqual({ pct: 35, source: 'profile' });
  });

  it('goes back to the estimate once a mistyped waist is cleared', async () => {
    await upsertWeighIn(DAY1, 110, { waist_cm: 11 }); // a slipped decimal point
    await clearWaist(DAY1);
    expect(await resolve(DAY1)).toEqual({ pct: 35, source: 'profile' });
  });
});

describe('a waist measurement reaches the §3 targets', () => {
  it('moves lean mass, and with it the protein target', async () => {
    await upsertWeighIn(DAY1, 110);
    const guessed = (await currentTargets(DAY1))!;
    // 35% of 110 kg is 71.5 kg lean; RFM from a 110 cm waist says 30.2%, so 76.8 kg.
    await upsertWeighIn(DAY1, 110, { waist_cm: 110 });
    const measured = (await currentTargets(DAY1))!;
    expect(measured.lbm_kg!).toBeGreaterThan(guessed.lbm_kg!);
    expect(measured.protein_g).toBeGreaterThan(guessed.protein_g);
  });

  it('leaves every other input alone', async () => {
    await upsertWeighIn(DAY1, 110);
    const before = (await currentTargets(DAY1))!;
    await upsertWeighIn(DAY1, 110, { waist_cm: 110 });
    const after = (await currentTargets(DAY1))!;
    expect(after.water_ml).toBe(before.water_ml);
    expect(after.tdee_source).toBe(before.tdee_source);
  });
});
