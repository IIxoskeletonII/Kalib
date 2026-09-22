// SPEC §18.6 — /api/suggest: budget + preferences → a few new recipes, as strict JSON, from
// a cheap text model through OpenRouter. This week's publisher titles (worker/trends.ts) are
// offered as themes so the batch follows what people are cooking now. The client grounds the
// ingredients (§9.4) and treats every number as an estimate until the user replaces it.
import type { TrendItem } from './trends';

export interface SuggestEnv {
  OPENROUTER_API_KEY?: string;
  /** Text model for suggestions; falls back to the vision model, then the default. */
  TEXT_MODEL?: string;
  VISION_MODEL?: string;
}

export const DEFAULT_TEXT_MODEL = 'google/gemini-3.1-flash-lite';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Preference cards. The phrase is what the model is told; the id is what the client stores. */
export const SUGGEST_TAGS: Record<string, string> = {
  'high-protein': 'high in protein (35 g or more per portion)',
  'low-calorie': 'light (under 500 kcal per portion)',
  'high-fiber': 'high in fiber (10 g or more per portion, legumes, vegetables, whole grains)',
  quick: 'quick (30 minutes or less from start to plate)',
  'batch-friendly': 'batch-friendly (cooks in one pot or tray, keeps 3–4 days in the fridge)',
  vegetarian: 'vegetarian',
  budget: 'cheap (inexpensive cuts and staples)',
  italian: 'Italian home cooking',
  spicy: 'spicy',
  'one-pot': 'one pot or one tray',
};

export interface SuggestRequest {
  /** Weekly budget in `currency`; 0 means none. */
  budget?: number;
  currency?: string;
  tags?: string[];
  count?: number;
  /** Free text: allergies, dislikes, what is already in the fridge. */
  avoid?: string;
  /** Per-portion targets the recipes should land near. */
  kcal_per_portion?: number;
  protein_per_portion?: number;
  /** Names already shown or owned, so the next batch is new. */
  exclude?: string[];
  /** BCP 47 locale, for typical prices and ingredient availability. */
  locale?: string;
  /** Mix in up to two recipes other people kept (default true). */
  include_bank?: boolean;
}

/** What the server adds to a request: this week's themes. */
export interface SuggestContext {
  trends?: readonly TrendItem[];
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recipes'],
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name',
          'blurb',
          'tags',
          'portions',
          'time_min',
          'oven_c',
          'ingredients',
          'steps',
          'inspiration',
        ],
        properties: {
          name: { type: 'string' },
          blurb: { type: 'string' },
          inspiration: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          portions: { type: 'integer' },
          time_min: { type: 'integer' },
          oven_c: { type: ['integer', 'null'] },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'search_term', 'grams', 'per_100g', 'price_per_kg'],
              properties: {
                name: { type: 'string' },
                search_term: { type: 'string' },
                grams: { type: 'number' },
                per_100g: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['kcal', 'protein', 'carb', 'fat', 'fiber'],
                  properties: {
                    kcal: { type: 'number' },
                    protein: { type: 'number' },
                    carb: { type: 'number' },
                    fat: { type: 'number' },
                    fiber: { type: 'number' },
                  },
                },
                price_per_kg: { type: 'number' },
              },
            },
          },
          steps: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You write dinner recipes for a home cook who tracks calories and protein and
shops once a week. Return only the JSON object.

Rules for every recipe:
- New and genuinely different from the others in the batch and from the excluded names:
  vary the main protein, the cuisine and the cooking method.
- portions is exactly the number asked for. Ingredient grams are for the WHOLE recipe (all
  portions), as bought, raw: "chicken thighs, boneless 800" not "2 thighs".
- Use plain supermarket ingredients. Give every ingredient a search_term of 2–4 generic
  English words a nutrition database indexes, main ingredient first, singular, no brands:
  "chicken thigh raw", "rice white raw", "tomato canned", "olive oil", "onion raw".
- per_100g is the ingredient's typical composition (kcal, protein, carb, fat, fiber per
  100 g as bought). price_per_kg is a typical supermarket price in the requested currency
  for the requested region.
- Land each portion within about 15 % of the calorie and protein targets given.
- Stay inside the weekly budget when one is given: the sum over all recipes of
  Σ grams/1000 × price_per_kg must not exceed it.
- steps: 4–9 numbered-in-order sentences, each with what to do and, where it matters, how long
  ("simmer 18 minutes"), how hot ("oven at 200 °C, fan 180"), and what it should look like.
  Put the oven temperature in oven_c as well, or null if no oven.
- time_min: realistic total time from start to plate.
- blurb: one sentence, appetising, no exclamation marks. tags: the requested preference
  ids the recipe actually satisfies.
- When a list of this week's published dish titles is given, let most of the batch take its
  theme from them (an ingredient, a cuisine, a technique that is in the air right now) and
  write your own recipe for it; set inspiration to the title you drew on, or "" if none.
  Never reproduce a publisher's recipe.
- Respect what the person says to avoid; never include it, not even as optional.`;

function clean(req: SuggestRequest) {
  const count = Math.min(8, Math.max(1, Math.round(Number(req.count) || 4)));
  const budget = Math.max(0, Math.min(100_000, Number(req.budget) || 0));
  const currency = (typeof req.currency === 'string' ? req.currency : '€').slice(0, 4);
  const tags = (Array.isArray(req.tags) ? req.tags : [])
    .filter((t): t is string => typeof t === 'string' && t in SUGGEST_TAGS)
    .slice(0, 6);
  const avoid = (typeof req.avoid === 'string' ? req.avoid : '').trim().slice(0, 200);
  const exclude = (Array.isArray(req.exclude) ? req.exclude : [])
    .filter((n): n is string => typeof n === 'string')
    .map((n) => n.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 40);
  const kcal = Math.max(200, Math.min(1500, Math.round(Number(req.kcal_per_portion) || 650)));
  const protein = Math.max(10, Math.min(120, Math.round(Number(req.protein_per_portion) || 40)));
  const locale = (typeof req.locale === 'string' ? req.locale : 'en').slice(0, 12);
  return { count, budget, currency, tags, avoid, exclude, kcal, protein, locale };
}

export function userPrompt(req: SuggestRequest, ctx: SuggestContext = {}): string {
  const c = clean(req);
  const region = c.locale.includes('-') ? c.locale.split('-')[1]! : 'Europe';
  const trends = (ctx.trends ?? []).slice(0, 30);
  const lines = [
    `Give me ${c.count} dinner recipes, ${c.count === 1 ? 'it serves' : 'each serving'} 4 portions.`,
    `Targets per portion: about ${c.kcal} kcal and ${c.protein} g protein.`,
    c.tags.length
      ? `Preferences: ${c.tags.map((t) => SUGGEST_TAGS[t]).join('; ')}.`
      : 'No particular preferences; make them varied and appealing.',
    c.budget > 0
      ? `Weekly budget for all of them together: ${c.currency}${c.budget}.`
      : 'No budget was given; keep them sensible.',
    `Prices and ingredients typical for ${region} supermarkets, in ${c.currency}.`,
    c.avoid ? `Avoid: ${c.avoid}.` : '',
    c.exclude.length ? `Do not suggest these again: ${c.exclude.join('; ')}.` : '',
    trends.length
      ? `Dish titles food publishers posted this week, for themes only:\n${trends
          .map((t) => `- ${t.title} (${t.source})`)
          .join('\n')}`
      : '',
  ];
  return lines.filter(Boolean).join('\n');
}

export async function runSuggest(
  req: SuggestRequest,
  env: SuggestEnv,
  fetchImpl: typeof fetch = fetch,
  ctx: SuggestContext = {},
): Promise<
  { ok: true; result: unknown; model: string } | { ok: false; status: number; error: string }
> {
  if (!env.OPENROUTER_API_KEY) {
    return { ok: false, status: 503, error: 'Suggestions are not set up on the server yet.' };
  }
  const model = env.TEXT_MODEL || env.VISION_MODEL || DEFAULT_TEXT_MODEL;
  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt(req, ctx) },
    ],
    temperature: 0.8,
    max_tokens: 6000,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'recipe_suggestions', strict: true, schema: SCHEMA },
    },
  };
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
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 502, error: 'Could not reach the suggestion service.' };
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    return { ok: false, status: 502, error: `Suggestion service error ${res.status}: ${text}` };
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | { type: string; text?: string }[] } }[];
  };
  const raw = data.choices?.[0]?.message?.content;
  const text =
    typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((c) => c.text ?? '').join('') : '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return { ok: false, status: 502, error: 'The model returned no JSON.' };
  }
  try {
    return { ok: true, result: JSON.parse(text.slice(start, end + 1)), model };
  } catch {
    return { ok: false, status: 502, error: 'The model returned malformed JSON.' };
  }
}
