// Records the README demo: the planner deck swipe, a one-tap log with the odometer rolling, and
// swipe-to-delete with undo. Drives the dev server through the same persistent Chrome profile
// the screenshot harness uses (so there is data on screen), records a video, converts it to a
// GIF (frames from Playwright's bundled ffmpeg, assembled with Pillow).
//
//   npm run dev            (in another terminal)
//   npm run demo:gif       → docs/screenshots/demo.gif
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..');
const PROFILE = join(ROOT, '.cache', 'chrome-profile');
const VIDEO_DIR = join(ROOT, '.cache', 'demo-video');
const OUT = join(ROOT, 'docs', 'screenshots', 'demo.gif');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const W = 390;
const H = 844;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A finger-like drag: pointer down, eased travel, a beat, release. */
async function drag(page: Page, from: { x: number; y: number }, dx: number, ms = 600) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = 1 - Math.pow(1 - t, 3);
    await page.mouse.move(from.x + dx * eased, from.y + Math.sin(t * Math.PI) * 6);
    await sleep(ms / steps);
  }
  await sleep(250);
  await page.mouse.up();
}

async function center(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`not on screen: ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function record() {
  rmSync(VIDEO_DIR, { recursive: true, force: true });
  mkdirSync(VIDEO_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless: true,
    viewport: { width: W, height: H },
    colorScheme: 'dark',
    hasTouch: true,
    // The screencast is captured at CSS-pixel size; asking for more only letterboxes it.
    recordVideo: { dir: VIDEO_DIR, size: { width: W, height: H } },
    args: ['--hide-scrollbars'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const t0 = Date.now(); // the recording starts with the page

  // Start every take from an undecided week so the deck has cards (dev profile only).
  await page.goto(`${BASE}/`);
  await page.evaluate(async () => {
    const open = indexedDB.open('kalib');
    const db = await new Promise<IDBDatabase>((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    await new Promise<void>((res) => {
      const tx = db.transaction(['week_plans', 'log_entries'], 'readwrite');
      tx.objectStore('week_plans').clear();
      // Previous takes each logged a portion; take them back out so the ring reads normally.
      const today = new Date().toLocaleDateString('en-CA');
      const entries = tx.objectStore('log_entries');
      entries.openCursor().onsuccess = (ev) => {
        const cur = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!cur) return;
        const row = cur.value as { date: string; name: string; entry_method?: string };
        if (row.date === today && /^Chicken(, breast, boneless| & rice)/.test(row.name))
          cur.delete();
        cur.continue();
      };
      tx.oncomplete = () => res();
    });
    db.close();
  });

  // 1 — the deck: swipe a card right.
  await page.goto(`${BASE}/plan`);
  await page.waitForLoadState('networkidle');
  await sleep(1000);
  const leadInMs = Date.now() - t0 - 400; // frames before this are the reset, not the demo
  const card = await center(page, '[style*="rotate("]');
  await drag(page, card, 230, 650);
  await sleep(1300);

  // 2 — Today: one tap on a "Log again" tile, then the ring and the numbers roll.
  await page.goto(`${BASE}/`);
  await page.waitForLoadState('networkidle');
  await sleep(900);
  const tile = page.locator('.rail button', { hasText: 'Chicken & rice' }).first();
  await tile.click();
  await sleep(900);
  await page.getByRole('button', { name: /^Log · [\d,]+ kcal$/ }).click();
  await sleep(1800);

  // 3 — swipe an entry away, then take it back.
  const row = page.locator('[data-swipe-row]').last();
  await row.scrollIntoViewIfNeeded();
  await sleep(500);
  const box = await row.boundingBox();
  if (!box) throw new Error('no entry row');
  await drag(page, { x: box.x + box.width * 0.85, y: box.y + box.height / 2 }, -box.width, 500);
  await sleep(1000);
  await page.getByRole('button', { name: 'Undo' }).click();
  await sleep(1300);

  await ctx.close();
  const webm = readdirSync(VIDEO_DIR).find((f) => f.endsWith('.webm'));
  if (!webm) throw new Error('no video recorded');
  const src = join(VIDEO_DIR, 'demo.webm');
  renameSync(join(VIDEO_DIR, webm), src);
  return { src, leadInMs };
}

function ffmpegPath(): string {
  const base =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    join(process.env.LOCALAPPDATA ?? join(process.env.HOME ?? '', '.cache'), 'ms-playwright');
  const dir = readdirSync(base).find((d) => d.startsWith('ffmpeg-'));
  if (!dir) throw new Error(`ffmpeg not found under ${base}; run npx playwright install`);
  const bin = readdirSync(join(base, dir)).find((f) => f.startsWith('ffmpeg'));
  return join(base, dir, bin!);
}

async function main() {
  const { src: webm, leadInMs } = await record();
  // Playwright's ffmpeg has no GIF muxer: dump scaled PNG frames, assemble them with Pillow.
  const frames = join(VIDEO_DIR, 'frames');
  mkdirSync(frames, { recursive: true });
  const r = spawnSync(
    ffmpegPath(),
    // (This ffmpeg build has `scale` but not `fps`; `-r` sets the output rate instead.)
    ['-y', '-ss', (leadInMs / 1000).toFixed(2), '-i', webm, '-r', '14', join(frames, '%04d.png')],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  if (r.status !== 0) throw new Error('ffmpeg failed');
  const py = [
    'import glob, sys',
    'from PIL import Image',
    'from PIL import ImageStat',
    'files = sorted(glob.glob(sys.argv[1] + "/*.png"))',
    'rgb = [Image.open(f).convert("RGB") for f in files]',
    '# drop any blank frames left at the start',
    'while rgb and ImageStat.Stat(rgb[0].convert("L")).stddev[0] < 12: rgb.pop(0)',
    '# one palette for the whole clip and no dithering: flat dark UI, a fifth of the bytes',
    'rgb = [im.resize((340, round(im.height * 340 / im.width)), Image.LANCZOS) for im in rgb]',
    'sample = Image.new("RGB", (rgb[0].width, rgb[0].height * 6))',
    'for k, i in enumerate(range(0, len(rgb), max(1, len(rgb) // 6))[:6]): sample.paste(rgb[i], (0, k * rgb[0].height))',
    'pal = sample.quantize(colors=160, method=Image.Quantize.MEDIANCUT)',
    'ims = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im in rgb]',
    'durations = [int(1000 / 14)] * len(ims); durations[-1] = 1600',
    'ims[0].save(sys.argv[2], save_all=True, append_images=ims[1:], duration=durations, loop=0, optimize=True, disposal=1)',
    'print(len(ims), "frames")',
  ].join(String.fromCharCode(10));
  const g = spawnSync('python', ['-c', py, frames, OUT], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (g.status !== 0 || !existsSync(OUT)) throw new Error('gif assembly failed');
  console.log(`saved ${OUT}`);
}

void main();
