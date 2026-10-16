// ETL: ../Kalib-chains → public/data/foods-chains.json (SPEC §21).
// Run with `npm run seed:chains`.
//
// The source is deliberately not in this repository. Kalib is MIT and MIT cannot be withdrawn
// from a file once granted on, so the compilation lives in a private repository and only its
// build output is served — see LICENSE-DATA.md. Point this at a different checkout with
// $KALIB_CHAINS_SRC. If the source is absent the script says so and exits 0: a public clone
// must still build, it simply has no eating-out data.
//
// Why a transcription and not a download. No free, current, redistributable dataset covers
// these menus. MenuStat (NYC DOHMH, 96 US chains, no usage restrictions) stopped in 2018 and
// 83% of its rows carry no gram weight; Nutritionix is $499/month and forbids rebuilding its
// catalogue; Open Food Facts is a packaged-goods database and does not hold menus. So the rows
// are read from what each chain publishes, each one carrying the page it came from.
//
// Every row is checked before it is written:
//
//   - the 4/4/9 energy identity, against the chain's own published kcal
//   - a gram weight where the chain publishes one, and never invented where it does not
//   - a citation, or the row does not go in
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMarket, MARKETS, type Market } from '../src/core/market';
import type { SeedFile, SeedFood } from '../src/core/seedFormat';
import type { Per100g } from '../src/core/types';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'public', 'data');
const SRC = process.env['KALIB_CHAINS_SRC'] ?? join(ROOT, '..', 'Kalib-chains');

/** Bumped when the source shape changes, so a stale checkout fails loudly rather than oddly. */
const SCHEMA = 1;

interface Citation {
  publisher: string;
  url: string;
  /** YYYY-MM-DD the page was read. Menus change; a figure without a date cannot be aged. */
  retrieved: string;
}

interface SourceItem {
  name: string;
  category?: string;
  /** As published. Absent where the chain publishes none — common in the United States. */
  serving_g?: number;
  serving_label?: string;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  fiber_g?: number;
  sodium_mg?: number;
  sugar_g?: number;
  sat_fat_g?: number;
  /** Overrides the file's citation when one item came from a different page. */
  source?: Citation;
}

interface ChainFile {
  schema: number;
  chain: string;
  market: Market;
  source?: Citation;
  items?: SourceItem[];
  /** False when the chain publishes nothing. An absence is a finding, so it is recorded. */
  published?: boolean;
  checked?: string;
  note?: string;
}

/**
 * How far a row's macros may sit from its published energy before it is refused.
 *
 * Generous enough for rounding, for the fibre and polyol conventions that differ between
 * markets, and for a chain that rounds to the nearest 10. Tight enough to catch the error that
 * actually happens, which is a dropped or doubled digit while transcribing by hand.
 */
function energyDisagrees(item: SourceItem): string | null {
  const derived = 4 * item.protein_g + 4 * item.carb_g + 9 * item.fat_g;
  const slack = Math.max(25, item.kcal * 0.2);
  if (Math.abs(derived - item.kcal) <= slack) return null;
  return `macros give ${Math.round(derived)} kcal, the chain publishes ${item.kcal}`;
}

const round = (n: number, dp = 2) => Number(n.toFixed(dp));

/** Per 100 g, from a per-item figure and the weight of the item. */
function per100(item: SourceItem, grams: number): Per100g {
  const k = 100 / grams;
  return {
    kcal: round(item.kcal * k, 1),
    protein: round(item.protein_g * k),
    carb: round(item.carb_g * k),
    fat: round(item.fat_g * k),
    fiber: round((item.fiber_g ?? 0) * k),
    ...(item.sugar_g != null ? { sugar: round(item.sugar_g * k) } : {}),
    ...(item.sodium_mg != null ? { sodium: round(item.sodium_mg * k, 1) } : {}),
    ...(item.sat_fat_g != null ? { sat_fat: round(item.sat_fat_g * k) } : {}),
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function main(): void {
  if (!existsSync(SRC)) {
    console.log(`chains: no source at ${SRC} — skipping (see LICENSE-DATA.md)`);
    return;
  }

  const foods: SeedFood[] = [];
  const problems: string[] = [];
  const covered = new Map<Market, string[]>();
  const unpublished: string[] = [];
  let skippedNoWeight = 0;

  for (const market of MARKETS) {
    const dir = join(SRC, 'chains', market.toLowerCase());
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const path = join(dir, file);
      const data = JSON.parse(readFileSync(path, 'utf8')) as ChainFile;
      const where = `${market.toLowerCase()}/${file}`;

      if (data.schema !== SCHEMA) {
        problems.push(`${where}: schema ${data.schema}, this script reads ${SCHEMA}`);
        continue;
      }
      if (!isMarket(data.market) || data.market !== market) {
        problems.push(`${where}: market "${data.market}" does not match the folder`);
        continue;
      }
      if (data.published === false) {
        unpublished.push(`${data.chain} (${market})`);
        continue;
      }

      for (const item of data.items ?? []) {
        const cite = item.source ?? data.source;
        if (!cite?.url || !cite.publisher || !cite.retrieved) {
          problems.push(`${where}: "${item.name}" has no citation`);
          continue;
        }
        const bad = energyDisagrees(item);
        if (bad) {
          problems.push(`${where}: "${item.name}" ${bad}`);
          continue;
        }
        // A whole-item row with no published weight cannot become a per-100 g row, and a
        // weight must never be invented (SPEC §2.4). Those wait for the each-portion work.
        if (!item.serving_g || item.serving_g <= 0) {
          skippedNoWeight++;
          continue;
        }

        foods.push({
          id: `chain:${market.toLowerCase()}:${slug(data.chain)}:${slug(item.name)}`,
          external_id: slug(`${data.chain} ${item.name}`),
          name: `${item.name} (${data.chain})`,
          chain: data.chain,
          market,
          ...(item.category ? { category: item.category } : {}),
          per_100g: per100(item, item.serving_g),
          micros: {},
          micro_coverage: 0,
          portions: [{ label: item.serving_label ?? 'item', grams: item.serving_g }],
          source_ref: `${cite.publisher}, read ${cite.retrieved} — ${cite.url}`,
        });
        covered.set(market, [...(covered.get(market) ?? []), data.chain]);
      }
    }
  }

  if (problems.length) {
    console.error(`chains: ${problems.length} rows refused\n  ${problems.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }

  foods.sort((a, b) => (a.id < b.id ? -1 : 1));
  const seed: SeedFile = {
    format: 1,
    source: 'chain',
    generated_at: new Date().toISOString(),
    count: foods.length,
    foods,
  };
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, 'foods-chains.json');
  writeFileSync(path, JSON.stringify(seed));

  for (const market of MARKETS) {
    const chains = new Set(covered.get(market) ?? []);
    const n = foods.filter((f) => f.market === market).length;
    console.log(`  ${market}: ${n} items across ${chains.size} chains`);
  }
  if (unpublished.length) console.log(`  publishes nothing: ${unpublished.join(', ')}`);
  if (skippedNoWeight) console.log(`  ${skippedNoWeight} items held back: no published weight`);
  console.log(`wrote ${path} (${foods.length} items)`);
}

main();
