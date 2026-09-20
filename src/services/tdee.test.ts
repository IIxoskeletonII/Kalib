import { beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '@/core/dates';
import { db } from '@/db/db';
import { getDailyTarget } from '@/db/repo/dailyTargets';
import { addEntry } from '@/db/repo/logEntries';
import { saveProfileSnapshot } from '@/db/repo/profiles';
import { getSetting } from '@/db/repo/settings';
import { latestTdeeEstimate, listTdeeEstimates } from '@/db/repo/tdeeEstimates';
import { upsertWeighIn } from '@/db/repo/weighIns';
import { ensureTargetForDate, formulaTargets, getPublishedTdee } from './targets';
import {
  PENDING_TDEE_KEY,
  acceptPendingTdee,
  dismissPendingTdee,
  tdeeState,
  type PendingTdee,
} from './tdee';

const DAY1 = '2026-09-21'; // a Monday

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
    bodyfat_pct: 35,
  });
});

/** `n` days of a steady person: weight falling `lossPerDay` kg, eating `kcal` a day. */
async function seedDays(n: number, kcal: number, lossPerDay: number) {
  for (let i = 0; i < n; i++) {
    const date = addDays(DAY1, i);
    await upsertWeighIn(date, Math.round((110 - i * lossPerDay) * 10) / 10);
    await ensureTargetForDate(date);
    await addEntry({
      logged_at: `${date}T12:00:00.000Z`,
      date,
      meal_slot: 'lunch',
      name: 'Day',
      grams: 0,
      servings: 1,
      kcal,
      protein_g: 150,
      carb_g: 200,
      fat_g: 70,
      fiber_g: 30,
      micros: {},
      entry_method: 'manual',
      confidence: 'high',
    });
  }
}

describe('tdeeState', () => {
  it('is calibrating before day 24 and publishes nothing', async () => {
    await seedDays(20, 2200, 0.08);
    const s = await tdeeState(addDays(DAY1, 19));
    expect(s.result.status).toBe('calibrating');
    expect(s.published).toBeUndefined();
    expect(await listTdeeEstimates()).toEqual([]);
  });

  it('stores the estimate and publishes with the ±150 cap on the first estimate day', async () => {
    // 2,200 kcal and −0.08 kg/day → measured ≈ 2,200 + 616 = 2,816
    await seedDays(24, 2200, 0.08);
    const today = addDays(DAY1, 23);
    const formula = (await formulaTargets(today))!;
    const s = await tdeeState(today);
    expect(s.result.status).toBe('ok');
    expect((await latestTdeeEstimate())?.computed_on).toBe(today);
    const published = (await getPublishedTdee())!;
    expect(published.since).toBe(today);
    expect(Math.abs(published.tdee - formula.tdee)).toBeLessThanOrEqual(150);
    // Today's stored target now runs on the measured TDEE.
    const t = (await getDailyTarget(today))!;
    expect(t.source).toBe('measured');
    expect(t.provisional).toBe(false);
    // Yesterday's target stays on the formula (§4.4: no retroactive churn).
    expect((await getDailyTarget(addDays(today, -1)))!.source).toBe('formula');
  });

  it('publishes once per ISO week, then steps again the next Monday', async () => {
    await seedDays(32, 2200, 0.08);
    const wed = addDays(DAY1, 23); // day 24, a Wednesday
    await tdeeState(wed);
    const first = (await getPublishedTdee())!;
    await tdeeState(addDays(wed, 2)); // Friday: same week, no change
    expect((await getPublishedTdee())!.since).toBe(first.since);
    const monday = addDays(DAY1, 28); // day 29
    await tdeeState(monday);
    const second = (await getPublishedTdee())!;
    expect(second.since).toBe(monday);
    expect(Math.abs(second.tdee - first.tdee)).toBeLessThanOrEqual(150);
  });

  it('parks a measurement >600 kcal from the formula, and applies it only on request', async () => {
    // 2,200 kcal and −0.2 kg/day → measured ≈ 3,740, far above any formula for this profile.
    await seedDays(24, 2200, 0.2);
    const today = addDays(DAY1, 23);
    const s = await tdeeState(today);
    expect(s.result.status).toBe('ok');
    expect(s.published).toBeUndefined();
    expect(s.pending?.diverged).toBe(true);
    expect((await getDailyTarget(today))!.source).toBe('formula');

    await dismissPendingTdee(today);
    const s2 = await tdeeState(today);
    expect(s2.pending).toBeUndefined();
    expect(await getPublishedTdee()).toBeUndefined();

    const pending = (await getSetting<PendingTdee>(PENDING_TDEE_KEY))!;
    await acceptPendingTdee(today);
    const published = (await getPublishedTdee())!;
    expect(published.tdee).toBe(pending.tdee); // capped value, not the raw measurement
    expect(published.tdee).toBeLessThan(pending.measured);
    expect((await getDailyTarget(today))!.source).toBe('measured');
  });
});
