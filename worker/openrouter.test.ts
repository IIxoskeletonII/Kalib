import { describe, expect, it, vi } from 'vitest';
import { callJson, extractJson, OPENROUTER_URL, type JsonCall } from './openrouter';

const CALL: JsonCall = {
  model: 'test/model',
  system: 'be terse',
  user: 'hello',
  temperature: 0.1,
  max_tokens: 123,
  schemaName: 'thing',
  schema: { type: 'object' },
  service: 'thing reader',
};
const env = { OPENROUTER_API_KEY: 'sk-test' };

function reply(content: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }),
  ) as unknown as typeof fetch;
}

describe('callJson', () => {
  it('refuses without a key and spends nothing', async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await callJson(CALL, {}, f)).toEqual({
      ok: false,
      status: 503,
      error: 'The thing reader is not set up on the server yet.',
    });
    expect(f).not.toHaveBeenCalled();
  });

  it('sends one strict, schema-bound request with the key in a header only', async () => {
    const f = reply('{"a":1}');
    await callJson(CALL, env, f);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [
      string,
      RequestInit,
    ];
    expect(url).toBe(OPENROUTER_URL);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'test/model',
      temperature: 0.1,
      max_tokens: 123,
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hello' },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'thing', strict: true, schema: { type: 'object' } },
      },
    });
    expect(String(init.body)).not.toContain('sk-test');
  });

  it('returns the parsed object and the model', async () => {
    expect(await callJson(CALL, env, reply('Sure! ```json\n{"a":{"b":2}}\n```'))).toEqual({
      ok: true,
      result: { a: { b: 2 } },
      model: 'test/model',
    });
  });

  it('joins content given as parts', async () => {
    const out = await callJson(
      CALL,
      env,
      reply([
        { type: 'text', text: '{"a":' },
        { type: 'text', text: '3}' },
      ]),
    );
    expect(out).toMatchObject({ ok: true, result: { a: 3 } });
  });

  it('answers 502 when upstream cannot be reached', async () => {
    const f = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await callJson(CALL, env, f)).toEqual({
      ok: false,
      status: 502,
      error: 'Could not reach the thing reader.',
    });
  });

  it('passes an upstream error body back only when allowed to', async () => {
    const f = () =>
      vi.fn(
        async () => new Response('quota exceeded for: SECRET PROMPT', { status: 429 }),
      ) as unknown as typeof fetch;
    const loud = await callJson(CALL, env, f());
    expect(loud).toMatchObject({ ok: false, status: 502 });
    if (!loud.ok)
      expect(loud.error).toBe('Thing reader error 429: quota exceeded for: SECRET PROMPT');
    const quiet = await callJson({ ...CALL, echoUpstreamError: false }, env, f());
    expect(quiet).toEqual({ ok: false, status: 502, error: 'Thing reader error 429' });
  });

  it('answers 502 for a reply that is not JSON at all', async () => {
    const f = vi.fn(
      async () => new Response('<html>gateway</html>', { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await callJson(CALL, env, f)).toMatchObject({ ok: false, status: 502 });
  });

  it('answers 502 for no JSON, malformed JSON, or no choices', async () => {
    expect(await callJson(CALL, env, reply('no json here'))).toMatchObject({
      ok: false,
      status: 502,
    });
    expect(await callJson(CALL, env, reply('{"a": }'))).toMatchObject({ ok: false, status: 502 });
    const empty = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    expect(await callJson(CALL, env, empty)).toMatchObject({ ok: false, status: 502 });
  });

  it('never logs', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    await callJson(CALL, env, reply('{"a":1}'));
    await callJson(CALL, env, reply('nope'));
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});

describe('extractJson', () => {
  it('takes the outermost object', () => {
    expect(extractJson('x {"a":{"b":1}} y')).toBe('{"a":{"b":1}}');
    expect(extractJson('}{')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
});
