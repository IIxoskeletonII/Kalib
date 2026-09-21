// In-memory food search. ~5k USDA rows + custom foods is small enough to score on every
// keystroke; ranking prefers Foundation over SR Legacy and foods the user actually logs.
import type { FoodSource } from './types';

export interface SearchDoc {
  id: string;
  name: string;
  brand?: string;
  source: FoodSource;
  /** Materialised recipe (SPEC §8.2). */
  recipe?: boolean;
  tokens: string[];
}

export interface SearchHit extends SearchDoc {
  score: number;
}

const SOURCE_BOOST: Record<FoodSource, number> = {
  custom: 3,
  usda_foundation: 1.25,
  off: 1,
  photo: 0.5,
  usda_sr: 0,
};

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

export function buildSearchDoc(f: {
  id: string;
  name: string;
  brand?: string | undefined;
  source: FoodSource;
  recipe_id?: string | undefined;
}): SearchDoc {
  const doc: SearchDoc = {
    id: f.id,
    name: f.name,
    source: f.source,
    tokens: tokenize(f.brand ? `${f.name} ${f.brand}` : f.name),
  };
  if (f.brand) doc.brand = f.brand;
  if (f.recipe_id) doc.recipe = true;
  return doc;
}

/** "eggs" → "egg", "berries" → "berry"; USDA names are singular, people type either. */
function singular(q: string): string | undefined {
  if (q.length < 4) return undefined;
  if (q.endsWith('ies')) return q.slice(0, -3) + 'y';
  if (q.endsWith('es') && /[sxz]es$|[cs]hes$/.test(q)) return q.slice(0, -2);
  if (q.endsWith('s') && !q.endsWith('ss')) return q.slice(0, -1);
  return undefined;
}

function matchOne(q: string, t: string): number {
  if (t === q) return 3;
  if (t.startsWith(q)) return 2;
  const sg = singular(q);
  if (sg && (t === sg || t.startsWith(sg))) return 2.5;
  return 0;
}

/** Best match of a query token against a document's tokens: 3 exact, 2 prefix, 0 none. */
function tokenScore(q: string, tokens: readonly string[]): number {
  let best = 0;
  for (let i = 0; i < tokens.length; i++) {
    const s = matchOne(q, tokens[i]!);
    // "Oil, olive" over "Oil, corn, peanut, and olive": the nearer the front, the more it is
    // what the name is about.
    if (s > 0 && s - Math.min(0.4, 0.05 * i) > best) best = s - Math.min(0.4, 0.05 * i);
  }
  return best;
}

/**
 * USDA names lead with the food itself ("Oil, olive, ..."; "Chicken, breast, ..."). A query
 * that names the head noun is asking for that food; one that only matches later tokens is
 * usually asking for something else that merely contains it ("olive oil" ≠ anchovies in it).
 */
function headBonus(q: readonly string[], tokens: readonly string[]): number {
  const head = tokens[0];
  const second = tokens[1];
  if (head && q.some((qt) => matchOne(qt, head) > 0)) return 2;
  if (second && q.some((qt) => matchOne(qt, second) > 0)) return 0.75;
  return 0;
}

/** Forms nobody means when they type the plain food: dried yolk, powdered milk, baby food. */
const LESS_EVERYDAY: Record<string, number> = {
  dried: 0.8,
  dehydrated: 0.8,
  powder: 0.8,
  powdered: 0.8,
  imitation: 0.8,
  infant: 1,
  baby: 1,
  concentrate: 0.6,
  pasteurized: 0.3,
  frozen: 0.3,
  canned: 0.3,
};

function everydayPenalty(tokens: readonly string[]): number {
  let p = 0;
  for (const t of tokens) p += LESS_EVERYDAY[t] ?? 0;
  return p;
}

/**
 * Match quality alone, 0–3.5 per token averaged, 0 if any token misses — used by §9.4
 * grounding to decide whether a model's item really is this food, independent of the usage
 * and source boosts that rank search results.
 */
export function matchQuality(doc: SearchDoc, query: string): number {
  const q = tokenize(query);
  if (q.length === 0) return 0;
  let sum = 0;
  for (const qt of q) {
    const s = tokenScore(qt, doc.tokens);
    if (s === 0) return 0;
    sum += s;
  }
  return sum / q.length;
}

/**
 * Every query token must prefix-match some document token. Score = match quality +
 * source boost + log2(1 + usage) + a small bonus for short names.
 */
export function searchFoods(
  docs: readonly SearchDoc[],
  query: string,
  usage?: ReadonlyMap<string, number>,
  limit = 30,
): SearchHit[] {
  const q = tokenize(query);
  if (q.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const d of docs) {
    let score = 0;
    let ok = true;
    for (const qt of q) {
      const s = tokenScore(qt, d.tokens);
      if (s === 0) {
        ok = false;
        break;
      }
      score += s;
    }
    if (!ok) continue;
    score += headBonus(q, d.tokens);
    score -= everydayPenalty(d.tokens);
    score += SOURCE_BOOST[d.source];
    const used = usage?.get(d.id) ?? 0;
    if (used > 0) score += Math.log2(1 + used);
    score += 1 / Math.max(1, d.tokens.length);
    hits.push({ ...d, score });
  }
  hits.sort(
    (a, b) => b.score - a.score || a.name.length - b.name.length || (a.name < b.name ? -1 : 1),
  );
  return hits.slice(0, limit);
}
