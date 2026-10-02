// ETL: data/mena-sources.json → public/data/foods-mena.json (SPEC §7.1b).
// Run with `npm run seed:mena`. No download: the source table is committed, because it was
// transcribed out of two PDFs and every value should be reviewable in a diff.
//
// Why this file exists. A search probe of the vocabulary two people actually type found 24% of
// Gulf and Levantine terms against 95% of plain English ones, and the database held *zero*
// entries for shawarma, kebab or doner. §14 puts the owner in Oman for five weeks from late
// December.
//
// There is no openly licensed Arabic food composition database. What exists are published,
// lab-analysed national tables with no stated licence. Nutrient values are facts and facts are
// not copyrightable; what a database right protects is the selection and arrangement of a whole
// table. So this is a transcription of named rows, each carrying the table it came from, and
// each checked before it was written:
//
//   - every row satisfies the 4/4/9 energy identity
//   - the Saudi rows additionally had to agree with their own nitrogen figure (protein ≈ N×6.25)
//     and their own kJ figure, or they were dropped: six of 130 were
//   - the Lebanese rows were reconciled against that report's independent per-serving table
//
// Those checks exist because the Saudi PDF's plain text layer sits one row out of step with its
// visual table: parsed naively it files ash as fibre. `pdftotext -table` reads it correctly, and
// the gates above catch it if a future edition does not.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { microCoverageOf } from '../src/core/nutrients';
import type { SeedFile, SeedFood } from '../src/core/seedFormat';
import type { Micros, Per100g } from '../src/core/types';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'public', 'data');

interface SourceRef {
  title: string;
  publisher: string;
  year: number;
  url: string;
  method: string;
}

interface SourceFood {
  name: string;
  aliases: string[];
  per_100g: Per100g;
  micros: Micros;
  source: string;
  table: string;
}

interface SourceFile {
  format: 1;
  note: string;
  sources: Record<string, SourceRef>;
  foods: SourceFood[];
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

function main(): void {
  const src = JSON.parse(
    readFileSync(join(ROOT, 'data', 'mena-sources.json'), 'utf8'),
  ) as SourceFile;

  const seen = new Set<string>();
  const foods: SeedFood[] = [];
  for (const f of src.foods) {
    const ref = src.sources[f.source];
    if (!ref) throw new Error(`${f.name}: unknown source ${f.source}`);
    const id = `mena:${f.source}:${slug(f.name)}`;
    if (seen.has(id)) continue;
    seen.add(id);

    // The energy identity is re-checked here as well as in the transcription, so a hand edit to
    // the committed source file cannot quietly ship a wrong row.
    const p = f.per_100g;
    const fromMacros = p.protein * 4 + p.carb * 4 + p.fat * 9;
    if (Math.abs(fromMacros - p.kcal) > Math.max(30, p.kcal * 0.25)) {
      throw new Error(
        `${f.name}: macros give ${Math.round(fromMacros)} kcal, the table says ${p.kcal}`,
      );
    }

    foods.push({
      id,
      external_id: slug(f.name),
      name: f.name,
      ...(f.aliases.length ? { aliases: f.aliases } : {}),
      category: 'Middle Eastern dishes',
      per_100g: p,
      micros: f.micros,
      micro_coverage: round(microCoverageOf(f.micros), 3),
      // Neither table publishes household portions in a form worth transcribing, so these are
      // logged in grams and borrow a portion through §8.1 where one fits.
      portions: [],
      source_ref: `${ref.publisher}, ${ref.title} (${ref.year}), ${f.table}`,
    });
  }

  foods.sort((a, b) => (a.name < b.name ? -1 : 1));
  const seed: SeedFile = {
    format: 1,
    source: 'mena',
    generated_at: new Date().toISOString(),
    count: foods.length,
    foods,
  };
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, 'foods-mena.json');
  writeFileSync(path, JSON.stringify(seed));
  const bySource = new Map<string, number>();
  for (const f of src.foods) bySource.set(f.source, (bySource.get(f.source) ?? 0) + 1);
  console.log(
    `mena: ${foods.length} dishes (${[...bySource].map(([k, n]) => `${k} ${n}`).join(', ')})`,
  );
  console.log(`wrote ${path}`);
}

main();
