// SPEC §9 — /api/estimate: description (+ optional photo) → structured meal estimate via
// OpenRouter. The key never leaves the Worker; the model id is a Worker variable so it can be
// swapped in one place (§9.3). The client validates and grounds the result.

import { callJson, DEFAULT_MODEL, type ContentPart, type OpenRouterEnv } from './openrouter';

export { DEFAULT_MODEL, extractJson } from './openrouter';

export interface EstimateEnv extends OpenRouterEnv {
  VISION_MODEL?: string;
}

/** A 1024 px JPEG is ~150–300 KB; anything far above is not from our client. */
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_DESCRIPTION = 600;

const SYSTEM_PROMPT = `You estimate the nutrition of one meal for a food log. You are given a short
description written by the person who ate it and sometimes a photo. Treat the description as
the primary evidence: it names what is there, including things a photo cannot show (oil,
butter, sauce, sugar, portion hints). Use the photo, when present, only to judge portions
and to notice items the description omitted.

Rules:
- List each distinct food as one item. Do not merge a plate into a single item unless it
  is genuinely one dish (e.g. "lasagne").
- grams_estimate is the edible cooked weight as eaten. grams_range is a realistic low–high.
- kcal and macros are for grams_estimate, computed from typical composition. Be honest:
  the person would rather be 10% over than 10% under.
- search_term: 2–4 plain English words a nutrition database would index, main ingredient
  first, singular, generic, no brands: "egg scrambled", "bread white toasted", "chicken
  breast grilled", "rice white cooked", "coffee latte whole milk". For a mixed dish with no
  obvious database entry use the dish name ("lasagne").
- confidence: high when the item and its portion are clear; medium when the item is clear
  but the portion is a guess; low when either is uncertain.
- hidden_ingredients_assumed: cooking fats, dressings, sugar, milk you assumed but were not
  told about, each with an approximate amount.
- total_kcal_range: a realistic low–high for the whole meal.
- notes: one short sentence, or empty.
Return only the JSON object.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'hidden_ingredients_assumed', 'total_kcal_range', 'notes'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name',
          'search_term',
          'grams_estimate',
          'grams_range',
          'kcal',
          'protein_g',
          'carb_g',
          'fat_g',
          'fiber_g',
          'confidence',
        ],
        properties: {
          name: { type: 'string' },
          search_term: { type: 'string' },
          grams_estimate: { type: 'number' },
          grams_range: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
          kcal: { type: 'number' },
          protein_g: { type: 'number' },
          carb_g: { type: 'number' },
          fat_g: { type: 'number' },
          fiber_g: { type: 'number' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
    hidden_ingredients_assumed: { type: 'array', items: { type: 'string' } },
    total_kcal_range: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
    notes: { type: 'string' },
  },
} as const;

export interface EstimateRequest {
  description?: string;
  /** JPEG as a data URL (`data:image/jpeg;base64,...`), already downscaled by the client. */
  image?: string;
}

/** Runs the estimate; returns the raw JSON object the model produced (client validates). */
export async function runEstimate(
  req: EstimateRequest,
  env: EstimateEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<
  { ok: true; result: unknown; model: string } | { ok: false; status: number; error: string }
> {
  if (!env.OPENROUTER_API_KEY) {
    return {
      ok: false,
      status: 503,
      error: 'Estimation is not set up on the server yet (OPENROUTER_API_KEY).',
    };
  }
  const description = (req.description ?? '').trim().slice(0, MAX_DESCRIPTION);
  const image = typeof req.image === 'string' ? req.image : '';
  if (!description && !image)
    return { ok: false, status: 400, error: 'Describe the meal or add a photo.' };
  if (
    image &&
    (!image.startsWith('data:image/jpeg;base64,') || image.length > MAX_IMAGE_BYTES * 1.4)
  ) {
    return { ok: false, status: 400, error: 'Photo must be a JPEG under 1.5 MB.' };
  }

  const content: ContentPart[] = [];
  content.push({
    type: 'text',
    text: description
      ? `Description from the person who ate it: "${description}"`
      : 'No description was given; estimate from the photo alone and keep confidence low.',
  });
  if (image) content.push({ type: 'image_url', image_url: { url: image, detail: 'low' } });

  return callJson(
    {
      model: env.VISION_MODEL || DEFAULT_MODEL,
      system: SYSTEM_PROMPT,
      user: content,
      temperature: 0.2,
      max_tokens: 900,
      schemaName: 'meal_estimate',
      schema: SCHEMA,
      service: 'estimation service',
    },
    env,
    fetchImpl,
  );
}
