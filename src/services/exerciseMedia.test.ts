import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipUrl, posterUrl, warmExerciseMedia } from './exerciseMedia';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** A fetch that records what it was asked for. */
function stubFetch(handler: (url: string) => { ok: boolean } | 'throw') {
  const seen: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const r = handler(url);
    if (r === 'throw') throw new Error('offline');
    return { ok: r.ok, blob: async () => new Blob(['x']) } as unknown as Response;
  }) as typeof fetch;
  return seen;
}

describe('warmExerciseMedia', () => {
  it('fetches the still and the clip for every exercise, once each', async () => {
    const seen = stubFetch(() => ({ ok: true }));
    const out = await warmExerciseMedia(['0001', '0002', '0001']);
    expect(out).toEqual({ cached: 4, missed: 0 });
    expect(seen.sort()).toEqual(
      [clipUrl('0001'), clipUrl('0002'), posterUrl('0001'), posterUrl('0002')].sort(),
    );
  });

  it('skips exercises with no demonstration', async () => {
    const seen = stubFetch(() => ({ ok: true }));
    const out = await warmExerciseMedia([undefined, '0003', undefined]);
    expect(seen).toHaveLength(2);
    expect(out.cached).toBe(2);
  });

  it('does nothing at all when there is nothing to fetch', async () => {
    const seen = stubFetch(() => ({ ok: true }));
    expect(await warmExerciseMedia([])).toEqual({ cached: 0, missed: 0 });
    expect(seen).toEqual([]);
  });

  it('reads the body, because an unread one is not reliably cached', async () => {
    const blob = vi.fn(async () => new Blob(['x']));
    globalThis.fetch = vi.fn(
      async () => ({ ok: true, blob }) as unknown as Response,
    ) as typeof fetch;
    await warmExerciseMedia(['0001']);
    expect(blob).toHaveBeenCalledTimes(2);
  });

  it('survives being offline, because saving a routine must not depend on a network', async () => {
    stubFetch(() => 'throw');
    const out = await warmExerciseMedia(['0001', '0002']);
    expect(out).toEqual({ cached: 0, missed: 4 });
  });

  it('counts a missing file as missed rather than failing the lot', async () => {
    stubFetch((url) => ({ ok: !url.includes('9999') }));
    const out = await warmExerciseMedia(['0001', '9999']);
    expect(out.cached).toBe(2);
    expect(out.missed).toBe(2);
  });
});

describe('urls', () => {
  it('puts stills under their own path, so the worker can cache them separately', () => {
    expect(posterUrl('0001')).toBe('/exercises/posters/0001.webp');
    expect(clipUrl('0001')).toBe('/exercises/0001.webp');
  });
});
