// ETL: USDA FoodData Central → public/data/foods-*.json (SPEC §7.1).
// Run with `npm run seed:usda`. Downloads are cached in .cache/ (git-ignored).
//
//   Foundation Foods  — lab-analysed whole foods with full vitamin/mineral panels.
//   SR Legacy         — broader coverage incl. cooked variants; noisy categories dropped.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { MACRO_DEFS, MICRO_DEFS, MICRO_KEYS, microCoverageOf } from '../src/core/nutrients';
import type { SeedFile, SeedFood } from '../src/core/seedFormat';
import type { FoodSource, MicroKey, Micros, Per100g, Portion } from '../src/core/types';

const ROOT = join(import.meta.dirname, '..');
const CACHE = join(ROOT, '.cache');
const OUT = join(ROOT, 'public', 'data');

interface Dataset {
  source: FoodSource;
  url: string;
  zip: string;
  jsonKey: string;
  out: string;
  /** SR Legacy categories that are branded, regional or otherwise noise for this app. */
  dropCategories: string[];
}

const DATASETS: Dataset[] = [
  {
    source: 'usda_foundation',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip',
    zip: 'foundation.zip',
    jsonKey: 'FoundationFoods',
    out: 'foods-foundation.json',
    dropCategories: [],
  },
  {
    source: 'usda_sr',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip',
    zip: 'sr_legacy.zip',
    jsonKey: 'SRLegacyFoods',
    out: 'foods-sr.json',
    dropCategories: [
      'Fast Foods',
      'Restaurant Foods',
      'Baby Foods',
      'American Indian/Alaska Native Foods',
      'Meals, Entrees, and Side Dishes',
    ],
  },
];

// --- FDC JSON shapes (only the fields we read) ---------------------------------------
interface FdcNutrient {
  nutrient: { id: number; unitName: string };
  amount?: number;
}
interface FdcPortion {
  amount?: number;
  gramWeight?: number;
  modifier?: string;
  sequenceNumber?: number;
  measureUnit?: { name?: string; abbreviation?: string };
}
interface FdcFood {
  fdcId: number;
  description: string;
  foodCategory?: { description?: string };
  foodNutrients: FdcNutrient[];
  foodPortions?: FdcPortion[];
}

async function fetchZip(ds: Dataset): Promise<Buffer> {
  const path = join(CACHE, ds.zip);
  if (existsSync(path)) return readFileSync(path);
  console.log(`downloading ${ds.url}`);
  const res = await fetch(ds.url);
  if (!res.ok) throw new Error(`${ds.url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path, buf);
  return buf;
}

function readFoods(ds: Dataset, zip: Buffer): FdcFood[] {
  const files = unzipSync(new Uint8Array(zip));
  const name = Object.keys(files).find((f) => f.endsWith('.json'));
  if (!name) throw new Error(`${ds.zip}: no .json inside`);
  const text = Buffer.from(files[name]!).toString('utf8');
  const parsed = JSON.parse(text) as Record<string, (FdcFood | null)[]>;
  const arr = parsed[ds.jsonKey];
  if (!arr) throw new Error(`${ds.zip}: key ${ds.jsonKey} missing`);
  return arr.filter((f): f is FdcFood => f != null);
}

function amountFor(byId: Map<number, number>, ids: number[]): number | undefined {
  for (const id of ids) {
    const v = byId.get(id);
    if (v != null) return v;
  }
  return undefined;
}

function toPer100g(byId: Map<number, number>): Per100g | undefined {
  const protein = amountFor(byId, MACRO_DEFS.protein.fdc);
  const carb = amountFor(byId, MACRO_DEFS.carb.fdc);
  const fat = amountFor(byId, MACRO_DEFS.fat.fdc);
  if (protein == null && carb == null && fat == null) return undefined;
  const p = protein ?? 0;
  const c = carb ?? 0;
  const f = fat ?? 0;
  // 42 Foundation foods carry no energy value at all; Atwater general factors fill the gap.
  const kcal = amountFor(byId, MACRO_DEFS.kcal.fdc) ?? 4 * p + 4 * c + 9 * f;
  const out: Per100g = {
    kcal,
    protein: p,
    carb: c,
    fat: f,
    fiber: amountFor(byId, MACRO_DEFS.fiber.fdc) ?? 0,
  };
  const sugar = amountFor(byId, MACRO_DEFS.sugar.fdc);
  const sodium = amountFor(byId, MACRO_DEFS.sodium.fdc);
  const sat = amountFor(byId, MACRO_DEFS.sat_fat.fdc);
  if (sugar != null) out.sugar = sugar;
  if (sodium != null) out.sodium = sodium;
  if (sat != null) out.sat_fat = sat;
  return out;
}

function toMicros(byId: Map<number, number>): Micros {
  const m: Micros = {};
  for (const k of MICRO_KEYS) {
    const v = amountFor(byId, MICRO_DEFS[k as MicroKey].fdc);
    if (v != null) m[k] = round(v, 3);
  }
  return m;
}

function toPortions(ps: FdcPortion[] | undefined): Portion[] {
  if (!ps) return [];
  const out: Portion[] = [];
  const seen = new Set<string>();
  const sorted = [...ps].sort((a, b) => (a.sequenceNumber ?? 99) - (b.sequenceNumber ?? 99));
  for (const p of sorted) {
    const g = p.gramWeight;
    if (!g || g <= 0) continue;
    const unit = p.measureUnit?.abbreviation || p.measureUnit?.name || '';
    if (unit === 'RACC') continue;
    const amount = p.amount ?? 1;
    const modifier = (p.modifier ?? '').trim();
    let label: string;
    if (!unit || unit === 'undetermined') {
      if (!modifier) continue;
      label = /^\d/.test(modifier) ? modifier : `${amount} ${modifier}`;
    } else {
      label = `${amount} ${unit}${modifier ? `, ${modifier}` : ''}`;
    }
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, grams: round(g, 1) });
    if (out.length === 4) break;
  }
  return out;
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

function transform(
  ds: Dataset,
  foods: FdcFood[],
): { seed: SeedFile; dropped: Record<string, number> } {
  const dropped: Record<string, number> = {};
  const out: SeedFood[] = [];
  for (const f of foods) {
    const cat = f.foodCategory?.description ?? '';
    if (ds.dropCategories.includes(cat)) {
      dropped[cat] = (dropped[cat] ?? 0) + 1;
      continue;
    }
    const byId = new Map<number, number>();
    for (const n of f.foodNutrients) if (n.amount != null) byId.set(n.nutrient.id, n.amount);
    const per_100g = toPer100g(byId);
    if (!per_100g) {
      dropped['(no macros)'] = (dropped['(no macros)'] ?? 0) + 1;
      continue;
    }
    for (const k of Object.keys(per_100g) as (keyof Per100g)[]) {
      per_100g[k] = round(per_100g[k] as number, 2);
    }
    const micros = toMicros(byId);
    out.push({
      id: `${ds.source}:${f.fdcId}`,
      external_id: String(f.fdcId),
      name: f.description.trim(),
      per_100g,
      micros,
      micro_coverage: round(microCoverageOf(micros), 3),
      portions: toPortions(f.foodPortions),
    });
  }
  out.sort((a, b) => (a.name < b.name ? -1 : 1));
  return {
    seed: {
      format: 1,
      source: ds.source,
      generated_at: new Date().toISOString(),
      count: out.length,
      foods: out,
    },
    dropped,
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  for (const ds of DATASETS) {
    const zip = await fetchZip(ds);
    const foods = readFoods(ds, zip);
    const { seed, dropped } = transform(ds, foods);
    const path = join(OUT, ds.out);
    writeFileSync(path, JSON.stringify(seed));
    const kb = Math.round(Buffer.byteLength(JSON.stringify(seed)) / 1024);
    const withMicros = seed.foods.filter((f) => f.micro_coverage > 0).length;
    console.log(
      `${ds.source}: ${foods.length} in → ${seed.count} out (${withMicros} with micros), ${kb} KB → ${path}`,
    );
    if (Object.keys(dropped).length) console.log('  dropped:', dropped);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
