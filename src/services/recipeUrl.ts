// SPEC §8.2 — importing a recipe from a link.
//
// The Worker reads the page (its own structured data wherever possible) and hands back the
// ingredient lines as the publisher wrote them. Everything from there is local: each line is
// parsed (§ `core/ingredientLine`), matched against the offline database, and shown with its
// weight for approval. Nothing is saved until the person says so, and any line the app could
// not work out is put in front of them rather than quietly rounded to zero.
import { authHeaders } from '@/services/apiAuth';
import { parseIngredientLines, type ParsedLine } from '@/core/ingredientLine';
import { searchFoods, type SearchHit } from '@/core/search';
import { usablePortions } from '@/core/units';
import type { Food } from '@/core/types';
import { getFoods, listSearchDocs } from '@/db/repo/foods';
import { foodUsageCounts } from '@/db/repo/logEntries';
import {
  addRecipeItem,
  createRecipe,
  setRecipeMeta,
  setRecipePortions,
  setRecipeSteps,
} from '@/services/recipes';

/** The same floor the §9.4 grounding uses: a weak name match is not a match. */
export const MATCH_FLOOR = 2.0;

export interface ImportLine {
  parsed: ParsedLine;
  /** The database food this line was matched to, when one was good enough. */
  food?: Food | undefined;
  /** Grams for the whole recipe. Undefined means the person has to say. */
  grams?: number | undefined;
  /** Where the grams came from, in words, for the review list. */
  note: string;
  /** Left out of the recipe: seasoning, or a line with no weight. */
  skipped: boolean;
}

export interface UrlRecipe {
  name: string;
  blurb: string;
  servings: number;
  time_min: number;
  source: string;
  steps: string[];
  lines: ImportLine[];
  /** How the Worker read the page. */
  via: 'json-ld' | 'model';
}

interface RecipeResponse {
  recipe?: {
    name?: string;
    blurb?: string;
    ingredients?: string[];
    steps?: string[];
    servings?: number;
    time_min?: number;
    source?: string;
  };
  via?: 'json-ld' | 'model';
  error?: string;
}

/** A link is worth sending to the Worker only if it looks like one. */
export function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    const u = new URL(t);
    return u.hostname.includes('.');
  } catch {
    return false;
  }
}

/**
 * Resolve a parsed line to a weight. A stated weight stands. A bare count is answered by the
 * matched food's own portions — "2 eggs" becomes 100 g because the database says an egg is 50 g,
 * not because this app guessed.
 */
export function gramsFor(
  parsed: ParsedLine,
  food: Food | undefined,
): { grams?: number; note: string } {
  if (parsed.grams != null && parsed.grams > 0) {
    const rounded = Math.round(parsed.grams);
    if (parsed.basis === 'weight') return { grams: rounded, note: `${rounded} g as written` };
    if (parsed.basis === 'volume')
      return { grams: rounded, note: `${rounded} ml, weighed as water` };
    if (parsed.basis === 'package')
      return { grams: rounded, note: `${rounded} g, a standard pack` };
    return { grams: rounded, note: `${rounded} g by spoon measure` };
  }
  if (parsed.count != null && food) {
    const portion = usablePortions(food.portions)[0];
    if (portion) {
      const grams = Math.round(parsed.count * portion.grams);
      return { grams, note: `${parsed.count} × ${portion.label} (${grams} g)` };
    }
  }
  if (parsed.seasoning) return { note: 'Seasoning, left out of the macros' };
  return { note: 'No weight given — set it before saving' };
}

/** Read a link into a reviewable recipe. Throws with a readable message on failure. */
export async function readRecipeLink(link: string): Promise<UrlRecipe> {
  const auth = await authHeaders();
  if (!('authorization' in auth)) {
    throw new Error('Sign in first (Settings → Sync) to import from a link.');
  }
  const res = await fetch('/api/recipe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ url: link.trim() }),
  });
  const data = (await res.json().catch(() => ({}))) as RecipeResponse;
  if (!res.ok || !data.recipe) {
    throw new Error(data.error ?? `Could not read that link (${res.status}).`);
  }
  const r = data.recipe;
  const parsedLines = parseIngredientLines(
    (r.ingredients ?? []).filter((x): x is string => typeof x === 'string'),
  );

  const [docs, usage] = await Promise.all([listSearchDocs(), foodUsageCounts()]);
  const hits: (SearchHit | undefined)[] = parsedLines.map((p) => {
    if (!p.term) return undefined;
    const top = searchFoods(docs, p.term, usage, 1)[0];
    return top && top.score >= MATCH_FLOOR ? top : undefined;
  });
  const foodMap = await getFoods(hits.filter((h): h is SearchHit => h != null).map((h) => h.id));

  const lines: ImportLine[] = parsedLines.map((parsed, i) => {
    const hit = hits[i];
    const food = hit ? foodMap.get(hit.id) : undefined;
    const { grams, note } = gramsFor(parsed, food);
    return {
      parsed,
      food,
      grams,
      note,
      skipped: grams == null || food == null,
    };
  });

  return {
    name: (r.name ?? '').trim() || 'Imported recipe',
    blurb: (r.blurb ?? '').trim(),
    servings: Number(r.servings) >= 1 ? Math.round(Number(r.servings)) : 0,
    time_min: Number(r.time_min) > 0 ? Math.round(Number(r.time_min)) : 0,
    source: (r.source ?? link).trim(),
    steps: (r.steps ?? []).filter((x): x is string => typeof x === 'string'),
    lines,
    via: data.via ?? 'json-ld',
  };
}

/** How many of the lines will actually make it into the recipe. */
export function readyCount(r: UrlRecipe): number {
  return r.lines.filter((l) => !l.skipped).length;
}

/** Save the reviewed recipe. Only matched lines with a weight become ingredients. */
export async function importUrlRecipe(r: UrlRecipe): Promise<string> {
  const recipe = await createRecipe(r.name);
  for (const line of r.lines) {
    if (line.skipped || !line.food || line.grams == null) continue;
    await addRecipeItem(recipe.id, line.food, line.grams);
  }
  if (r.servings >= 1) await setRecipePortions(recipe.id, r.servings);
  if (r.steps.length > 0) await setRecipeSteps(recipe.id, r.steps);
  await setRecipeMeta(recipe.id, {
    blurb: r.blurb,
    tags: [],
    time_min: r.time_min,
    source: 'imported',
    // The link stays on the recipe: the publisher wrote it, and the credit is theirs.
    source_url: r.source,
  });
  return recipe.id;
}
