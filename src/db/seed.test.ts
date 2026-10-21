import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { ensureSeeded, isSeeded, SEED_FILES } from './seed';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(source: string): Response {
  return new Response(JSON.stringify({ format: 1, source, foods: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const html = () =>
  new Response('<!doctype html><title>Kalib</title>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

/** Every required file answers properly; the optional one answers with `optional`. */
function serve(optional: () => Response, required: (source: string) => Response = json) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const file = SEED_FILES.find((f) => input.startsWith(f.url))!;
      return file.optional ? optional() : required(file.source);
    }),
  );
}

describe('ensureSeeded', () => {
  it('seeds every file when all are present', async () => {
    serve(() => json('chain'));
    await ensureSeeded();
    for (const f of SEED_FILES) expect(await isSeeded(f.source)).toBe(true);
  });

  it('treats a 404 for the optional chain file as absent', async () => {
    serve(() => new Response('', { status: 404 }));
    await ensureSeeded();
    expect(await isSeeded('chain')).toBe(true);
  });

  it('treats an SPA fallback page for the optional chain file as absent', async () => {
    serve(html);
    await expect(ensureSeeded()).resolves.toBeUndefined();
    expect(await isSeeded('chain')).toBe(true);
  });

  it('still fails when a required file comes back as a page', async () => {
    serve(
      () => json('chain'),
      () => html(),
    );
    await expect(ensureSeeded()).rejects.toThrow(/came back as text\/html/);
  });

  it('still fails when the optional file errors for another reason', async () => {
    serve(() => new Response('', { status: 500 }));
    await expect(ensureSeeded()).rejects.toThrow(/\(500\)/);
    expect(await isSeeded('chain')).toBe(false);
  });
});
