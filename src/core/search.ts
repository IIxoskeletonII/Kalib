// In-memory food search. ~5k USDA rows + custom foods is small enough to score on every
// keystroke; ranking prefers Foundation over SR Legacy and foods the user actually logs.
import type { FoodSource } from './types';

export interface SearchDoc {
  id: string;
  name: string;
  brand?: string;
  source: FoodSource;
  tokens: string[];
}

export interface SearchHit extends SearchDoc {
  score: number;
}

const SOURCE_BOOST: Record<FoodSource, number> = {
  custom: 3,
  usda_foundation: 2,
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
}): SearchDoc {
  const doc: SearchDoc = {
    id: f.id,
    name: f.name,
    source: f.source,
    tokens: tokenize(f.brand ? `${f.name} ${f.brand}` : f.name),
  };
  if (f.brand) doc.brand = f.brand;
  return doc;
}

/** Best match of a query token against a document's tokens: 3 exact, 2 prefix, 0 none. */
function tokenScore(q: string, tokens: readonly string[]): number {
  let best = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    let s = 0;
    if (t === q) s = 3;
    else if (t.startsWith(q)) s = 2;
    if (s > 0) {
      // Earlier tokens are the "head noun" in USDA naming ("Chicken, breast, ...").
      s += i === 0 ? 0.5 : i === 1 ? 0.25 : 0;
      if (s > best) best = s;
    }
  }
  return best;
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
