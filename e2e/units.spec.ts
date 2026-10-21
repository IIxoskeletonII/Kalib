// SPEC §22 — the same app in US units, end to end.
//
// Every test here types or reads a measurement in pounds, inches, feet or ounces, and then reads
// the database to prove what was stored is still metric. The rest of the suite runs in metric
// and is the proof that nothing there moved.
import { expect, test, type Page } from '@playwright/test';

const KG_PER_LB = 0.45359237;
const G_PER_OZ = (KG_PER_LB * 1000) / 16;

/** A profile, a fortnight of weigh-ins, one logged meal and one workout; units as given. */
async function seed(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (settings) => {
    const req = indexedDB.open('kalib');
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const now = new Date().toISOString();
    const day = (back: number) => {
      const d = new Date();
      d.setDate(d.getDate() - back);
      return d.toLocaleDateString('en-CA');
    };
    const meta = (id: string) => ({ id, user_id: 'local', created_at: now, updated_at: now });
    const tx = db.transaction(
      ['profiles', 'weigh_ins', 'foods', 'log_entries', 'recipes', 'workout_sessions', 'settings'],
      'readwrite',
    );
    const put = (store: string, row: object) => tx.objectStore(store).put(row);
    put('profiles', {
      ...meta('units-profile'),
      sex: 'male',
      birth_date: '1990-01-15',
      height_cm: 178,
      activity_level: 'light',
      mode: 'CUT',
      goal_rate_kg_per_week: 0.5,
      target_weight_kg: 75,
    });
    // Yesterday back: today is left for the test to weigh in.
    for (let i = 14; i >= 1; i--) {
      put('weigh_ins', {
        ...meta(`units-w${i}`),
        date: day(i),
        weight_kg: 82,
        source: 'manual',
      });
    }
    put('foods', {
      ...meta('units-food'),
      source: 'custom',
      name: 'Units oats',
      per_100g: { kcal: 380, protein: 13, carb: 60, fat: 7, fiber: 10 },
      micros: {},
      micro_coverage: 0,
      portions: [],
      verified: false,
    });
    put('log_entries', {
      ...meta('units-entry'),
      logged_at: now,
      date: day(0),
      meal_slot: 'breakfast',
      name: 'Units oats',
      food_id: 'units-food',
      grams: 250,
      servings: 1,
      kcal: 950,
      protein_g: 32.5,
      carb_g: 150,
      fat_g: 17.5,
      fiber_g: 25,
      micros: {},
      entry_method: 'search',
      confidence: 'high',
    });
    put('recipes', {
      ...meta('units-recipe'),
      name: 'Units porridge',
      items: [{ food_id: 'units-food', name: 'Units oats', grams: 250 }],
      portions: 2,
      food_id: 'units-food',
      steps: ['Cook the oats.'],
      source: 'own',
    });
    put('workout_sessions', {
      ...meta('units-session'),
      started_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      ended_at: new Date(Date.now() - 2 * 86_400_000 + 3_600_000).toISOString(),
      name: 'Units day',
      volume_kg: 1440,
      duration_sec: 3600,
      entries: [
        {
          exercise_id: 'units-exercise',
          name: 'Units press',
          load_type: 'weight_reps',
          sets: [1, 2, 3].map(() => ({
            kind: 'normal',
            weight_kg: 60,
            reps: 8,
            done: true,
          })),
        },
      ],
    });
    for (const [key, value] of Object.entries(settings)) put('settings', { key, value });
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, settings);
  await page.goto('/');
}

/** Every row of a store, as the app wrote it. */
function rows<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(async (store) => {
    const req = indexedDB.open('kalib');
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const all = await new Promise<unknown[]>((res, rej) => {
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return all;
  }, store) as Promise<T[]>;
}

async function setting(page: Page, key: string): Promise<unknown> {
  const all = await rows<{ key: string; value: unknown }>(page, 'settings');
  return all.find((r) => r.key === key)?.value;
}

async function pad(page: Page, digits: string): Promise<void> {
  const keys = page.getByRole('group', { name: 'Number pad' });
  for (const d of digits) await keys.getByRole('button', { name: d, exact: true }).click();
}

const today = () => new Date().toLocaleDateString('en-CA');

/** The weight tile: its button is a bare overlay, and the reading sits beside it in the card. */
const weightTile = (page: Page) =>
  page.getByRole('button', { name: 'Weight', exact: true }).locator('xpath=..');

test.describe('US units', () => {
  test('a weigh-in typed in pounds is stored in kilos and read back in pounds', async ({
    page,
  }) => {
    await seed(page, { unit_system: 'us' });

    await page.getByRole('button', { name: 'Weight', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Weigh-in' });
    await expect(sheet).toContainText('lb');
    await pad(page, '180');
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet).toBeHidden();

    const w = (await rows<{ date: string; weight_kg: number }>(page, 'weigh_ins')).find(
      (r) => r.date === today(),
    )!;
    // Unrounded: a tenth-of-a-kilo store would read back as 179.9 lb.
    expect(w.weight_kg).toBeCloseTo(180 * KG_PER_LB, 9);

    const tile = weightTile(page);
    await expect(tile).toContainText('180.0');
    await expect(tile).toContainText('lb');

    await page.goto('/trend');
    await expect(page.getByText('180.0 lb').first()).toBeVisible();
    // The hero, the 7-day change and the rows below it are all pounds too.
    await expect(page.getByText(/lb in 7 days/)).toBeVisible();
    await expect(page.getByText('180.8 lb').first()).toBeVisible(); // yesterday's 82 kg
  });

  test('reopening a weigh-in and saving it untouched does not move it', async ({ page }) => {
    await seed(page, { unit_system: 'us' });
    await page.getByRole('button', { name: 'Weight', exact: true }).click();
    await pad(page, '180');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const before = (await rows<{ date: string; weight_kg: number }>(page, 'weigh_ins')).find(
      (r) => r.date === today(),
    )!.weight_kg;

    await page.getByRole('button', { name: 'Weight', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const after = (await rows<{ date: string; weight_kg: number }>(page, 'weigh_ins')).find(
      (r) => r.date === today(),
    )!.weight_kg;
    expect(after).toBe(before);
  });

  test('a waist in inches is stored in centimetres', async ({ page }) => {
    await seed(page, { unit_system: 'us' });
    await page.getByRole('button', { name: 'Weight', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Weigh-in' });
    await pad(page, '180');
    await sheet.getByRole('radio', { name: 'Waist' }).click();
    await expect(sheet).toContainText('in');
    await pad(page, '34');
    await expect(sheet).toContainText(/from a 34\.0 in waist/);
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet).toBeHidden();
    const w = (await rows<{ date: string; waist_cm?: number }>(page, 'weigh_ins')).find(
      (r) => r.date === today(),
    )!;
    expect(w.waist_cm).toBeCloseTo(86.36, 9);
  });

  test('water is offered and logged in fluid ounces, stored in millilitres', async ({ page }) => {
    await seed(page, { unit_system: 'us' });
    // The tile's own "+" is an 8 fl oz cup until a glass is chosen.
    await page.getByRole('button', { name: 'Add 8 fl oz of water' }).click();
    await page.getByRole('button', { name: 'Water', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Water' });
    await sheet.getByRole('button', { name: /^12 fl oz$/ }).click();
    await expect(sheet).toContainText('20');
    await expect(sheet).toContainText('fl oz');
    const logs = await rows<{ ml: number; deleted_at?: string }>(page, 'water_logs');
    expect(logs.map((l) => l.ml).sort((a, b) => a - b)).toEqual([237, 355]);

    // A custom amount on the pad, typed in ounces.
    await sheet.getByRole('button', { name: 'Other' }).click();
    await pad(page, '20');
    await sheet.getByRole('button', { name: 'Add 20 fl oz' }).click();
    const after = await rows<{ ml: number }>(page, 'water_logs');
    expect(after.map((l) => l.ml)).toContain(591);

    // And the glass size is chosen in ounces.
    await sheet.getByRole('button', { name: 'Glass size 16 fl oz' }).click();
    expect(await setting(page, 'water_glass_ml')).toBe(473);
  });

  test('the profile reads in feet and pounds, and saving it untouched keeps 178 cm', async ({
    page,
  }) => {
    await seed(page, { unit_system: 'us' });
    await page.goto('/settings');
    await expect(page.getByText(/Male, 5 ft 10 in, born 1990/)).toBeVisible();
    await expect(page.getByText(/at 1\.1 lb a week/)).toBeVisible();
    await expect(page.getByText(/target 165\.3 lb/)).toBeVisible();

    await page.getByText(/Male, 5 ft 10 in/).click();
    await expect(page.getByLabel('Height, feet')).toHaveValue('5');
    await expect(page.getByLabel('Height, inches')).toHaveValue('10');
    await expect(page.getByLabel(/^Target weight/)).toHaveValue('165.3');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByLabel('Height, feet')).toBeHidden();

    const newest = async () =>
      (
        await rows<{
          height_cm: number;
          target_weight_kg: number;
          goal_rate_kg_per_week: number;
          created_at: string;
        }>(page, 'profiles')
      )
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .at(-1)!;
    await expect.poll(async () => (await rows(page, 'profiles')).length).toBe(2);
    const p1 = await newest();
    expect(p1!.height_cm).toBe(178);
    expect(p1!.target_weight_kg).toBe(75);
    expect(p1!.goal_rate_kg_per_week).toBe(0.5);

    // Now change it, in feet and inches and a pound a week.
    await page.getByText(/Male, 5 ft 10 in/).click();
    await page.getByLabel('Height, feet').fill('6');
    await page.getByLabel('Height, inches').fill('1');
    await page.getByRole('button', { name: /^1 lb \/ wk$/ }).click();
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText(/Male, 6 ft 1 in/)).toBeVisible();
    const latest = await newest();
    expect(latest.height_cm).toBeCloseTo(185.42, 9);
    expect(latest.goal_rate_kg_per_week).toBeCloseTo(KG_PER_LB, 12);
  });

  test('a logged food reads in ounces, and is edited in them without drifting', async ({
    page,
  }) => {
    await seed(page, { unit_system: 'us' });
    // The favourite tile and the diary row both say ounces; macros stay grams in either system.
    const favourite = page.getByRole('button', { name: 'Units oats 8.8 oz · 950 kcal' });
    await expect(favourite).toBeVisible();
    const row = page.getByRole('button', { name: /Units oats.*g protein/ });
    await expect(row).toContainText('8.8 oz · 33 g protein');

    // Untouched: the stored 250 g stays 250 g, not 8.8 oz × 28.35 = 249.5 g.
    await row.click();
    await page.getByRole('button', { name: /^Update/ }).click();
    let entry = (await rows<{ id: string; grams: number }>(page, 'log_entries')).find(
      (e) => e.id === 'units-entry',
    )!;
    expect(entry.grams).toBe(250);

    // Typed: 4 oz is 113.4 g.
    await row.click();
    const measure = page.getByRole('radiogroup', { name: 'Measure' });
    await expect(measure.getByRole('radio', { name: 'oz', exact: true })).toBeChecked();
    await pad(page, '4');
    await page.getByRole('button', { name: /^Update/ }).click();
    entry = (await rows<{ id: string; grams: number }>(page, 'log_entries')).find(
      (e) => e.id === 'units-entry',
    )!;
    expect(entry.grams).toBeCloseTo(4 * G_PER_OZ, 1);
    await expect(row).toContainText(/^Units oats4 oz · /);
  });

  test('a recipe reads in ounces, and its cooked weight is weighed in them', async ({ page }) => {
    await seed(page, { unit_system: 'us' });
    await page.goto('/recipes/units-recipe');
    await expect(page.getByRole('button', { name: /^Units oats/ })).toContainText('8.8 oz');
    await page.getByRole('button', { name: /^Cooked weight/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Cooked weight' });
    await expect(sheet).toContainText('oz');
    await pad(page, '20.5');
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet).toBeHidden();
    const recipe = (await rows<{ id: string; yield_g?: number }>(page, 'recipes')).find(
      (r) => r.id === 'units-recipe',
    )!;
    expect(recipe.yield_g).toBeCloseTo(20.5 * G_PER_OZ, 9);
    await expect(page.getByRole('button', { name: /^Cooked weight/ })).toContainText('20.5 oz');
  });

  test('the gym follows the units, unless it is told otherwise', async ({ page }) => {
    await seed(page, { unit_system: 'us' });
    await page.goto('/train/summary/units-session');
    // 1,440 kg is 3,175 lb.
    await expect(page.getByLabel('Session totals')).toContainText('3,175');
    await expect(page.getByLabel('Session totals')).toContainText('lb');

    await page.goto('/settings');
    await page.getByRole('radio', { name: 'kg', exact: true }).click();
    expect(await setting(page, 'gym_unit')).toBe('kg');
    await page.goto('/train/summary/units-session');
    await expect(page.getByLabel('Session totals')).toContainText('1,440');
    await expect(page.getByLabel('Session totals')).toContainText('kg');
  });
});

test.describe('the switch', () => {
  test('flipping it changes what every screen says and nothing that is stored', async ({
    page,
  }) => {
    await seed(page, { unit_system: 'metric' });
    const tile = weightTile(page);
    await expect(page.getByRole('button', { name: 'Add 250 ml of water' })).toBeVisible();

    const before = await rows<{ id: string; weight_kg: number }>(page, 'weigh_ins');
    await page.goto('/settings');
    const units = page.getByRole('region', { name: 'Units' });
    await units.getByRole('radio', { name: 'US' }).click();
    await expect(units).toContainText('Pounds');
    expect(await setting(page, 'unit_system')).toBe('us');

    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Add 8 fl oz of water' })).toBeVisible();
    await expect(tile).toContainText(/last 180\.8/);
    const after = await rows<{ id: string; weight_kg: number }>(page, 'weigh_ins');
    expect(after).toEqual(before);

    await page.goto('/settings');
    await page
      .getByRole('region', { name: 'Units' })
      .getByRole('radio', { name: 'Metric' })
      .click();
    await page.goto('/');
    await expect(tile).toContainText(/last 82\.0/);
  });

  test('a first run writes down its guess, so a trip abroad cannot change it', async ({ page }) => {
    await seed(page, {});
    await expect.poll(() => setting(page, 'unit_system')).toBe('metric');
  });

  test('a lifter who set pounds before §22 keeps pounds at the bar and kilos on the scale', async ({
    page,
  }) => {
    await seed(page, { weight_unit: 'lb', unit_system: 'metric' });
    await expect(weightTile(page)).toContainText('82.0');
    await page.goto('/train/summary/units-session');
    await expect(page.getByLabel('Session totals')).toContainText('3,175');
  });
});

test.describe('onboarding', () => {
  test('asks for units first and takes feet, inches and pounds', async ({ page }) => {
    await page.goto('/onboarding');
    await page.getByRole('radio', { name: 'US' }).click();
    await page.getByLabel('Your name').fill('Sam');
    await page.getByLabel('Birth date').fill('1992-03-04');
    await page.getByLabel('Height, feet').fill('5');
    await page.getByLabel('Height, inches').fill('9');
    await page.getByLabel('Weight today').fill('170');
    await page.getByLabel(/^Target weight/).fill('160');
    await page.getByRole('button', { name: 'Start tracking' }).click();
    await expect(page).toHaveURL(/\/$/);

    const [profile] = await rows<{
      height_cm: number;
      target_weight_kg: number;
      goal_rate_kg_per_week: number;
    }>(page, 'profiles');
    expect(profile!.height_cm).toBeCloseTo(175.26, 9);
    expect(profile!.target_weight_kg).toBeCloseTo(160 * KG_PER_LB, 9);
    // The default rate in pounds is a pound a week, not half a kilo shown as 1.1 lb.
    expect(profile!.goal_rate_kg_per_week).toBeCloseTo(KG_PER_LB, 12);
    const [w] = await rows<{ weight_kg: number }>(page, 'weigh_ins');
    expect(w!.weight_kg).toBeCloseTo(170 * KG_PER_LB, 9);
    expect(await setting(page, 'unit_system')).toBe('us');
  });
});
