// The beta-tester pass: walk every screen the app declares, press every control that is safe to
// press, and check the things a person notices before they notice a feature.
//
// It exists because a screen shipped tested and still arrived wrong: "How Kalib works" opened
// 1,718 px down its own page, because the app scrolls inside <main> and nothing reset it. No
// unit test could see that, the feature's own harness did not look for it, and the harnesses
// that might have were one-off files in .cache that no later change ever re-ran.
//
// So the rules here are: it is committed, it runs in the gate after every change, and it derives
// the list of screens from App.tsx so a new one cannot quietly go unswept.
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

/** Rows the sweep plants so the screens behind an id have something to show. */
const ID = {
  food: 'sweep-food',
  recipe: 'sweep-recipe',
  entry: 'sweep-entry',
  exercise: 'sweep-exercise',
  routine: 'sweep-routine',
  done: 'sweep-session-done',
  live: 'sweep-session-live',
} as const;

interface Visit {
  /** The URL to open, or null to skip with a stated reason. */
  url: string | null;
  why?: string;
  /** Run before visiting, for a screen that needs a state the others must not see. */
  setup?: (page: Page) => Promise<void>;
}

/**
 * Every route, and how to reach it. Checked against App.tsx below, so adding a screen without
 * adding it here fails the suite rather than slipping through unswept.
 */
const VISITS: Record<string, Visit> = {
  '/': { url: '/' },
  '/log': { url: '/log' },
  '/quick': { url: '/quick' },
  '/quick/:id': { url: `/quick/${ID.entry}` },
  '/trend': { url: '/trend' },
  '/train': { url: '/train' },
  '/train/exercise/:id': { url: `/train/exercise/${ID.exercise}` },
  '/train/routine/:id': { url: `/train/routine/${ID.routine}` },
  '/train/build': { url: '/train/build?days=4&kit=dumbbells' },
  '/train/summary/:id': { url: `/train/summary/${ID.done}` },
  '/coach': { url: '/coach' },
  '/settings': { url: '/settings' },
  '/settings/how': { url: '/settings/how' },
  '/foods': { url: '/foods' },
  '/foods/new': { url: '/foods/new' },
  '/foods/:id': { url: `/foods/${ID.food}` },
  '/supplements': { url: '/supplements' },
  '/recipes': { url: '/recipes' },
  '/recipes/import': { url: '/recipes/import' },
  '/recipes/:id': { url: `/recipes/${ID.recipe}` },
  '/recipes/:id/cook': { url: `/recipes/${ID.recipe}/cook` },
  '/plan': { url: '/plan' },
  '/plan/shopping': { url: '/plan/shopping' },
  '/estimate': { url: '/estimate' },
  '/menu': { url: '/menu' },
  '/review': { url: '/review' },
  // Last: it is the only one that needs a workout in progress, and that puts the active-workout
  // bar over every other screen.
  '/train/session': { url: '/train/session', setup: startLiveSession },
  '/onboarding': {
    url: null,
    why: 'walked end to end by day-one.spec.ts, and redirects away once a profile exists',
  },
};

/**
 * Controls the sweep must not press, by name. Named rather than guessed: anything that deletes,
 * signs out, leaves the app, or spends a request against the EUR 1/month ceiling.
 */
const DO_NOT_PRESS =
  /delete|remove|erase|sign out|log out|clear|reset|unlink|export|share|backup|restore|download|install|sign in|sign up|subscribe|donate|contribute|publish|send|discard|finish|end workout/i;

/** Console noise that is the harness's own doing, not the app's. */
const NOT_OURS =
  /favicon|ERR_INTERNET_DISCONNECTED|Failed to load resource.*\/api\/|speech|React DevTools/i;

const MAX_CONTROLS_PER_SCREEN = 24;

// ---------------------------------------------------------------------------------------------

test('every route App.tsx declares is in the sweep', () => {
  const declared = [...readFileSync('src/App.tsx', 'utf8').matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((m) => m[1] as string)
    .filter((p) => p !== '*');
  expect(declared.length, 'the Route regex still matches something').toBeGreaterThan(20);
  expect(
    declared.filter((r) => !(r in VISITS)),
    'screens added but never swept',
  ).toEqual([]);
  expect(
    Object.keys(VISITS).filter((r) => !declared.includes(r)),
    'swept but gone',
  ).toEqual([]);
});

test.describe('every screen', () => {
  // One test per screen, run in parallel: a screen that breaks names itself in the report
  // instead of being one line in a wall of findings, and the whole walk takes a couple of
  // minutes rather than nine.
  // Six minutes because the screens with the most controls press two dozen of them, each from
  // a fresh load, while eight workers share one machine. It is a ceiling for a hang, not a
  // budget: the slowest screen runs in about two.
  test.describe.configure({ mode: 'parallel', timeout: 6 * 60_000 });

  for (const [route, visit] of Object.entries(VISITS)) {
    const title = `${route} renders, behaves, and lets you out`;
    if (!visit.url) {
      test.skip(title, () => {
        test.info().annotations.push({ type: 'why', description: visit.why ?? '' });
      });
      continue;
    }
    const url = visit.url;

    test(title, async ({ page }) => {
      const problems: string[] = [];
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !NOT_OURS.test(m.text())) errors.push(m.text().slice(0, 160));
      });
      page.on('pageerror', (e) => errors.push(`uncaught: ${String(e).slice(0, 160)}`));
      // A file chooser left open blocks every action after it.
      page.on('filechooser', (fc) => void fc.setFiles([]).catch(() => {}));

      await page.goto('/');
      await seed(page);
      if (visit.setup) await visit.setup(page);
      await open(page, url);

      const before = errors.length;
      problems.push(...(await inspect(page)));
      if (errors.length > before) problems.push(`on arrival - ${errors.at(-1)}`);
      problems.push(...(await pressEverything(page, url, errors)));

      expect(problems, ['', ...problems].join('\n')).toEqual([]);
      expect([...new Set(errors)], 'console errors').toEqual([]);
    });
  }
});

test.describe('the sweep itself', () => {
  // A guard that fails at random gets ignored, and one that passes everything guards nothing,
  // so the overlap checks are held to both on a page built to sit either side of the line.
  const page = (bottomRoom: number, scrollTo: number) => `
    <style>
      body { margin: 0; }
      main { height: 100vh; overflow-y: auto; padding-bottom: ${bottomRoom}px; box-sizing: border-box; }
      main button { display: block; width: 100%; height: 60px; }
      nav { position: fixed; left: 0; right: 0; bottom: 0; height: 80px; background: #222; }
      nav button { position: absolute; left: 163px; top: -32px; width: 64px; height: 64px; }
    </style>
    <main>${Array.from({ length: 16 }, (_, i) => `<button>Row ${i + 1}</button>`).join('')}</main>
    <nav><button>Log food</button></nav>
    <script>document.querySelector('main').scrollTop = ${scrollTo};</script>`;

  const overlaps = (found: string[]) =>
    found.filter((f) => /answers at its centre|does not reach/.test(f));

  test('a row merely scrolled under the floating button is not a finding', async ({ page: p }) => {
    // Room to scroll every row clear, and a scroll position that parks one under the button.
    await p.setContent(page(240, 77));
    const under = await p.evaluate(() => {
      const at = document.elementFromPoint(195, 844 - 80 - 10);
      return at?.textContent ?? '';
    });
    expect(under, 'the fixture really does park something under the button').toBe('Log food');
    expect(overlaps(await inspect(p))).toEqual([]);
  });

  test('a row that can never scroll clear of it still is', async ({ page: p }) => {
    // No room below the list, so the last row ends under the tab bar for good.
    await p.setContent(page(0, 10_000));
    expect(overlaps(await inspect(p)).join('\n')).toMatch(/Row 16/);
  });
});

test.describe('getting around', () => {
  test.describe.configure({ mode: 'parallel', timeout: 2 * 60_000 });

  test('forward starts at the top, back goes where you were', async ({ page }) => {
    // The regression this suite was written for. The app scrolls inside <main>, so neither the
    // browser nor the router manages the offset; hooks/useScrollRestore.ts does.
    await page.goto('/');
    await seed(page);
    await open(page, '/settings');

    const how = page.getByRole('button', { name: 'How Kalib works' });
    await how.scrollIntoViewIfNeeded();
    const left = await settledScroll(page);
    expect(left, 'Settings is long enough for this to mean anything').toBeGreaterThan(200);

    await how.click();
    await expect(page).toHaveURL(/\/settings\/how$/);
    // The URL changes before the lazy chunk renders, and until it does <main> still holds
    // Settings at its old offset — perfectly still, and the wrong thing to measure. Wait for
    // the destination's own heading, which only this screen has, before reading the offset.
    await expect(page.getByRole('heading', { name: 'How Kalib works' })).toBeVisible();
    expect(await settledScroll(page), 'a screen you have never seen starts at its top').toBe(0);

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(how).toBeVisible();
    const back = await settledScroll(page);
    // Within a viewport: content that finishes loading can shift the anchor a little, and the
    // point is that you are back beside the row you tapped, not at an exact pixel.
    expect(Math.abs(back - left)).toBeLessThan(400);
  });

  test('changing the day keeps your place', async ({ page }) => {
    // Today rewrites ?d= through the router with replace. That is the same screen, so it must
    // keep its offset — a blanket scroll-to-top on every location change would break it, and
    // the first version of that fix did.
    await page.goto('/');
    await seed(page);
    await open(page, '/');

    // Pressed through the DOM rather than through Playwright, which scrolls a control into
    // view before clicking it. The week strip lives at the top of Today, so letting it do that
    // would scroll the page to the top and then measure its own handiwork — which is how this
    // test failed twice before it was right.
    const tapDay = (n: number) =>
      page.evaluate((i: number) => {
        const strip = document.querySelectorAll<HTMLButtonElement>(
          '[role="tablist"][aria-label="Day"] button',
        );
        strip[i]?.click();
        return strip.length;
      }, n);

    const count = await page.locator('[role="tablist"][aria-label="Day"] button').count();
    expect(count, 'Today shows a week of days').toBeGreaterThan(3);

    // The two stocked days, counting back from today at the right-hand end of the strip.
    await tapDay(count - 3);
    await settledScroll(page);
    await page.evaluate(() => {
      const m = document.querySelector('main');
      if (m) m.scrollTop = Math.round((m.scrollHeight - m.clientHeight) / 2);
    });
    const before = await settledScroll(page);
    expect(before, 'a stocked day is longer than the viewport').toBeGreaterThan(40);

    await tapDay(count - 4);
    await expect(page).toHaveURL(/\?d=/);
    const after = await settledScroll(page);

    // Kept, as far as the new day's content allows: a shorter day legitimately clamps.
    const room = await page.evaluate(() => {
      const m = document.querySelector('main');
      return m ? m.scrollHeight - m.clientHeight : 0;
    });
    expect(after).toBeGreaterThanOrEqual(Math.min(before, room) - 8);
  });
});

// --- the checks --------------------------------------------------------------------------------

/** Everything worth looking at on a screen that has just arrived. */
async function inspect(page: Page): Promise<string[]> {
  // Every geometric check below reads a rectangle, so nothing may still be moving.
  await restIn(page);
  const found: string[] = [];
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  if (/Something went wrong|Unexpected error/i.test(body)) found.push('error boundary');

  const m = await page.evaluate(() => {
    const main = document.querySelector('main');
    const seen = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    // A control the app has taken out of the tab order is saying it is not reachable yet, and
    // it is right: SwipeRow's Delete sits behind the row with `tabIndex={-1}` until you swipe.
    // Checking those for reach or for a stolen centre tests the app's own intent and fails it.
    const offered = (el: Element) => seen(el) && (el as HTMLElement).tabIndex >= 0;
    // Three shapes are a way out, and only three. The tab bar; a back button; or, on a screen
    // that deliberately has neither because it ends a flow, one unambiguous dismissal. The
    // session summary is the third kind: it is reached only by finishing a workout, nothing
    // sits behind it, and a back arrow there would point at a session that no longer exists.
    const wayOut = () => {
      if (document.querySelectorAll('nav a, nav button').length > 0) return true;
      if (document.querySelectorAll('button[aria-label="Back"]').length > 0) return true;
      return [...document.querySelectorAll('button')].some(
        (b) =>
          seen(b) &&
          !(b as HTMLButtonElement).disabled &&
          /^(done|close|cancel|not now|skip)$/i.test((b.textContent ?? '').trim()),
      );
    };
    // Resolved the way a screen reader resolves it, in order. An <input> has no text content,
    // so the first draft of this called every search box nameless.
    const nameOf = (el: Element): string => {
      const by = el.getAttribute('aria-labelledby');
      const parts = [
        el.getAttribute('aria-label'),
        by
          ? by
              .split(/\s+/)
              .map((ref) => document.getElementById(ref)?.textContent ?? '')
              .join(' ')
          : '',
        [...((el as HTMLInputElement).labels ?? [])].map((l) => l.textContent ?? '').join(' '),
        el.textContent,
        el.getAttribute('title'),
        el.getAttribute('placeholder'),
        el.getAttribute('alt'),
      ];
      for (const part of parts) {
        const t = (part ?? '').replace(/\s+/g, ' ').trim();
        if (t) return t;
      }
      return '';
    };
    // Pinned furniture — the tab bar, its floating button, a sticky header — covers whatever
    // happens to be scrolled beneath it. That is a scroll position, not a defect: a weigh-in row
    // on /trend landed under the floating Log food button on arrival, depending on how tall the
    // chart above it had rendered and on which day was today, and the sweep failed a run for it.
    // So when what answers is pinned, the control is centred and asked again; only a control
    // that cannot be scrolled clear of the furniture at all is a finding.
    const pinned = (n: Element | null): boolean => {
      for (let x = n; x; x = x.parentElement) {
        const p = getComputedStyle(x).position;
        if (p === 'fixed' || p === 'sticky') return true;
      }
      return false;
    };
    const home = main?.scrollTop ?? 0;
    const homeY = window.scrollY;
    const clear = (el: Element, ok: () => true | Element | null): boolean => {
      const first = ok();
      if (first === true) return true;
      if (!pinned(first)) return false;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      return ok() === true;
    };

    const unnamed: string[] = [];
    for (const el of document.querySelectorAll(
      'button, a[href], input, select, [role="button"], [role="tab"]',
    )) {
      if (!seen(el)) continue;
      if ((el as HTMLInputElement).type === 'hidden') continue;
      if (!nameOf(el)) {
        unnamed.push(`${el.tagName.toLowerCase()}[${el.className.toString().slice(0, 40)}]`);
      }
    }
    // MASTER.md promises targets of at least 44 pt. That is about the tap, not the pill, so
    // it is checked by hit-testing rather than by measuring: a 36 pt chip with a `.hit` box is
    // fine, and the same chip inside a scroll container is not, because the container clips
    // the pseudo-element the box is made of. Both of those happened.
    const outOfReach: string[] = [];
    for (const el of document.querySelectorAll(
      'button, a[href], input, select, [role="button"], [role="tab"]',
    )) {
      if (!offered(el) || (el as HTMLButtonElement).disabled) continue;
      const first = el.getBoundingClientRect();
      if (Math.min(first.width, first.height) >= 44) continue;
      // The first point that something else answers, or true when every one reaches the control.
      const reach = (): true | Element | null => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const points = (
          [
            [cx, cy - 21],
            [cx, cy + 21],
            [cx - 21, cy],
            [cx + 21, cy],
          ] as const
        ).filter(([x, y]) => x > 0 && y > 0 && x < innerWidth && y < innerHeight);
        for (const [x, y] of points) {
          const at = document.elementFromPoint(x, y);
          if (!(at != null && (at === el || el.contains(at) || at.contains(el)))) return at;
        }
        return true;
      };
      if (!clear(el, reach)) {
        const r = el.getBoundingClientRect();
        outOfReach.push(
          `${nameOf(el) || el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
      }
    }

    // ...and a target that reaches further must not reach into its neighbour. A control owns
    // its own centre: if something else answers there, that something is taking the tap.
    const stolen: string[] = [];
    for (const el of document.querySelectorAll(
      'button, a[href], input, select, [role="button"], [role="tab"]',
    )) {
      if (!offered(el) || (el as HTMLButtonElement).disabled) continue;
      const centre = (): true | Element | null => {
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return at && at !== el && !el.contains(at) && !at.contains(el) ? at : true;
      };
      if (!clear(el, centre)) {
        const at = centre();
        if (at === true || at == null) continue;
        stolen.push(
          `${nameOf(el) || el.tagName.toLowerCase()} -> ${nameOf(at) || at.tagName.toLowerCase()}`,
        );
      }
    }

    // Put the page back where it arrived; centring controls above is the sweep's doing.
    main?.scrollTo({ top: home, behavior: 'instant' });
    window.scrollTo({ top: homeY, behavior: 'instant' });

    // Anything that floats at the bottom must stack on the tab bar, not sit on it. The
    // first-run seed banner was drawn exactly over the running-workout bar, and 88 px above
    // the bottom edge on the half of the app that hides the tab bar; all three surfaces now
    // derive their offset from one number in App.tsx.
    const nav = document.querySelector('nav');
    const onTheNav: string[] = [];
    if (nav) {
      const n = nav.getBoundingClientRect();
      for (const el of document.querySelectorAll('body *')) {
        if (nav.contains(el) || el.contains(nav)) continue;
        if (getComputedStyle(el).position !== 'fixed') continue;
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.height > 200) continue; // a sheet or an overlay, not a bar
        if (r.bottom > n.top + 1 && r.top < n.bottom - 1) {
          onTheNav.push(`${el.tagName.toLowerCase()}[${el.className.toString().slice(0, 32)}]`);
        }
      }
    }

    return {
      overflow: main ? main.scrollWidth - main.clientWidth : 0,
      out: wayOut(),
      unnamed,
      onTheNav,
      outOfReach,
      stolen,
    };
  });

  if (m.overflow > 1) found.push(`${m.overflow}px wider than the screen`);
  if (!m.out) found.push('dead end: no tab bar, no back, no way to dismiss');
  for (const u of new Set(m.unnamed)) found.push(`control with no name: ${u}`);
  for (const f of new Set(m.onTheNav)) found.push(`floats on top of the tab bar: ${f}`);
  for (const t of new Set(m.outOfReach)) found.push(`a 44 pt tap does not reach it: ${t}`);
  for (const t of new Set(m.stolen)) found.push(`something else answers at its centre: ${t}`);
  return found;
}

/** Presses everything safe, and checks where each press leaves you. */
async function pressEverything(page: Page, url: string, errors: string[]): Promise<string[]> {
  const found: string[] = [];

  for (const name of await pressableNames(page)) {
    await open(page, url);
    const target = byName(page, name);
    if (!(await target.count())) continue;

    await target.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(150);
    const was = new URL(page.url()).pathname;
    const before = errors.length;
    try {
      await target.click({ timeout: 2500 });
    } catch {
      continue; // covered by something, or gone — not a press that failed
    }
    await page.waitForTimeout(700);

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    if (/Something went wrong|Unexpected error/i.test(body)) {
      found.push(`"${name}" - error boundary`);
    }
    if (errors.length > before) found.push(`"${name}" - ${errors.at(-1)}`);

    if (await page.locator('[role="dialog"]').count()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      if (await page.locator('[role="dialog"]').count()) {
        found.push(`"${name}" - the sheet will not close on Escape`);
      }
      continue;
    }

    const now = new URL(page.url()).pathname;
    // A press that navigated has landed somewhere lazily loaded; judge it once it is there.
    if (now !== was) await settled(page);
    if (now !== was && (await scrollTop(page)) !== 0) {
      found.push(`"${name}" - ${now} opened part-way down the page`);
    }
    if (!(await hasWayOut(page))) found.push(`"${name}" - dead end: no way back`);
  }
  return found;
}

/** The same three shapes as `wayOut` above, for use after a press. */
function hasWayOut(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    if (document.querySelectorAll('nav a, nav button').length > 0) return true;
    if (document.querySelectorAll('button[aria-label="Back"]').length > 0) return true;
    return [...document.querySelectorAll('button')].some((b) => {
      const r = b.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.height > 0 &&
        !(b as HTMLButtonElement).disabled &&
        /^(done|close|cancel|not now|skip)$/i.test((b.textContent ?? '').trim())
      );
    });
  });
}

async function pressableNames(page: Page): Promise<string[]> {
  const all = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('button')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || (el as HTMLButtonElement).disabled) continue;
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (name) out.push(name);
    }
    return out;
  });
  return [...new Set(all)].filter((n) => !DO_NOT_PRESS.test(n)).slice(0, MAX_CONTROLS_PER_SCREEN);
}

function byName(page: Page, name: string): Locator {
  const exact = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  return page
    .locator('button:visible')
    .filter({ hasText: exact })
    .or(page.locator(`button[aria-label="${name.replace(/"/g, '\\"')}"]:visible`))
    .first();
}

// --- getting there -----------------------------------------------------------------------------

const scrollTop = (page: Page): Promise<number> =>
  page.evaluate(() => document.querySelector('main')?.scrollTop ?? 0);

/**
 * The offset once it has stopped moving.
 *
 * A fixed delay here is a guess about how long a smooth scroll, a render and a restore take
 * together, and under a parallel run the guess is wrong — which is the whole of this suite's
 * flakiness. Poll the number that actually matters and return when it has held still, so the
 * check waits exactly as long as the machine needs and no longer.
 */
async function settledScroll(page: Page, holds = 3): Promise<number> {
  let last = await scrollTop(page);
  let stable = 0;
  for (let i = 0; i < 80 && stable < holds; i++) {
    await page.waitForTimeout(50);
    const now = await scrollTop(page);
    if (now === last) stable++;
    else {
      stable = 0;
      last = now;
    }
  }
  return last;
}

/**
 * Wait for a screen to actually be on the page.
 *
 * Every route is lazily loaded and most read from IndexedDB, so judging one on a stopwatch
 * judges whatever happened to have rendered. That mistake was made twice: on arrival, where it
 * called Plan a dead end while Plan's own back button was still on its way, and after a press,
 * where three more screens were called dead ends for the same reason.
 *
 * waitForSelector rather than waitForFunction: this runs once per control, and polling by
 * evaluating JavaScript against a page that is still seeding its food database costs enough to
 * push the busiest screens past their own timeout.
 */
async function settled(page: Page): Promise<void> {
  // Wait for a *way out* specifically, not for any control at all. Plan was called a dead end
  // a third time because its content buttons render before its header does, so "some button
  // exists" was true while the back button was still on its way. These are the three things
  // `wayOut` looks for, so waiting for them is waiting for the question to be answerable.
  // A screen that truly has none still fails after the timeout, which is the point.
  await page
    .waitForSelector('nav a, button[aria-label="Back"], main h1', { timeout: 10_000 })
    .catch(() => {});
  await restIn(page);
}

/**
 * Wait for the arrival animations to finish.
 *
 * Lists arrive with a staggered `.rise-in` — up to 320 ms of delay before a row even starts
 * moving. Until it lands, a row's rectangle is wherever the transform has got to, so measuring
 * then asks where things were rather than where they are, and the checks that compare one
 * control against another read a layout that never existed. A flat sleep was standing in for
 * this and was long enough on an idle machine and not on a loaded one, which is precisely the
 * shape of a flake.
 *
 * Indefinite animations — spinners, the pulsing skeletons — never finish and are skipped, or
 * this would wait for a loading state to stop loading by itself.
 */
async function restIn(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      const finite = document.getAnimations().filter((a) => {
        const t = a.effect?.getComputedTiming();
        return t != null && t.iterations !== Infinity;
      });
      await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
    })
    .catch(() => {});
  // One frame after the last one lands, so the final rectangles are the ones read.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await settled(page);
}

/** A device a few weeks into using the app: a profile, a trend, food logged, a workout done. */
async function seed(page: Page): Promise<void> {
  await page.evaluate(async (id: typeof ID) => {
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
    const meta = (rowId: string) => ({
      id: rowId,
      user_id: 'local',
      created_at: now,
      updated_at: now,
    });

    const tx = db.transaction(
      [
        'profiles',
        'weigh_ins',
        'foods',
        'log_entries',
        'recipes',
        'exercises',
        'routines',
        'workout_sessions',
      ],
      'readwrite',
    );
    const put = (store: string, row: object) => tx.objectStore(store).put(row);

    put('profiles', {
      ...meta('sweep-profile'),
      sex: 'female',
      birth_date: '1996-05-02',
      height_cm: 168,
      activity_level: 'light',
      mode: 'CUT',
      goal_rate_kg_per_week: 0.4,
    });
    for (let i = 30; i >= 0; i--) {
      put('weigh_ins', {
        ...meta(`sweep-w${i}`),
        date: day(i),
        weight_kg: 70 - (30 - i) * 0.05,
        source: 'manual',
        ...(i % 7 === 0 ? { waist_cm: 80 - Math.round((30 - i) * 0.05) } : {}),
      });
    }
    put('foods', {
      ...meta(id.food),
      source: 'custom',
      name: 'Sweep porridge',
      per_100g: { kcal: 160, protein: 6, carb: 24, fat: 3.5, fiber: 2.4 },
      micros: {},
      micro_coverage: 0,
      portions: [{ label: 'bowl', grams: 250 }],
      verified: false,
    });
    const entry = (rowId: string, date: string, slot: string, label: string) => ({
      ...meta(rowId),
      logged_at: now,
      date,
      meal_slot: slot,
      name: label,
      food_id: id.food,
      grams: 250,
      servings: 1,
      kcal: 400,
      protein_g: 15,
      carb_g: 60,
      fat_g: 8.75,
      fiber_g: 6,
      micros: {},
      entry_method: 'search',
      confidence: 'high',
    });
    put('log_entries', entry(id.entry, day(0), 'breakfast', 'Sweep porridge'));
    // Days -2 and -3 are stocked so Today is taller than the viewport on both of them. The
    // test that a day change keeps your place can only mean something on a page long enough
    // to have a place.
    const slots = ['breakfast', 'lunch', 'dinner', 'snack'];
    for (const back of [2, 3]) {
      for (let i = 0; i < 8; i++) {
        put(
          'log_entries',
          entry(`sweep-e${back}-${i}`, day(back), slots[i % 4] as string, `Sweep meal ${i + 1}`),
        );
      }
    }
    put('recipes', {
      ...meta(id.recipe),
      name: 'Sweep bowl',
      items: [{ food_id: id.food, name: 'Sweep porridge', grams: 250 }],
      portions: 2,
      food_id: id.food,
      steps: ['Weigh the oats.', 'Add water and cook.'],
      source: 'own',
    });
    put('exercises', {
      ...meta(id.exercise),
      source: 'custom',
      name: 'Sweep press',
      category: 'strength',
      primary_muscle: 'chest',
      secondary_muscles: ['triceps'],
      equipment: 'barbell',
      load_type: 'weight_reps',
      instructions: ['Lie down.', 'Press.'],
    });
    put('routines', {
      ...meta(id.routine),
      name: 'Sweep day',
      sort_order: 0,
      source: 'own',
      items: [
        {
          exercise_id: id.exercise,
          name: 'Sweep press',
          load_type: 'weight_reps',
          sets: 3,
          rep_low: 6,
          rep_high: 10,
          rest_sec: 120,
        },
      ],
    });
    put('workout_sessions', {
      ...meta(id.done),
      started_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      ended_at: new Date(Date.now() - 3 * 86_400_000 + 3_600_000).toISOString(),
      routine_id: id.routine,
      name: 'Sweep day',
      volume_kg: 1440,
      duration_sec: 3600,
      energy_kcal: 300,
      entries: [
        {
          exercise_id: id.exercise,
          name: 'Sweep press',
          load_type: 'weight_reps',
          sets: [1, 2, 3].map(() => ({
            kind: 'normal',
            weight_kg: 60,
            reps: 8,
            rir: 2,
            done: true,
          })),
        },
      ],
    });

    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, ID);
}

/** `/train/session` only exists while a workout is running, so plant one and point the app at it. */
async function startLiveSession(page: Page): Promise<void> {
  await page.evaluate(async (id: typeof ID) => {
    const req = indexedDB.open('kalib');
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const now = new Date().toISOString();
    const tx = db.transaction(['workout_sessions', 'settings'], 'readwrite');
    tx.objectStore('workout_sessions').put({
      id: id.live,
      user_id: 'local',
      created_at: now,
      updated_at: now,
      started_at: new Date(Date.now() - 600_000).toISOString(),
      routine_id: id.routine,
      name: 'Sweep day',
      entries: [
        {
          exercise_id: id.exercise,
          name: 'Sweep press',
          load_type: 'weight_reps',
          sets: [
            { kind: 'normal', weight_kg: 60, reps: 8, rir: 2, done: true, done_at: now },
            { kind: 'normal', done: false },
            { kind: 'normal', done: false },
          ],
        },
      ],
    });
    tx.objectStore('settings').put({ key: 'active_session_id', value: id.live });
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, ID);
}
