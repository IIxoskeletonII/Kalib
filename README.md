# Kalib

Adaptive macro tracker — local-first PWA. Product spec in [`SPEC.md`](SPEC.md); code conventions in
[`CLAUDE.md`](CLAUDE.md).

## Run

```sh
npm install
npm run dev          # http://localhost:5173 (add --host to test on a phone over LAN)
npm test             # unit tests for every formula in SPEC §3/§4 + repo tests
npm run build        # typecheck + production build → dist/
npm run preview      # serve dist/ with the service worker
```

## Food database

`public/data/foods-*.json` is generated from USDA FoodData Central (Foundation Foods + a filtered
slice of SR Legacy) and committed. Regenerate after changing `scripts/seed-usda.ts` or
`src/core/nutrients.ts`, then bump `SEED_VERSION` in `src/db/seed.ts` so installed clients reload:

```sh
npm run seed:usda
```

## Deploy (Cloudflare Pages, free tier)

One-time: `npx wrangler login`. After that:

```sh
npm run deploy       # build + wrangler deploy (uploads dist/ as static assets)
```

The app is served at `https://kalib.kalib.workers.dev` (unlisted, `noindex`) as static assets on a Worker — Cloudflare folded Pages into Workers; `wrangler.jsonc` holds the config. On the iPhone: open it in
Safari → Share → **Add to Home Screen**. Installed, it runs standalone and offline; the food
database downloads once on first launch (~4 MB, cached by the service worker).

## Verifying on a phone-sized viewport without a phone

`scripts/shot.ts` drives headless Chrome over CDP, evaluates JS on the page and screenshots:

```sh
npm run shot -- http://localhost:5173/ .cache/shots/today.png --wait 1500
npm run shot -- http://localhost:5173/log out.png --eval-file .cache/search.js
```

## Layout

```
src/core/       pure formulas + types (tested)        src/db/         Dexie schema, repos, seed
src/services/   orchestration (targets, logging, export)
src/platform/   camera / export adapters (swap under Capacitor)
src/hooks/      live queries                          src/screens/, src/components/   UI
scripts/        USDA ETL, icon generator, screenshot harness
```
