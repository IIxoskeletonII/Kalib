// The one call every paid endpoint makes: a chat completion through OpenRouter that must come
// back as a single JSON object matching a schema. It used to be written out five times, once per
// endpoint, and the copies had begun to drift (one parsed the reply without a guard, so a non-JSON
// body from upstream threw instead of answering 502). Each endpoint now owns only what is its
// own: the prompt, the schema, the token budget, and what it is called when it fails.
//
// The key never leaves the Worker. Nothing here logs a prompt or a reply: some of what passes
// through is health data (SPEC §20.16), and a log line is a copy nobody agreed to.

export interface OpenRouterEnv {
  OPENROUTER_API_KEY?: string;
}

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_MODEL = 'google/gemini-3.1-flash-lite';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface JsonCall {
  model: string;
  system: string;
  user: string | ContentPart[];
  temperature: number;
  max_tokens: number;
  /** Name and JSON schema for `response_format`; strict, so the model is held to it. */
  schemaName: string;
  schema: unknown;
  /**
   * What the person would call the thing that failed, lower case: "estimation service",
   * "label reader". Used in "Could not reach the …" and "… error 502".
   */
  service: string;
  /**
   * Whether an upstream error body is passed back to the caller. Off where the request carried
   * something sensitive: an error page is free to quote what it was sent.
   */
  echoUpstreamError?: boolean;
}

export type JsonOutcome =
  { ok: true; result: unknown; model: string } | { ok: false; status: number; error: string };

/** Models occasionally wrap JSON in prose or a code fence; take the outermost object. */
export function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function capitalised(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Runs one schema-bound completion. The caller checks `OPENROUTER_API_KEY` first, because each
 * endpoint words "not set up yet" its own way; this refuses too, in case one forgets.
 */
export async function callJson(
  call: JsonCall,
  env: OpenRouterEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<JsonOutcome> {
  if (!env.OPENROUTER_API_KEY) {
    return {
      ok: false,
      status: 503,
      error: `The ${call.service} is not set up on the server yet.`,
    };
  }
  const body = {
    model: call.model,
    messages: [
      { role: 'system', content: call.system },
      { role: 'user', content: call.user },
    ],
    temperature: call.temperature,
    max_tokens: call.max_tokens,
    response_format: {
      type: 'json_schema',
      json_schema: { name: call.schemaName, strict: true, schema: call.schema },
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
    return { ok: false, status: 502, error: `Could not reach the ${call.service}.` };
  }
  if (!res.ok) {
    const detail =
      call.echoUpstreamError === false
        ? ''
        : `: ${(await res.text().catch(() => '')).slice(0, 300)}`;
    return {
      ok: false,
      status: 502,
      error: `${capitalised(call.service)} error ${res.status}${detail}`,
    };
  }

  let data: { choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[] };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return { ok: false, status: 502, error: 'The model returned malformed JSON.' };
  }
  const raw = data.choices?.[0]?.message?.content;
  const text =
    typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((c) => c.text ?? '').join('') : '';
  const jsonText = extractJson(text);
  if (!jsonText) return { ok: false, status: 502, error: 'The model returned no JSON.' };
  try {
    return { ok: true, result: JSON.parse(jsonText), model: call.model };
  } catch {
    return { ok: false, status: 502, error: 'The model returned malformed JSON.' };
  }
}
