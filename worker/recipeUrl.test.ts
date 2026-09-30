import { describe, expect, it, vi } from 'vitest';
import {
  checkUrl,
  fetchPage,
  isoDurationToMinutes,
  jsonLdNodes,
  parseJsonLdRecipe,
  runRecipeUrl,
  visibleText,
} from './recipeUrl';

const RECIPE_LD = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Lentil ragu',
  description: 'A thick lentil ragu for pasta.',
  recipeIngredient: ['250 g red lentils', '2 tbsp olive oil', '1 tin chopped tomatoes'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Soften the onion in the oil.' },
    { '@type': 'HowToStep', text: 'Add the lentils and tomatoes; simmer 30 minutes.' },
  ],
  recipeYield: '4 servings',
  totalTime: 'PT45M',
};

const page = (ld: unknown, extra = '') =>
  `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>${extra}</body></html>`;

describe('checkUrl — the server-side request forgery guard', () => {
  it('accepts an ordinary recipe link', () => {
    expect(checkUrl('https://www.bbcgoodfood.com/recipes/lentil-ragu')).toEqual({ ok: true });
    expect(checkUrl('http://example.com/r/1').ok).toBe(true);
  });

  it('refuses anything that is not http', () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com/x', 'data:text/html,hi']) {
      expect(checkUrl(u).ok).toBe(false);
    }
  });

  it('refuses raw IP addresses in every spelling', () => {
    for (const u of [
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/',
      'http://[::1]/',
      'http://2130706433/',
      'http://0x7f000001/',
    ]) {
      expect(checkUrl(u).ok, u).toBe(false);
    }
  });

  it('refuses internal names', () => {
    for (const u of [
      'http://localhost/',
      'http://kalib.localhost/',
      'http://router.lan/',
      'http://metadata.google.internal/',
      'http://db.internal/',
      'http://intranet/',
    ]) {
      expect(checkUrl(u).ok, u).toBe(false);
    }
  });

  it('refuses unusual ports, where internal services live', () => {
    expect(checkUrl('http://example.com:8080/').ok).toBe(false);
    expect(checkUrl('http://example.com:6379/').ok).toBe(false);
    expect(checkUrl('https://example.com:443/').ok).toBe(true);
  });

  it('gives a reason rather than a bare refusal', () => {
    expect(checkUrl('not a url').reason).toBeTruthy();
    expect(checkUrl('http://127.0.0.1/').reason).toBeTruthy();
  });
});

describe('fetchPage', () => {
  it('sends no cookies or caller headers, and identifies itself', async () => {
    const seen: RequestInit[] = [];
    const impl = (async (_u: string, init: RequestInit) => {
      seen.push(init);
      return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
    await fetchPage('https://example.com/r', impl);
    const headers = seen[0]!.headers as Record<string, string>;
    expect(headers['user-agent']).toContain('Kalib');
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('cookie');
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
    expect(seen[0]!.redirect).toBe('manual');
  });

  it('re-checks every redirect hop instead of following it blindly', async () => {
    const impl = (async (u: string) =>
      u === 'https://example.com/r'
        ? new Response('', { status: 302, headers: { location: 'http://169.254.169.254/' } })
        : new Response('<html></html>')) as unknown as typeof fetch;
    const out = await fetchPage('https://example.com/r', impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(400);
  });

  it('follows an ordinary redirect', async () => {
    const impl = (async (u: string) =>
      u === 'https://example.com/r'
        ? new Response('', { status: 301, headers: { location: 'https://example.com/final' } })
        : new Response('<html>ok</html>', {
            headers: { 'content-type': 'text/html' },
          })) as unknown as typeof fetch;
    const out = await fetchPage('https://example.com/r', impl);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.url).toBe('https://example.com/final');
  });

  it('refuses a redirect loop', async () => {
    const impl = (async () =>
      new Response('', {
        status: 302,
        headers: { location: 'https://example.com/again' },
      })) as unknown as typeof fetch;
    const out = await fetchPage('https://example.com/r', impl);
    expect(out.ok).toBe(false);
  });

  it('refuses a response that is not a web page', async () => {
    const impl = (async () =>
      new Response('%PDF-1.4', {
        headers: { 'content-type': 'application/pdf' },
      })) as unknown as typeof fetch;
    const out = await fetchPage('https://example.com/r.pdf', impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(415);
  });

  it('refuses a page far larger than any recipe', async () => {
    const impl = (async () =>
      new Response('x'.repeat(2_000_000), {
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch;
    const out = await fetchPage('https://example.com/huge', impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(413);
  });
});

describe('isoDurationToMinutes', () => {
  it('reads the durations recipe sites publish', () => {
    expect(isoDurationToMinutes('PT45M')).toBe(45);
    expect(isoDurationToMinutes('PT1H20M')).toBe(80);
    expect(isoDurationToMinutes('PT2H')).toBe(120);
    expect(isoDurationToMinutes('P1DT2H')).toBe(1560);
    expect(isoDurationToMinutes('nonsense')).toBe(0);
    expect(isoDurationToMinutes(undefined)).toBe(0);
  });
});

describe('parseJsonLdRecipe', () => {
  it('reads the structured data a publisher already provides', () => {
    const r = parseJsonLdRecipe(page(RECIPE_LD), 'https://example.com/r')!;
    expect(r.name).toBe('Lentil ragu');
    expect(r.ingredients).toHaveLength(3);
    expect(r.ingredients[0]).toBe('250 g red lentils');
    expect(r.steps).toEqual([
      'Soften the onion in the oil.',
      'Add the lentils and tomatoes; simmer 30 minutes.',
    ]);
    expect(r.servings).toBe(4);
    expect(r.time_min).toBe(45);
    expect(r.source).toBe('https://example.com/r');
  });

  it('digs the recipe out of an @graph wrapper', () => {
    const wrapped = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'WebSite' }, RECIPE_LD],
    };
    expect(parseJsonLdRecipe(page(wrapped), 'u')!.name).toBe('Lentil ragu');
  });

  it('handles a @type given as an array', () => {
    const multi = { ...RECIPE_LD, '@type': ['Recipe', 'NewsArticle'] };
    expect(parseJsonLdRecipe(page(multi), 'u')).toBeDefined();
  });

  it('flattens HowToSection groupings into one list of steps', () => {
    const sectioned = {
      ...RECIPE_LD,
      recipeInstructions: [
        { '@type': 'HowToSection', name: 'Sauce', itemListElement: [{ text: 'Chop.' }] },
        { '@type': 'HowToSection', name: 'Finish', itemListElement: [{ text: 'Simmer.' }] },
      ],
    };
    expect(parseJsonLdRecipe(page(sectioned), 'u')!.steps).toEqual(['Chop.', 'Simmer.']);
  });

  it('accepts plain-string instructions', () => {
    const plain = { ...RECIPE_LD, recipeInstructions: 'Mix and bake.' };
    expect(parseJsonLdRecipe(page(plain), 'u')!.steps).toEqual(['Mix and bake.']);
  });

  it('says nothing when the page has no recipe, or one with no ingredients', () => {
    expect(parseJsonLdRecipe('<html></html>', 'u')).toBeUndefined();
    expect(parseJsonLdRecipe(page({ '@type': 'Article', name: 'Hi' }), 'u')).toBeUndefined();
    expect(parseJsonLdRecipe(page({ ...RECIPE_LD, recipeIngredient: [] }), 'u')).toBeUndefined();
  });

  it('survives malformed JSON-LD without throwing', () => {
    const broken = '<script type="application/ld+json">{ not json </script>';
    expect(() => jsonLdNodes(broken)).not.toThrow();
    expect(parseJsonLdRecipe(broken, 'u')).toBeUndefined();
  });

  it('caps a runaway ingredient list', () => {
    const many = { ...RECIPE_LD, recipeIngredient: Array.from({ length: 200 }, (_, i) => `x${i}`) };
    expect(parseJsonLdRecipe(page(many), 'u')!.ingredients.length).toBeLessThanOrEqual(40);
  });
});

describe('visibleText', () => {
  it('drops scripts, styles and tags', () => {
    const html = '<html><script>var a=1</script><style>p{}</style><p>Mix &amp; bake</p></html>';
    expect(visibleText(html)).toBe('Mix & bake');
  });

  it('truncates rather than sending a whole site to a model', () => {
    expect(visibleText(`<p>${'a'.repeat(50000)}</p>`, 100)).toHaveLength(100);
  });
});

describe('runRecipeUrl', () => {
  it('uses the structured data and never calls the model', async () => {
    const impl = vi.fn(
      async () => new Response(page(RECIPE_LD), { headers: { 'content-type': 'text/html' } }),
    ) as unknown as typeof fetch;
    const out = await runRecipeUrl('https://example.com/r', {}, impl);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.via).toBe('json-ld');
      expect(out.recipe.name).toBe('Lentil ragu');
    }
    // One call: the page. No OpenRouter key is even configured here.
    expect((impl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it('says so plainly when a page holds no recipe and there is no model to ask', async () => {
    const impl = (async () =>
      new Response('<html><body>A blog about nothing</body></html>', {
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch;
    const out = await runRecipeUrl('https://example.com/r', {}, impl);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(422);
      expect(out.error).toContain('by hand');
    }
  });

  it('falls back to the model when the page has no structured data', async () => {
    const impl = (async (u: string) => {
      if (u.includes('openrouter')) {
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: 'Blog ragu',
                  blurb: 'From prose.',
                  ingredients: ['200 g lentils'],
                  steps: ['Simmer.'],
                  servings: 2,
                  time_min: 30,
                }),
              },
            },
          ],
        });
      }
      return new Response('<html><body>A recipe in prose</body></html>', {
        headers: { 'content-type': 'text/html' },
      });
    }) as unknown as typeof fetch;
    const out = await runRecipeUrl('https://example.com/r', { OPENROUTER_API_KEY: 'k' }, impl);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.via).toBe('model');
      expect(out.recipe.name).toBe('Blog ragu');
      expect(out.recipe.source).toBe('https://example.com/r');
    }
  });

  it('refuses an unsafe link before fetching anything', async () => {
    const impl = vi.fn(async () => new Response('')) as unknown as typeof fetch;
    const out = await runRecipeUrl('http://169.254.169.254/latest/', {}, impl);
    expect(out.ok).toBe(false);
    expect((impl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });
});
