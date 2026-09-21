// Day one, end to end: onboard, weigh in, log a food from the offline database, build a recipe,
// put it in the week, see it on the shopping list. Runs against `dist/` with a fresh profile,
// so it also proves the seed and the service worker do not get in the way of first use.
import { expect, test, type Page } from '@playwright/test';

/** Types on the app's own number pad (SPEC §8: no OS keyboard for numbers). */
async function pad(page: Page, digits: string) {
  const keys = page.getByRole('group', { name: 'Number pad' });
  for (const d of digits) await keys.getByRole('button', { name: d, exact: true }).click();
}

test('onboard, weigh in, log, cook a recipe into the week', async ({ page }) => {
  // --- onboarding -------------------------------------------------------------------------
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel('Your name').fill('Test');
  await page.getByLabel('Birth date').fill('1996-04-02');
  await page.getByLabel('Height').fill('180');
  await page.getByLabel('Weight today').fill('84');
  await page.getByLabel('Body fat (optional)').fill('22');
  await page.getByRole('button', { name: 'Start tracking' }).click();

  // Today: a calorie target exists and the ring is drawn from it.
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await expect(page.getByText('Left today')).toBeVisible();

  // --- weigh in ---------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Weight' }).click();
  await expect(page.getByRole('dialog', { name: 'Weigh-in' })).toBeVisible();
  await pad(page, '83.6');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Weigh-in' })).toBeHidden();
  await expect(page.getByText('83.6kg')).toBeVisible();

  // --- log a food from the offline database ---------------------------------------------
  await page.goto('/log');
  const search = page.getByRole('searchbox');
  await expect(search).toHaveAttribute('placeholder', 'Search foods'); // seed has landed
  await search.fill('chicken breast');
  await page
    .getByRole('button', { name: /^Chicken, breast/ })
    .first()
    .click();
  await pad(page, '150');
  await page.getByRole('button', { name: /^Log · [\d,]+ kcal$/ }).click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await expect(page.getByText(/^Chicken, breast/).first()).toBeVisible();

  // --- a recipe with one ingredient -----------------------------------------------------
  await page.goto('/recipes');
  await page.getByRole('button', { name: 'New recipe' }).click();
  await page.getByPlaceholder('Name, e.g. Chicken & rice').fill('Rice bowl');
  await page.getByRole('button', { name: 'Add ingredients' }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: 'Add ingredient' }).click();
  await expect(page).toHaveURL(/\/log\?recipe=/);
  await page.getByRole('searchbox').fill('rice white');
  await page
    .getByRole('button', { name: /^Rice, white/ })
    .first()
    .click();
  await pad(page, '400');
  await page.getByRole('button', { name: /^Add ingredient · [\d,]+ kcal$/ }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]+$/);
  await expect(page.getByText(/^Rice, white/).first()).toBeVisible();

  // --- plan the week ----------------------------------------------------------------------
  await page.goto('/plan');
  await page.getByRole('button', { name: 'This week', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
  await expect(page.getByText('Rice bowl').first()).toBeVisible();
  await page.getByRole('link', { name: /Shopping list/ }).click();
  await expect(page).toHaveURL(/\/plan\/shopping/);
  await expect(page.getByRole('checkbox', { name: /^Rice, white/ })).toBeVisible();
  await expect(page.getByText('Grains & pasta')).toBeVisible();
});
