// SPEC §9.7 — /api/menu: a photograph of a menu becomes a shortlist of what is on it, with
// what each dish would cost you.
//
// Eating out is the gap nobody in the market has closed. The reason is structural: an
// independent kitchen standardises nothing, so no database can hold the answer, and the honest
// error on a restaurant plate is around a fifth either way. Every app that hides that behind a
// single tidy number is lying about the one meal where the number matters least.
//
// So this endpoint does the opposite. It reads the printed dish names — which are real data,
// unlike a guess at what is on the plate — estimates a typical restaurant portion, and returns
// a range with it. The client grounds each dish against the FNDDS "as eaten" foods exactly as
// §9.4 does, and shows the band rather than burying it.
//
// The response is deliberately the same shape as /api/estimate, so the whole of `core/estimate`
// applies unchanged: same validation, same grounding, same +10% bias on what stays an estimate.

export interface MenuEnv {
  OPENROUTER_API_KEY?: string;
  VISION_MODEL?: string;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_NOTE = 200;
/** More than this and the list stops being a shortlist. */
export const MAX_DISHES = 12;

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
          /** The dish as the menu prints it. */
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

const SYSTEM_PROMPT = `You read restaurant menus from photographs and estimate what one serving of
each dish contains, for someone deciding what to order.

The menu may be in any language. Read the dish names that are printed; never invent dishes that
are not on it.

Rules:
- One item per dish. At most ${MAX_DISHES}; if the menu is longer, keep the dishes a person
  tracking protein and calories would plausibly choose between, and say so in notes.
- name: the dish as printed, shortened to something readable. Keep the menu's own language.
- search_term: 2-4 generic English words for a food-database lookup, main component first
  ("chicken shawarma wrap", "grilled salmon", "margherita pizza").
- grams_estimate: the weight of one restaurant serving as actually served, including sauce and
  the oil it was cooked in. Restaurant portions are larger and oilier than home cooking; do not
  return a home-cooked portion.
- grams_range: an honest low and high for the serving. Independent kitchens vary widely, so this
  range should be wide — commonly plus or minus a fifth or more.
- Macros describe the whole serving at grams_estimate, not per 100 g.
- Count what the kitchen adds and the menu does not mention: cooking oil, butter, dressing,
  sauce, cheese, sugar in marinades. List those in hidden_ingredients_assumed.
- confidence: never "high". Use "medium" for a standard, well-defined dish (a plain grilled
  chicken breast, a margherita) and "low" for anything whose recipe varies by kitchen.
- notes: one short sentence on what you could not tell from the menu, or "".
Return only the JSON object.`;

export interface MenuRequest {
  /** JPEG as a data URL, already downscaled by the client. */
  image?: string;
  /** Optional: the restaurant or cuisine, which narrows the guesswork. */
  place?: string;
}

type Content =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export async function runMenu(
  req: MenuRequest,
  env: MenuEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<
  { ok: true; result: unknown; model: string } | { ok: false; status: number; error: string }
> {
  if (!env.OPENROUTER_API_KEY) {
    return { ok: false, status: 503, error: 'Menu reading is not set up on the server yet.' };
  }
  const image = typeof req.image === 'string' ? req.image : '';
  if (!image.startsWith('data:image/jpeg;base64,') || image.length > MAX_IMAGE_BYTES * 1.4) {
    return { ok: false, status: 400, error: 'Photo must be a JPEG under 1.5 MB.' };
  }
  const place = (typeof req.place === 'string' ? req.place : '').trim().slice(0, MAX_NOTE);

  const content: Content[] = [
    {
      type: 'text',
      text: place
        ? `This is the menu at: ${place}. Read it and estimate each dish.`
        : 'Read this menu and estimate each dish.',
    },
    // Menus are printed small and densely: the detailed path earns its tokens, as with labels.
    { type: 'image_url', image_url: { url: image, detail: 'high' } },
  ];

  const model = env.VISION_MODEL || 'google/gemini-3.1-flash-lite';
  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content },
    ],
    temperature: 0.2,
    max_tokens: 1600,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'menu_estimate', strict: true, schema: SCHEMA },
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
    return { ok: false, status: 502, error: 'Could not reach the menu reader.' };
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    return { ok: false, status: 502, error: `Menu reader error ${res.status}: ${text}` };
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | Content[] } }[];
  };
  const raw = data.choices?.[0]?.message?.content;
  const text =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw.map((c) => ('text' in c ? c.text : '')).join('')
        : '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, status: 502, error: 'No JSON came back.' };
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { items?: unknown[] };
    // The schema cannot express a maximum length, so the cap is enforced here.
    if (Array.isArray(parsed.items) && parsed.items.length > MAX_DISHES) {
      parsed.items = parsed.items.slice(0, MAX_DISHES);
    }
    return { ok: true, result: parsed, model };
  } catch {
    return { ok: false, status: 502, error: 'The menu reader returned malformed JSON.' };
  }
}
