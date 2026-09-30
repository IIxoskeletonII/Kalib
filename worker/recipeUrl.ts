// SPEC §8.2 — /api/recipe: a link to a recipe becomes a recipe in the app.
//
// Almost every recipe site publishes schema.org/Recipe as JSON-LD in the page, because that is
// how search engines read it. So the common path costs nothing and invents nothing: fetch the
// page, read the structured data the publisher put there for machines, and hand back its
// ingredients and steps. The model is only asked when a page has no structured data at all.
//
// Fetching a URL a user supplies is a server-side request forgery surface, so the guard below
// is deliberately strict and fails closed: https or http only, no IP literals, no private or
// internal names, no unusual ports, redirects re-checked by hand rather than followed blindly,
// a byte cap and a timeout. Nothing from the caller's session is ever forwarded.

export interface RecipeUrlEnv {
  OPENROUTER_API_KEY?: string;
  TEXT_MODEL?: string;
}

const MAX_BYTES = 1_200_000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_INGREDIENTS = 40;
const MAX_STEPS = 30;

/** Hostnames that must never be fetched, however they are spelled. */
const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.test',
  '.example',
  '.invalid',
];
const BLOCKED_HOSTS = ['localhost', 'metadata.google.internal', 'instance-data'];

function isIpLiteral(host: string): boolean {
  // IPv4, IPv4-in-decimal/hex forms, and anything bracketed (IPv6) or containing a colon.
  if (host.includes(':') || host.startsWith('[')) return true;
  if (/^[0-9.]+$/.test(host)) return true;
  if (/^0[xX][0-9a-fA-F]+$/.test(host)) return true;
  return false;
}

export interface UrlCheck {
  ok: boolean;
  reason?: string;
}

/** Whether a URL is safe for the Worker to fetch on a user's behalf. */
export function checkUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'That does not look like a link.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'Only http and https links can be read.' };
  }
  const host = url.hostname.toLowerCase();
  if (!host || isIpLiteral(host)) {
    return { ok: false, reason: 'Links to raw IP addresses are not read.' };
  }
  if (BLOCKED_HOSTS.includes(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'That address is not reachable from here.' };
  }
  if (!host.includes('.')) {
    return { ok: false, reason: 'That address is not reachable from here.' };
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    return { ok: false, reason: 'Only the standard web ports are read.' };
  }
  return { ok: true };
}

/** Fetches the page as text, checking every redirect hop against `checkUrl`. */
export async function fetchPage(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; html: string; url: string } | { ok: false; status: number; error: string }> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = checkUrl(current);
    if (!check.ok) return { ok: false, status: 400, error: check.reason ?? 'Link not allowed.' };
    let res: Response;
    try {
      res = await fetchImpl(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          // Identify honestly, and ask only for what is going to be parsed.
          'user-agent': 'KalibRecipeReader/1.0 (+https://kalib.kalib.workers.dev)',
          accept: 'text/html,application/xhtml+xml',
        },
      });
    } catch {
      return { ok: false, status: 502, error: 'Could not reach that page.' };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { ok: false, status: 502, error: 'That page redirected nowhere.' };
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) {
      return { ok: false, status: 502, error: `That page answered ${res.status}.` };
    }
    const type = res.headers.get('content-type') ?? '';
    if (type && !type.includes('html') && !type.includes('xml') && !type.includes('json')) {
      return { ok: false, status: 415, error: 'That link is not a web page.' };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return { ok: false, status: 413, error: 'That page is too large to read.' };
    }
    return { ok: true, html: new TextDecoder().decode(buf), url: current };
  }
  return { ok: false, status: 502, error: 'That link redirects too many times.' };
}

// --- schema.org/Recipe ----------------------------------------------------------------------

export interface ParsedRecipe {
  name: string;
  blurb: string;
  /** Ingredient lines exactly as the publisher wrote them. */
  ingredients: string[];
  steps: string[];
  servings: number;
  time_min: number;
  source: string;
}

function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(' ');
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.name === 'string') return o.name;
  }
  return '';
}

/** "PT1H20M" / "PT45M" -> minutes. */
export function isoDurationToMinutes(v: unknown): number {
  if (typeof v !== 'string') return 0;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(v.trim().toUpperCase());
  if (!m) return 0;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function servingsOf(v: unknown): number {
  const text = textOf(v);
  const m = /\d+/.exec(text);
  const n = m ? Number(m[0]) : 0;
  return n >= 1 && n <= 50 ? n : 0;
}

function stepsOf(v: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (out.length >= MAX_STEPS) return;
    if (typeof node === 'string') {
      const t = node.trim();
      if (t) out.push(t);
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      // A HowToSection holds its own list of steps.
      if (o.itemListElement) {
        walk(o.itemListElement);
        return;
      }
      const t = textOf(o).trim();
      if (t) out.push(t);
    }
  };
  walk(v);
  return out;
}

/** Every JSON-LD block in the page, flattened through `@graph` wrappers. */
export function jsonLdNodes(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const body = (m[1] ?? '').trim();
    if (!body) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    const push = (node: unknown) => {
      if (Array.isArray(node)) {
        for (const n of node) push(n);
        return;
      }
      if (node && typeof node === 'object') {
        const o = node as Record<string, unknown>;
        if (o['@graph']) push(o['@graph']);
        out.push(o);
      }
    };
    push(parsed);
  }
  return out;
}

function isRecipeNode(o: Record<string, unknown>): boolean {
  const t = o['@type'];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => typeof x === 'string' && x.toLowerCase() === 'recipe');
}

/** The recipe a page declares about itself, or undefined when it declares none. */
export function parseJsonLdRecipe(html: string, sourceUrl: string): ParsedRecipe | undefined {
  const node = jsonLdNodes(html).find(isRecipeNode);
  if (!node) return undefined;
  const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [])
    .map((x) => textOf(x).trim())
    .filter(Boolean)
    .slice(0, MAX_INGREDIENTS);
  if (ingredients.length === 0) return undefined;
  const name = textOf(node.name).trim();
  if (!name) return undefined;
  const total = isoDurationToMinutes(node.totalTime);
  const cook = isoDurationToMinutes(node.cookTime) + isoDurationToMinutes(node.prepTime);
  return {
    name: name.slice(0, 120),
    blurb: textOf(node.description).trim().slice(0, 240),
    ingredients,
    steps: stepsOf(node.recipeInstructions),
    servings: servingsOf(node.recipeYield),
    time_min: total || cook,
    source: sourceUrl,
  };
}

// --- the fallback, for pages with no structured data ----------------------------------------

/** Visible text, roughly: scripts and styles dropped, tags stripped, entities loosened. */
export function visibleText(html: string, limit = 12000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'blurb', 'ingredients', 'steps', 'servings', 'time_min'],
  properties: {
    name: { type: 'string' },
    blurb: { type: 'string' },
    ingredients: { type: 'array', items: { type: 'string' } },
    steps: { type: 'array', items: { type: 'string' } },
    servings: { type: 'number' },
    time_min: { type: 'number' },
  },
} as const;

const SYSTEM_PROMPT = `You pull a recipe out of the text of a web page.

Return only what the page says. Never invent an ingredient, a quantity or a step. If the text is
not a recipe, return an empty name and empty lists.

- ingredients: one line each, exactly as written, including quantities ("200 g plain flour").
  Drop headings like "For the sauce".
- steps: the numbered method, one sentence or two per step, in order. Drop chatter, adverts,
  and anything about the author.
- servings: the number the recipe makes, or 0 when it does not say.
- time_min: total time in minutes, or 0 when it does not say.
- blurb: one short sentence describing the dish.
Return only the JSON object.`;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function readRecipeWithModel(
  text: string,
  sourceUrl: string,
  env: RecipeUrlEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedRecipe | undefined> {
  if (!env.OPENROUTER_API_KEY) return undefined;
  const model = env.TEXT_MODEL || 'google/gemini-3.1-flash-lite';
  let res: Response;
  try {
    res = await fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'content-type': 'application/json',
        'http-referer': 'https://kalib.kalib.workers.dev',
        'x-title': 'Kalib',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: 1400,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'page_recipe', strict: true, schema: SCHEMA },
        },
      }),
    });
  } catch {
    return undefined;
  }
  if (!res.ok) return undefined;
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '';
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  let parsed: Partial<ParsedRecipe>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<ParsedRecipe>;
  } catch {
    return undefined;
  }
  const ingredients = (parsed.ingredients ?? [])
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .slice(0, MAX_INGREDIENTS);
  const name = (parsed.name ?? '').trim();
  if (!name || ingredients.length === 0) return undefined;
  return {
    name: name.slice(0, 120),
    blurb: (parsed.blurb ?? '').trim().slice(0, 240),
    ingredients,
    steps: (parsed.steps ?? [])
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      .slice(0, MAX_STEPS),
    servings: Number(parsed.servings) >= 1 ? Math.min(50, Math.round(Number(parsed.servings))) : 0,
    time_min: Number(parsed.time_min) > 0 ? Math.min(1440, Math.round(Number(parsed.time_min))) : 0,
    source: sourceUrl,
  };
}

/** Read a recipe from a link: structured data first, the model only as a fallback. */
export async function runRecipeUrl(
  link: string,
  env: RecipeUrlEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<
  | { ok: true; recipe: ParsedRecipe; via: 'json-ld' | 'model' }
  | { ok: false; status: number; error: string }
> {
  const page = await fetchPage(link, fetchImpl);
  if (!page.ok) return page;
  const structured = parseJsonLdRecipe(page.html, page.url);
  if (structured) return { ok: true, recipe: structured, via: 'json-ld' };
  const fromModel = await readRecipeWithModel(visibleText(page.html), page.url, env, fetchImpl);
  if (fromModel) return { ok: true, recipe: fromModel, via: 'model' };
  return {
    ok: false,
    status: 422,
    error: 'No recipe found on that page. You can still add it by hand.',
  };
}
