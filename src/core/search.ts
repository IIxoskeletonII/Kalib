// In-memory food search. ~5k USDA rows + custom foods is small enough to score on every
// keystroke; ranking prefers Foundation over SR Legacy and foods the user actually logs.
import { bestTokenScore, matchToken, tokenize } from './text';
import type { FoodSource } from './types';

export { tokenize } from './text';

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
  // FNDDS is "as eaten" (cooked dishes, restaurant items): a touch above SR's raw ingredients.
  usda_fndds: 0.25,
  // Ciqual is lab-analysed and European, so it outranks SR for the foods it has; below
  // Foundation, which is the deeper panel.
  ciqual: 1,
  // Lab-analysed dishes nothing else in the database has; when one matches, it is the answer.
  mena: 1.25,
  // The chain's own published figure for a named menu item, and already filtered to the one
  // market you are in (§21). When you search "big mac" while standing in one, that is the
  // answer — above every generic table's approximation of it, below only your own foods.
  chain: 2,
  usda_sr: 0,
};

export function buildSearchDoc(f: {
  id: string;
  name: string;
  brand?: string | undefined;
  /** Other names the food answers to (§7.1): searched, never shown. */
  aliases?: string[] | undefined;
  source: FoodSource;
  recipe_id?: string | undefined;
}): SearchDoc {
  // Aliases join the token index but not the name, so a match on "ceci" still shows the food
  // by the name the database gives it.
  const text = [f.name, f.brand, ...(f.aliases ?? [])].filter(Boolean).join(' ');
  const doc: SearchDoc = {
    id: f.id,
    name: f.name,
    source: f.source,
    tokens: tokenize(text),
  };
  if (f.brand) doc.brand = f.brand;
  if (f.recipe_id) doc.recipe = true;
  return doc;
}

/**
 * USDA names lead with the food itself ("Oil, olive, ..."; "Chicken, breast, ..."). A query
 * that names the head noun is asking for that food; one that only matches later tokens is
 * usually asking for something else that merely contains it ("olive oil" ≠ anchovies in it).
 */
function headBonus(q: readonly string[], tokens: readonly string[]): number {
  const head = tokens[0];
  const second = tokens[1];
  if (head && q.some((qt) => matchToken(qt, head) > 0)) return 2;
  if (second && q.some((qt) => matchToken(qt, second) > 0)) return 0.75;
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
    const s = bestTokenScore(qt, doc.tokens);
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
      const s = bestTokenScore(qt, d.tokens);
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
    // Fewest extra words wins, but only once the query is a description rather than a
    // single word: someone typing "egg whole raw" means "Egg, whole, raw", not "Egg, whole,
    // raw, frozen, pasteurized". A one-word query is inherently vague, so it is left to the
    // head-noun and everyday rules above.
    if (q.length > 1) {
      const extra = Math.max(0, d.tokens.length - q.length);
      score -= Math.min(1.5, extra * 0.3);
      if (extra === 0) score += 1.5;
    }
    hits.push({ ...d, score });
  }
  hits.sort(
    (a, b) => b.score - a.score || a.name.length - b.name.length || (a.name < b.name ? -1 : 1),
  );
  return hits.slice(0, limit);
}
