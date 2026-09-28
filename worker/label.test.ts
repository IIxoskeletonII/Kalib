import { describe, expect, it } from 'vitest';
import { runLabel } from './label';

const env = { OPENROUTER_API_KEY: 'k', VISION_MODEL: 'test/vision' };
const jpeg = `data:image/jpeg;base64,${'A'.repeat(200)}`;

describe('runLabel', () => {
  it('asks for strict JSON with the image at full detail, and returns what came back', async () => {
    let sent: {
      model: string;
      temperature: number;
      messages: { role: string; content: unknown }[];
      response_format: { type: string; json_schema: { strict: boolean } };
    } = {} as never;
    const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"name":"Penne","kcal":359,"basis":"per_100g"}' } }],
        }),
      );
    }) as typeof fetch;

    const r = await runLabel({ image: jpeg }, env, fetchImpl);
    expect(r).toEqual({
      ok: true,
      result: { name: 'Penne', kcal: 359, basis: 'per_100g' },
      model: 'test/vision',
    });
    expect(sent.response_format.json_schema.strict).toBe(true);
    // A label is printed, not guessed: nothing creative wanted here.
    expect(sent.temperature).toBe(0);
    const content = sent.messages[1]!.content as { type: string; image_url?: { detail: string } }[];
    expect(content[1]!.image_url!.detail).toBe('high');
    // The prompt has to survive a label in any language and either column.
    const system = String(sent.messages[0]!.content);
    expect(system).toMatch(/any language/i);
    expect(system).toMatch(/per_100g/);
    expect(system).toMatch(/kJ/);
  });

  it('refuses anything that is not a downscaled JPEG, and fails closed without a key', async () => {
    const never = (async () => {
      throw new Error('should not be called');
    }) as typeof fetch;
    expect(await runLabel({}, env, never)).toMatchObject({ ok: false, status: 400 });
    expect(await runLabel({ image: 'data:image/png;base64,AAAA' }, env, never)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      await runLabel({ image: `data:image/jpeg;base64,${'A'.repeat(3_000_000)}` }, env, never),
    ).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await runLabel({ image: jpeg }, {}, never)).toMatchObject({ ok: false, status: 503 });
  });

  it('reports an upstream failure without leaking the key', async () => {
    const bad = (async () => new Response('nope', { status: 429 })) as typeof fetch;
    const r = await runLabel({ image: jpeg }, env, bad);
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(JSON.stringify(r)).not.toContain('Bearer');
  });
});
