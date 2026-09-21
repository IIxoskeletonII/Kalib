// SPEC §2.3 / §12: logging works with no network at all. After one online visit (service worker
// installed, food database seeded) the app is cut off, reloaded, and used.
import { expect, test, type Page } from '@playwright/test';

async function pad(page: Page, digits: string) {
  const keys = page.getByRole('group', { name: 'Number pad' });
  for (const d of digits) await keys.getByRole('button', { name: d, exact: true }).click();
}

/** True once every seed file has been written (settings `seed_version:*` at the current version). */
async function seeded(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const open = indexedDB.open('kalib');
    const db = await new Promise<IDBDatabase>((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const rows = await new Promise<{ key: string; value: unknown }[]>((res) => {
      const r = db.transaction('settings', 'readonly').objectStore('settings').getAll();
      r.onsuccess = () => res(r.result as { key: string; value: unknown }[]);
    });
    db.close();
    const seeds = rows.filter((s) => s.key.startsWith('seed_version:'));
    return seeds.length === 3 && seeds.every((s) => typeof s.value === 'number');
  });
}

test('the app loads and logs with the network cut', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel('Your name').fill('Offline');
  await page.getByLabel('Birth date').fill('1990-01-01');
  await page.getByLabel('Height').fill('170');
  await page.getByLabel('Weight today').fill('70');
  await page.getByLabel('Target weight').fill('65');
  await page.getByRole('button', { name: 'Start tracking' }).click();
  await expect(page.getByText('Left today')).toBeVisible();

  // Service worker active (shell precached) and the whole food database on the device.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => seeded(page), { timeout: 30_000 }).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Left today')).toBeVisible();

  await page.goto('/log');
  const search = page.getByRole('searchbox');
  await search.fill('banana');
  await page
    .getByRole('button', { name: /^Banana/ })
    .first()
    .click();
  await pad(page, '120');
  await page.getByRole('button', { name: /^Log · [\d,]+ kcal$/ }).click();
  await expect(page.getByText(/^Banana/).first()).toBeVisible();
  await context.setOffline(false);
});
