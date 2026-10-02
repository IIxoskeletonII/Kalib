// ETL: ANSES Ciqual → public/data/foods-ciqual.json (SPEC §7.1a).
// Run with `npm run seed:ciqual`. Downloads are cached in .cache/ (git-ignored).
//
// Ciqual is the French national food composition table: 3,484 foods against 74 constituents,
// published by ANSES under the Etalab Open Licence 2.0, which permits redistribution with
// attribution. It is here because the measured gap in this app was European food — a search
// probe found 32% of everyday Italian terms and the authoritative Italian tables (CREA, and
// IEO's BDA) both forbid redistribution. Ciqual carries pancetta, bresaola, grana padano,
// pecorino, gorgonzola, mascarpone, mozzarella, polenta, pesto, burrata, provolone and speck,
// and it covers every micronutrient this app tracks, plus iodine.
//
// Each food ships with both an English and a French name. The English one is displayed, since
// the interface is English; the French one becomes a search alias, so either finds the food.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MICRO_KEYS, microCoverageOf } from '../src/core/nutrients';
import type { SeedFile, SeedFood } from '../src/core/seedFormat';
import type { MicroKey, Micros, Per100g } from '../src/core/types';

const ROOT = join(import.meta.dirname, '..');
const CACHE = join(ROOT, '.cache');
const OUT = join(ROOT, 'public', 'data');

/** The dataset is versioned behind a stable DOI, so a new edition resolves without a code change. */
const DOI = 'doi:10.57745/RDMHWY';
const DATAVERSE = 'https://entrepot.recherche.data.gouv.fr';

/** Ciqual constituent codes for the macros this app stores. */
const MACRO_CODES: Record<keyof Per100g, number[]> = {
  // Energy as the EU 1169/2011 declaration, falling back to the Jones-factor figure.
  kcal: [328, 333],
  protein: [25000, 25003],
  carb: [31000],
  fat: [40000],
  fiber: [34100],
  sugar: [32000],
  sodium: [10110],
  sat_fat: [40302],
};

/** Ciqual constituent codes for the §7 micronutrient panel. Units already match MICRO_DEFS. */
const MICRO_CODES: Partial<Record<MicroKey, number[]>> = {
  vit_a: [51104],
  vit_c: [55100],
  vit_d: [52100],
  vit_e: [53100],
  vit_k: [54101],
  b1: [56100],
  b2: [56200],
  b3: [56310],
  b5: [56400],
  b6: [56500],
  // Dietary folate equivalents where given, else total folates.
  folate: [56702, 56700],
  b12: [56600],
  calcium: [10200],
  iron: [10260],
  magnesium: [10120],
  phosphorus: [10150],
  potassium: [10190],
  zinc: [10300],
  copper: [10290],
  manganese: [10251],
  selenium: [10340],
  // choline is not measured by Ciqual, so those foods simply report lower coverage (§7.4).
};

interface DataverseFile {
  dataFile: { id: number; filename: string };
}

async function fileIds(): Promise<Record<string, number>> {
  const res = await fetch(
    `${DATAVERSE}/api/datasets/:persistentId/?persistentId=${encodeURIComponent(DOI)}`,
  );
  if (!res.ok) throw new Error(`Ciqual dataset lookup: ${res.status}`);
  const body = (await res.json()) as { data: { latestVersion: { files: DataverseFile[] } } };
  const ids: Record<string, number> = {};
  for (const f of body.data.latestVersion.files) {
    const n = f.dataFile.filename;
    if (n.startsWith('alim_') && n.endsWith('.xml')) ids.alim = f.dataFile.id;
    if (n.startsWith('compo_') && n.endsWith('.xml')) ids.compo = f.dataFile.id;
  }
  if (!ids.alim || !ids.compo) throw new Error('Ciqual: alim/compo XML not found in the dataset');
  return ids;
}

async function fetchXml(name: string, id: number): Promise<string> {
  const path = join(CACHE, `ciqual-${name}.xml`);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  console.log(`downloading ciqual ${name}`);
  const res = await fetch(`${DATAVERSE}/api/access/datafile/${id}?format=original`);
  if (!res.ok) throw new Error(`ciqual ${name}: ${res.status}`);
  const text = await res.text();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path, text);
  return text;
}

const ENTITIES: Record<string, string> = {
  '&apos;': "'",
  '&quot;': '"',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&#39;': "'",
};

function decode(s: string): string {
  return s.replace(/&(apos|quot|amp|lt|gt|#39);/g, (m) => ENTITIES[m] ?? m).trim();
}

function tag(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(block);
  return m ? decode(m[1]!) : undefined;
}

/**
 * A Ciqual value. The table writes "-" for not measured, "traces" for a trace, and "< 0,5" for
 * below the limit of quantification; decimals use a comma.
 *
 * A trace or a below-limit reading is a real measurement of "almost none", so for the macros it
 * is zero. For a micronutrient it is *not* a number worth reporting: §16.1 refuses to diagnose a
 * gap from weak data, and §7.4 counts coverage, so leaving it out keeps both of those honest.
 */
function parseValue(raw: string | undefined, kind: 'macro' | 'micro'): number | undefined {
  if (raw == null) return undefined;
  const v = raw.trim();
  if (v === '' || v === '-') return undefined;
  if (/^traces$/i.test(v) || v.startsWith('<')) return kind === 'macro' ? 0 : undefined;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function pick(
  values: Map<number, string>,
  codes: number[] | undefined,
  kind: 'macro' | 'micro',
): number | undefined {
  for (const code of codes ?? []) {
    const v = parseValue(values.get(code), kind);
    if (v != null) return v;
  }
  return undefined;
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

async function main(): Promise<void> {
  const ids = await fileIds();
  const [alimXml, compoXml] = await Promise.all([
    fetchXml('alim', ids.alim!),
    fetchXml('compo', ids.compo!),
  ]);

  // Composition: one row per food × constituent.
  const byFood = new Map<string, Map<number, string>>();
  for (const block of compoXml.split('<COMPO>').slice(1)) {
    const alim = tag(block, 'alim_code');
    const constCode = Number(tag(block, 'const_code'));
    const teneur = tag(block, 'teneur');
    if (!alim || !Number.isFinite(constCode) || teneur == null) continue;
    const m = byFood.get(alim) ?? byFood.set(alim, new Map()).get(alim)!;
    m.set(constCode, teneur);
  }

  const foods: SeedFood[] = [];
  let noMacros = 0;
  for (const block of alimXml.split('<ALIM>').slice(1)) {
    const code = tag(block, 'alim_code');
    if (!code) continue;
    const fr = tag(block, 'alim_nom_fr');
    const en = tag(block, 'alim_nom_eng');
    const name = en || fr;
    if (!name) continue;
    const values = byFood.get(code);
    if (!values) continue;

    const kcal = pick(values, MACRO_CODES.kcal, 'macro');
    const protein = pick(values, MACRO_CODES.protein, 'macro');
    const carb = pick(values, MACRO_CODES.carb, 'macro');
    const fat = pick(values, MACRO_CODES.fat, 'macro');
    if (kcal == null || protein == null || carb == null || fat == null) {
      noMacros++;
      continue;
    }
    const per_100g: Per100g = {
      kcal: round(kcal, 2),
      protein: round(protein, 2),
      carb: round(carb, 2),
      fat: round(fat, 2),
      fiber: round(pick(values, MACRO_CODES.fiber, 'macro') ?? 0, 2),
    };
    const sugar = pick(values, MACRO_CODES.sugar, 'macro');
    const sodium = pick(values, MACRO_CODES.sodium, 'macro');
    const satFat = pick(values, MACRO_CODES.sat_fat, 'macro');
    if (sugar != null) per_100g.sugar = round(sugar, 2);
    if (sodium != null) per_100g.sodium = round(sodium, 2);
    if (satFat != null) per_100g.sat_fat = round(satFat, 2);

    const micros: Micros = {};
    for (const key of MICRO_KEYS) {
      const v = pick(values, MICRO_CODES[key], 'micro');
      if (v != null) micros[key] = round(v, 4);
    }

    // The French name is the alias, so "pecorino" and "fromage de brebis" both find it.
    const aliases = fr && fr !== name ? [fr] : [];
    foods.push({
      id: `ciqual:${code}`,
      external_id: code,
      name,
      ...(aliases.length ? { aliases } : {}),
      per_100g,
      micros,
      micro_coverage: round(microCoverageOf(micros), 3),
      // Ciqual publishes no household portions; grams and the §8.1 borrowing path cover it.
      portions: [],
    });
  }

  foods.sort((a, b) => (a.name < b.name ? -1 : 1));
  const seed: SeedFile = {
    format: 1,
    source: 'ciqual',
    generated_at: new Date().toISOString(),
    count: foods.length,
    foods,
  };
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, 'foods-ciqual.json');
  writeFileSync(path, JSON.stringify(seed));
  const withMicros = foods.filter((f) => f.micro_coverage > 0).length;
  console.log(
    `ciqual: ${foods.length} foods (${withMicros} with micronutrients), ${noMacros} dropped for missing macros`,
  );
  console.log(`wrote ${path}`);
}

await main();
