// Open Food Facts normalisation and re-ranking. Pure — unit-tested from vitest.

export interface OffHit {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  product_name_it?: string;
  brands?: string | string[];
  quantity?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  unique_scans_n?: number;
  countries_tags?: string[];
  completeness?: number;
  nutriments?: Record<string, number | string | undefined>;
}

export interface OffProduct {
  code: string;
  name: string;
  brand?: string;
  quantity?: string;
  serving_g?: number;
  per_100g: {
    kcal: number;
    protein: number;
    carb: number;
    fat: number;
    fiber: number;
    sugar?: number;
    sodium?: number;
    sat_fat?: number;
  };
  scans: number;
  italy: boolean;
}

function num(v: number | string | undefined): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

export function brandOf(hit: OffHit): string | undefined {
  const raw = Array.isArray(hit.brands) ? hit.brands.join(', ') : (hit.brands ?? '');
  const first = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return first || undefined;
}

/** Label-level nutrition per 100 g; undefined when the label is incomplete. */
export function normalizeOffProduct(hit: OffHit): OffProduct | null {
  const n = hit.nutriments ?? {};
  const name = (hit.product_name || hit.product_name_en || hit.product_name_it || '').trim();
  if (!hit.code || !name) return null;
  let kcal = num(n['energy-kcal_100g']);
  if (kcal == null) {
    const kj = num(n['energy_100g']);
    if (kj != null) kcal = kj / 4.184;
  }
  const protein = num(n['proteins_100g']);
  const carb = num(n['carbohydrates_100g']);
  const fat = num(n['fat_100g']);
  if (kcal == null || protein == null || carb == null || fat == null) return null;

  const per_100g: OffProduct['per_100g'] = {
    kcal: round(kcal, 1),
    protein: round(protein, 2),
    carb: round(carb, 2),
    fat: round(fat, 2),
    fiber: round(num(n['fiber_100g']) ?? 0, 2),
  };
  const sugar = num(n['sugars_100g']);
  const sat = num(n['saturated-fat_100g']);
  const sodium = num(n['sodium_100g']);
  const salt = num(n['salt_100g']);
  if (sugar != null) per_100g.sugar = round(sugar, 2);
  if (sat != null) per_100g.sat_fat = round(sat, 2);
  if (sodium != null) per_100g.sodium = round(sodium * 1000, 0);
  else if (salt != null) per_100g.sodium = round(salt * 400, 0);

  const out: OffProduct = {
    code: String(hit.code),
    name,
    per_100g,
    scans: num(hit.unique_scans_n) ?? 0,
    italy: (hit.countries_tags ?? []).includes('en:italy'),
  };
  const brand = brandOf(hit);
  if (brand) out.brand = brand;
  if (hit.quantity) out.quantity = String(hit.quantity).trim();
  const serving = num(hit.serving_quantity);
  if (serving != null && serving > 0 && serving < 2000) out.serving_g = round(serving, 1);
  return out;
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Relevance from OFF is poor for our purpose (incomplete entries rank first). Keep only complete
 * labels, then score by query-term overlap, popularity, Italian availability and completeness;
 * collapse duplicates of the same name + brand.
 */
export function rankOffProducts(hits: OffHit[], query: string): OffProduct[] {
  const q = tokens(query);
  const scored: { p: OffProduct; score: number; completeness: number }[] = [];
  for (const h of hits) {
    const p = normalizeOffProduct(h);
    if (!p) continue;
    const text = tokens(`${p.name} ${p.brand ?? ''}`);
    const overlap = q.length
      ? q.filter((t) => text.some((w) => w.startsWith(t))).length / q.length
      : 1;
    // OFF's search matches any term in any field; a product whose name/brand shares nothing
    // with the query is noise no matter how popular it is.
    if (overlap === 0) continue;
    const completeness = num(h.completeness) ?? 0;
    // Names in another script (Cyrillic, Thai, ...) are real products but not what an Italian
    // user is holding; keep them, below the Latin-script entries.
    const latin = /[a-z]/i.test(p.name.normalize('NFD')) ? 0 : -3;
    const score = overlap * 3 + Math.log1p(p.scans) + (p.italy ? 0.5 : 0) + completeness + latin;
    scored.push({ p, score, completeness });
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: OffProduct[] = [];
  for (const s of scored) {
    const key = tokens(`${s.p.name} ${s.p.brand ?? ''}`).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.p);
  }
  return out;
}
