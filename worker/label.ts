// SPEC §9.6 — /api/label: a photograph of a nutrition label becomes the fields of a custom
// food. Labels are printed in whatever language the shop sells in, and in per-100 g or
// per-serving form (or both); reading them is exactly what a vision model is good at, and
// unlike estimating a plate from a photo the answer is printed on the packet.

import { callJson, DEFAULT_MODEL, type OpenRouterEnv } from './openrouter';

export interface LabelEnv extends OpenRouterEnv {
  VISION_MODEL?: string;
}

const MAX_IMAGE_BYTES = 1_500_000;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'name',
    'brand',
    'basis',
    'serving_g',
    'kcal',
    'protein_g',
    'carb_g',
    'fat_g',
    'fiber_g',
    'confidence',
    'notes',
  ],
  properties: {
    name: { type: 'string' },
    brand: { type: 'string' },
    /** What the figures below describe. */
    basis: { type: 'string', enum: ['per_100g', 'per_serving'] },
    /** Grams in one serving when the label states one, else 0. */
    serving_g: { type: 'number' },
    kcal: { type: 'number' },
    protein_g: { type: 'number' },
    carb_g: { type: 'number' },
    fat_g: { type: 'number' },
    fiber_g: { type: 'number' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    notes: { type: 'string' },
  },
} as const;

const SYSTEM_PROMPT = `You read nutrition labels from photographs and return their figures as JSON.

The label may be in any language (Arabic, Italian, French, German, Spanish, Japanese…) and any
format. Read what is printed; do not estimate or recall typical values for the product.

Rules:
- basis: "per_100g" when the column you read is per 100 g or per 100 ml, "per_serving" when it
  is per portion, per piece, per pack or per cup. If the label shows both, read the per-100 g
  column and set basis to per_100g.
- serving_g: the grams (or millilitres) in one serving when the label states it, else 0.
- Energy: give kcal. If only kJ is printed, divide by 4.184.
- carb_g is total carbohydrate. Where a label gives "of which sugars", ignore that line. In the
  US format "Total Carbohydrate" is the figure; in the EU format "Carbohydrate" is.
- fiber_g: dietary fibre, 0 when the label does not print it.
- Translate the product name into the language of the label as printed, keeping it short. Use
  the brand exactly as printed, or "" when none is visible.
- confidence: high when the figures are legible and unambiguous, medium when you are reading a
  blurred or angled label, low when you are unsure of the column or the units.
- notes: one short sentence naming any doubt, or "".
Return only the JSON object.`;

export interface LabelRequest {
  /** JPEG as a data URL, already downscaled by the client. */
  image?: string;
}

export async function runLabel(
  req: LabelRequest,
  env: LabelEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<
  { ok: true; result: unknown; model: string } | { ok: false; status: number; error: string }
> {
  if (!env.OPENROUTER_API_KEY) {
    return { ok: false, status: 503, error: 'Label reading is not set up on the server yet.' };
  }
  const image = typeof req.image === 'string' ? req.image : '';
  if (!image.startsWith('data:image/jpeg;base64,') || image.length > MAX_IMAGE_BYTES * 1.4) {
    return { ok: false, status: 400, error: 'Photo must be a JPEG under 1.5 MB.' };
  }
  return callJson(
    {
      model: env.VISION_MODEL || DEFAULT_MODEL,
      system: SYSTEM_PROMPT,
      user: [
        { type: 'text', text: 'Read this nutrition label.' },
        // Labels are small print: the detailed path is worth the extra tokens here.
        { type: 'image_url', image_url: { url: image, detail: 'high' } },
      ],
      temperature: 0,
      max_tokens: 700,
      schemaName: 'nutrition_label',
      schema: SCHEMA,
      service: 'label reader',
    },
    env,
    fetchImpl,
  );
}
