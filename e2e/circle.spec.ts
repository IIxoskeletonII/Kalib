// SPEC §21 — the circle, signed in, against a stand-in server.
//
// The sweep sees this screen signed out, because the sweep always is. Here a session is planted
// and every request to Supabase is answered by a small in-memory model of the circle's server
// functions, so the screen can be walked as a person would walk it: start a circle, make a code,
// see yourself on the board, change your aim, turn hard mode on, join with a bad code, leave.
//
// Nothing here reaches a real server. Every request to the Supabase host is fulfilled by the
// route below, and anything the model does not know is answered 404 rather than let through.
import { expect, test } from '@playwright/test';
import { onboard, serve, signIn, stubServer, supabaseHost } from './circle-stub';

test('signed out, the circle says what it would share before asking for anything', async ({
  page,
}) => {
  await onboard(page);
  await page.goto('/train/circle');
  await expect(page.getByRole('heading', { name: 'Circle', level: 1 })).toBeVisible();
  // One of the two: this build has no server, or it has one and nobody is signed in.
  await expect(page.getByText(/Circles need an account|Sign in to start a circle/)).toBeVisible();
  const signedOut = await page.getByText('Sign in to start a circle').isVisible();
  if (signedOut) {
    const shared = page.getByRole('region', { name: 'What is shared' });
    await expect(shared).toContainText('Never your food, your weight, your lifts');
    await page.getByRole('button', { name: 'Open Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
  }
});

test('a circle is started, shared, ranked, tuned and left', async ({ page }) => {
  const host = await supabaseHost(page);
  test.skip(
    !host,
    'this build has no Supabase configured, so there is no signed-in circle to walk',
  );
  const server = stubServer();
  await serve(page, host!, server);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await onboard(page);
  await signIn(page, host!);
  await page.goto('/train/circle');

  // No circle yet: the two ways in, and what would be shared.
  await expect(page.getByText('No circle yet')).toBeVisible();
  await expect(page.getByRole('region', { name: 'What is shared' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your week' })).toBeVisible();

  // A wrong code is refused without saying why.
  await page.getByRole('button', { name: 'Join with a code' }).click();
  const join = page.getByRole('dialog', { name: 'Join a circle' });
  await join.getByLabel('Code').fill('zzzzz-99999');
  await expect(join.getByLabel('Code')).toHaveValue('ZZZZZ-99999');
  await join.getByLabel('Your name in it').fill('Eli');
  await join.getByRole('button', { name: 'Join circle' }).click();
  await expect(join.getByRole('alert')).toHaveText(/did not work/);
  await page.keyboard.press('Escape');

  // Starting one goes straight to inviting.
  await page.getByRole('button', { name: 'Start a circle' }).click();
  const create = page.getByRole('dialog', { name: 'Start a circle' });
  await expect(create.getByRole('button', { name: 'Start circle' })).toBeDisabled();
  await create.getByLabel('Circle name').fill('Home');
  await create.getByLabel('Your name in it').fill('Eli');
  await create.getByRole('button', { name: 'Start circle' }).click();
  const invite = page.getByRole('dialog', { name: 'Invite to Home' });
  await expect(invite).toBeVisible();
  await invite.getByRole('button', { name: 'Make a code' }).click();
  await expect(invite.getByText('ABCDE-23456')).toBeVisible();
  await expect(invite).toContainText('Good until');
  await invite.getByRole('button', { name: 'Stop this code' }).click();
  await expect(invite.getByRole('button', { name: 'Make a code' })).toBeVisible();
  await page.keyboard.press('Escape');

  // What left the phone: the nine allowed fields, integers or null, no more — and, with nothing
  // trained yet, only the week in progress: weeks before the first session are not published.
  expect(server.published.length).toBeGreaterThan(0);
  for (const weeks of server.published) {
    expect(weeks).toHaveLength(1);
    for (const w of weeks) {
      expect(Object.keys(w).sort()).toEqual([
        'consistency',
        'done',
        'flagged',
        'hard',
        'planned',
        'progress',
        'rating',
        'score',
        'week',
      ]);
    }
    expect(JSON.stringify(weeks)).not.toMatch(/Circle|80|kg|@/);
  }

  // The board: the friend with four good weeks first, you after, unranked until you have one.
  const board = page.getByRole('region', { name: 'Board' });
  await expect(board.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(board.getByText('Sam')).toBeVisible();
  await expect(board.getByText('You', { exact: true })).toBeVisible();
  await expect(board.getByLabel('Rank 1')).toBeVisible();

  // The aim is the run's: one number for the app, changed where the run is, and what the circle
  // is sent next. Auto asks for one day until there are two weeks to go on.
  const week = page.getByRole('region', { name: 'Your week' });
  const aimRow = week.getByRole('button', { name: /Days a week/ });
  await expect(aimRow).toContainText('Auto, one a week for now');
  await expect(week).toContainText('0 of 1 day so far');
  expect(server.published.at(-1)![0]!.planned).toBe(1);
  await aimRow.click();
  await expect(page).toHaveURL(/\/train\/achievements$/);
  const aim = page.getByRole('group', { name: 'Days a week' });
  await aim.getByRole('radio', { name: '3' }).click();
  await expect(aim.getByRole('radio', { name: '3' })).toHaveAttribute('aria-checked', 'true');
  await page.goBack();
  await expect(page).toHaveURL(/\/train\/circle$/);
  await expect(aimRow).toContainText('Your aim, as on your run');
  await expect(week).toContainText('0 of 3 days so far');
  // Opening the circle publishes, so the board carries the new aim.
  await expect.poll(() => server.published.at(-1)?.[0]?.planned).toBe(3);

  const before = server.published.length;
  const hard = week.getByRole('switch', { name: /Hard mode/ });
  await expect(hard).toHaveAttribute('aria-checked', 'false');
  await hard.click();
  await expect(hard).toHaveAttribute('aria-checked', 'true');
  await expect(hard).toContainText(/Rating 1000 · 3 skips left this month/);
  await hard.click();
  await expect(hard).toHaveAttribute('aria-checked', 'false');
  expect(server.published.length).toBeGreaterThanOrEqual(before);

  // Leaving asks first, then takes you back to no circle.
  await page.getByRole('button', { name: 'Leave Home' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave Home?' });
  await expect(leave).toContainText('everything you shared is deleted');
  await leave.getByRole('button', { name: 'Leave circle' }).click();
  await expect(page.getByText('No circle yet')).toBeVisible();

  expect(errors).toEqual([]);
});
