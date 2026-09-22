import { describe, expect, it } from 'vitest';
import { runSuggest, userPrompt, SUGGEST_TAGS } from './suggest';

const env = { OPENROUTER_API_KEY: 'k', TEXT_MODEL: 'test/model' };

describe('userPrompt', () => {
  it('turns the request into instructions, clamping what the client sends', () => {
    const p = userPrompt({
      count: 40,
      budget: 60,
      currency: '€',
      tags: ['high-protein', 'nonsense', 'quick'],
      avoid: ' no pork ',
      kcal_per_portion: 700,
      protein_per_portion: 45,
      exclude: ['Chicken & rice', ''],
      locale: 'it-IT',
    });
    expect(p).toContain('Give me 8 dinner recipes');
    expect(p).toContain('about 700 kcal and 45 g protein');
    expect(p).toContain(SUGGEST_TAGS['high-protein']);
    expect(p).toContain(SUGGEST_TAGS.quick);
    expect(p).not.toContain('nonsense');
    expect(p).toContain('€60');
    expect(p).toContain('IT supermarkets');
    expect(p).toContain('Avoid: no pork.');
    expect(p).toContain('Do not suggest these again: Chicken & rice.');
  });

  it('offers this week’s titles as themes when the server has them', () => {
    const p = userPrompt({}, { trends: [{ title: 'Miso Butter Salmon', source: 'Blog' }] });
    expect(p).toContain('this week, for themes only');
    expect(p).toContain('- Miso Butter Salmon (Blog)');
    expect(userPrompt({}, { trends: [] })).not.toContain('themes only');
  });

  it('has sensible defaults when nothing is given', () => {
    const p = userPrompt({});
    expect(p).toContain('Give me 4 dinner recipes');
    expect(p).toContain('No budget was given');
    expect(p).toContain('No particular preferences');
  });
});

describe('runSuggest', () => {
  it('posts a strict JSON schema request and returns the parsed object', async () => {
    let sent: { model: string; response_format: { type: string } } | undefined;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Here: {"recipes":[{"name":"Dal"}]}' } }],
        }),
      );
    }) as typeof fetch;
    const r = await runSuggest({ count: 1 }, env, fetchImpl);
    expect(r).toEqual({ ok: true, result: { recipes: [{ name: 'Dal' }] }, model: 'test/model' });
    expect(sent?.model).toBe('test/model');
    expect(sent?.response_format.type).toBe('json_schema');
  });

  it('fails closed without a key and reports upstream errors without leaking the key', async () => {
    expect(await runSuggest({}, {})).toMatchObject({ ok: false, status: 503 });
    const bad = (async () => new Response('nope', { status: 429 })) as typeof fetch;
    const r = await runSuggest({}, env, bad);
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(JSON.stringify(r)).not.toContain('Bearer');
  });
});
