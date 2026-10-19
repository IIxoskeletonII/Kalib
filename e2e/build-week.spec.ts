// SPEC §20.9 — writing a week, end to end, on the real exercise library.
//
// The generator passed 29 unit tests while writing a strongman car flip into a beginner's day,
// so the thing worth guarding is what a person sees: the week the real catalogue produces, that
// it survives a detour to watch an exercise, and that it lands as routines that can be undone.
import { expect, test } from '@playwright/test';

test('a week is built, previewed, added as routines, and undone', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Your name').fill('Builder');
  await page.getByLabel('Birth date').fill('1992-03-14');
  await page.getByLabel('Height').fill('180');
  await page.getByLabel('Weight today').fill('80');
  await page.getByLabel('Target weight').fill('78');
  await page.getByRole('button', { name: 'Start tracking' }).click();
  await expect(page.getByText('Left today')).toBeVisible();

  await page.goto('/train');
  await page.getByRole('button', { name: 'Build a week for me' }).click();
  await expect(page).toHaveURL(/\/train\/build/);

  // The library seeds in the background on first run; the preview fills in once it lands.
  await expect(page.getByRole('region', { name: 'Full body A' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('radio', { name: '4' }).click();
  await expect(page.getByRole('region', { name: 'Upper A' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Lower B' })).toBeVisible();
  // A named movement, not whatever scored: the regression this module was built through.
  await expect(page.getByRole('region', { name: 'Upper A' })).toContainText(/Bench Press/);

  // Body weight cannot train everything properly, and says so rather than hiding it.
  await page.getByRole('radio', { name: 'Body weight' }).click();
  await expect(page.getByText(/stand-in/)).toBeVisible();
  await expect(page.getByText(/boxing/i)).toHaveCount(0);
  await page.getByRole('radio', { name: 'Gym' }).click();
  await expect(page.getByText(/stand-in/)).toHaveCount(0);

  // Watching an exercise and coming back keeps the week you chose.
  await page.getByRole('region', { name: 'Upper A' }).getByRole('button').first().click();
  await expect(page).toHaveURL(/\/train\/exercise\//);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('region', { name: 'Upper A' })).toBeVisible();

  await page.getByRole('button', { name: 'Add 4 routines' }).click();
  await expect(page).toHaveURL(/\/train$/);
  for (const day of ['Upper A', 'Lower A', 'Upper B', 'Lower B']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${day}\\b`) })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('No routines yet')).toBeVisible();

  // Twice over, the second week is numbered rather than colliding with the first.
  for (let i = 0; i < 2; i++) {
    await page.goto('/train/build?days=4&kit=gym');
    await page.getByRole('button', { name: 'Add 4 routines' }).click();
    await expect(page).toHaveURL(/\/train$/);
  }
  await expect(page.getByRole('button', { name: /^Upper A \(2\)/ })).toBeVisible();

  // §20.10: the week just written starts at its first day...
  const upNext = page.getByRole('region', { name: 'Up next' });
  await expect(upNext).toContainText('Upper A');
  await expect(upNext).toContainText('first in your list');

  // ...and once that day is done, the card moves on to the one after it.
  await page.evaluate(async () => {
    const req = indexedDB.open('kalib');
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    type Row = { id: string; name: string; deleted_at?: string | null };
    const routines = await new Promise<Row[]>((res) => {
      const r = db.transaction('routines', 'readonly').objectStore('routines').getAll();
      r.onsuccess = () => res(r.result as Row[]);
    });
    // The live one: the week added and undone above is still in the store, soft-deleted, and a
    // session from a deleted routine rightly says nothing about the rotation.
    const upper = routines.find((r) => r.name === 'Upper A' && !r.deleted_at);
    const at = new Date(Date.now() - 26 * 3600_000);
    const tx = db.transaction('workout_sessions', 'readwrite');
    tx.objectStore('workout_sessions').put({
      id: 'e2e-upper-a',
      user_id: 'local',
      created_at: at.toISOString(),
      updated_at: at.toISOString(),
      started_at: at.toISOString(),
      ended_at: new Date(at.getTime() + 3600_000).toISOString(),
      routine_id: upper?.id,
      name: 'Upper A',
      entries: [],
    });
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  });
  // Written past Dexie, so its live queries cannot see it; a fresh load is what returning to
  // Train after finishing a session looks like anyway.
  await page.reload();
  await expect(upNext).toContainText('Lower A');
  await expect(upNext).toContainText('after Upper A');
});
