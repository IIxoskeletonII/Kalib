# Kalib

A personal, local-first nutrition tracker that **measures** your maintenance calories from your
own weigh-ins and logs instead of guessing them from a formula — and coaches you toward the
targets you keep missing. Progressive web app, works offline, costs nothing to run.

<p align="center">
  <img src="docs/screenshots/today-dark.png" width="200" alt="Today, dark" />
  <img src="docs/screenshots/today-light.png" width="200" alt="Today, light" />
  <img src="docs/screenshots/log-sheet.png" width="200" alt="Logging a food" />
  <img src="docs/screenshots/coach.png" width="200" alt="Coach" />
  <img src="docs/screenshots/water-supplements.png" width="200" alt="Water and supplements" />
</p>

## What it does

- **Logging in seconds** — offline USDA database (7 k foods), packaged products from Open Food
  Facts by search or **barcode photo** (decoded on-device), your own foods, a custom number pad
  (no OS keyboard), one-tap "log again" tiles, quick manual entry.
- **Targets that calibrate to you** — formula targets while calibrating, then from day 24 a
  measured TDEE from the weight trend and logged intake over a 28-day window, with a 95 %
  interval, guard rails (±150 kcal per weekly step, a hold-and-explain card when the measurement
  is >600 kcal from the formula) and a synthetic 90-day ground-truth test behind it (SPEC §4).
  Fiber is a first-class target next to protein.
- **Weekly banking** — a big day is spread across the week within bounds (never more than
  300 kcal off a day, never below the safety floor, one rollover then forgiven); an under-day
  rolls forward. The ring runs on the banked target.
- **Weight trend, not scale noise** — exponentially smoothed trend, raw readings hidden by default.
- **Coach** — after a few full days it finds what is running short (protein, fiber, then
  micronutrients when the data is good enough) and names everyday foods that close the gap.
- **Recipes and batches** — weigh ingredients as you cook, weigh the pot, say how many portions;
  every recipe becomes one of your foods, and a cooked batch logs a portion in one tap from
  Today with the count of portions left.
- **Water and supplements** — one tap adds a glass toward the 35 ml/kg target; a daily checklist
  for creatine, vitamins and minerals with a suggested dose worked out from sex, age and weight
  (NIH ODS / EFSA / ISSN references, shown with their basis). Micronutrient supplements count
  toward the coach's gap detection.
- **Your data stays yours** — everything lives in IndexedDB on the device; CSV and JSON export.

Product spec: [`SPEC.md`](SPEC.md) · design system: [`design-system/kalib/MASTER.md`](design-system/kalib/MASTER.md) ·
code conventions: [`CLAUDE.md`](CLAUDE.md).

## Stack

React 19 · Vite · TypeScript (strict) · Tailwind v4 · Dexie (IndexedDB) · uPlot · vite-plugin-pwa ·
Cloudflare Workers (static assets + a small API proxy for Open Food Facts) · Supabase (auth + a
row-per-row mirror for sync; optional).

```
src/core/       pure formulas + types, fully unit-tested      src/db/         Dexie schema, repos, seed
src/services/   orchestration (targets, logging, coach, off)  src/platform/   camera / export adapters
src/hooks/      live queries                                  src/screens/, src/components/   UI
worker/         Cloudflare Worker (assets + /api/off/*)        scripts/        USDA ETL, icons, screenshots
```

## Run

```sh
npm install
npm run dev          # http://localhost:5173 (add --host to test on a phone over LAN)
npm test             # 115 unit tests: every formula in SPEC §3/§4/§16, repos, worker ranking
npm run build        # typecheck + production build → dist/
```

## Food database

`public/data/foods-*.json` is generated from USDA FoodData Central (Foundation Foods + a filtered
slice of SR Legacy) and committed. Regenerate after changing `scripts/seed-usda.ts` or
`src/core/nutrients.ts`, then bump `SEED_VERSION` in `src/db/seed.ts` so installed clients reload:

```sh
npm run seed:usda
```

Packaged foods come from Open Food Facts through `/api/off/search`, which re-ranks OFF's results
for label completeness and popularity (see `worker/off.ts`). Picked products are cached locally.

## Cloud sync (optional)

Sign-in is email + password (Supabase Auth, no SMTP needed); sync is last-write-wins by
`updated_at` with soft deletes, over the same rows the device keeps. Each account only ever sees
its own rows (RLS), and a phone binds to the first account it syncs with. Without the two
environment variables the build runs local-only and Settings says so.

1. Create a free Supabase project, open the SQL editor and run every file in
   `supabase/migrations/` in order (`0001_init.sql`, `0002_water_supplements.sql`, `0003_recipes.sql`).
2. Authentication → Providers → Email: turn **Confirm email** off (accounts sign in immediately).
3. Authentication → URL configuration: Site URL = the app's URL; add it to Redirect URLs (password reset).
4. Copy `.env.example` to `.env.local` with the project URL and publishable key, then `npm run deploy`.

## Deploy

One-time: `npx wrangler login`. Then `npm run deploy` builds and uploads `dist/` plus the Worker.
On the iPhone: open the URL in Safari → Share → **Add to Home Screen**. Installed, it runs
standalone and offline; the food database downloads once on first launch (~4 MB, cached).

## Verifying without a phone

`scripts/shot.ts` drives headless Chrome over CDP, waits for the app to mount, evaluates JS and
screenshots at phone size in either colour scheme:

```sh
npm run shot -- http://localhost:5173/ out.png --wait 1500 --scheme light
npm run shot -- http://localhost:5173/log out.png --eval-file .cache/search.js
```

## Design skills

The UI was built against Anthropic's `frontend-design`, `impeccable` and Vercel's
`web-design-guidelines` skills (not committed). To reinstall for a Claude Code session:

```sh
npx skills add anthropics/skills --skill frontend-design
npx skills add pbakaus/impeccable
npx skills add vercel-labs/agent-skills --skill web-design-guidelines
```

## Data sources

U.S. Department of Agriculture, Agricultural Research Service — FoodData Central (Foundation
Foods, SR Legacy). Open Food Facts — Open Database License (ODbL).

Not medical advice. Targets are general-population formulas.
