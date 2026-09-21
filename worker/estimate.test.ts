import { describe, expect, it } from 'vitest';
import { extractJson, runEstimate } from './estimate';

const okFetch = (content: string): typeof fetch =>
  (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
    })) as unknown as typeof fetch;

describe('/api/estimate', () => {
  it('refuses without a key, and without any input', async () => {
    const r = await runEstimate({ description: 'eggs' }, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
    const r2 = await runEstimate({}, { OPENROUTER_API_KEY: 'k' }, okFetch('{}'));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.status).toBe(400);
  });

  it('sends the description as primary evidence and parses the JSON back', async () => {
    let sent: { model: string; messages: { role: string; content: unknown }[] } | undefined;
    const spy: typeof fetch = (async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '```json\n{"items":[]}\n```' } }] }),
      );
    }) as unknown as typeof fetch;
    const r = await runEstimate(
      { description: '2 eggs and toast' },
      { OPENROUTER_API_KEY: 'k', VISION_MODEL: 'test/model' },
      spy,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.model).toBe('test/model');
      expect(r.result).toEqual({ items: [] });
    }
    expect(sent!.model).toBe('test/model');
    const user = sent!.messages[1]!.content as { type: string; text?: string }[];
    expect(user[0]!.text).toContain('2 eggs and toast');
    expect(user).toHaveLength(1); // no image part
  });

  it('rejects a non-JPEG or oversized image', async () => {
    const r = await runEstimate(
      { image: 'data:image/png;base64,AAAA' },
      { OPENROUTER_API_KEY: 'k' },
      okFetch('{}'),
    );
    expect(r.ok).toBe(false);
  });

  it('reports upstream failures plainly', async () => {
    const bad: typeof fetch = (async () =>
      new Response('nope', { status: 429 })) as unknown as typeof fetch;
    const r = await runEstimate({ description: 'x' }, { OPENROUTER_API_KEY: 'k' }, bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/429/);
  });

  it('extracts the outermost JSON object from prose', () => {
    expect(extractJson('Sure: {"a":{"b":1}} done')).toBe('{"a":{"b":1}}');
    expect(extractJson('no json')).toBeNull();
  });
});
