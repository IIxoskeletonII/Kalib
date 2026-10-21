import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLIP_CACHE,
  clipUrl,
  distinctMedia,
  offlineStatus,
  POSTER_CACHE,
  posterUrl,
  saveMediaOffline,
  warmExerciseMedia,
} from './exerciseMedia';

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

/**
 * Cache Storage as the browser keeps it: named caches of URL → response. `refuseOpen` stands
 * for a browser that will not hand out storage at all; `refusePut` for one that is out of quota.
 */
function fakeCaches(opts: { refuseOpen?: boolean; refusePut?: (url: string) => boolean } = {}) {
  const stores = new Map<string, Map<string, unknown>>();
  const open = vi.fn(async (name: string) => {
    if (opts.refuseOpen) throw new DOMException('No storage', 'SecurityError');
    let m = stores.get(name);
    if (!m) {
      m = new Map();
      stores.set(name, m);
    }
    const store = m;
    return {
      match: async (url: string) => store.get(url),
      put: async (url: string, r: unknown) => {
        if (opts.refusePut?.(url)) throw new DOMException('Full', 'QuotaExceededError');
        store.set(url, r);
      },
    } as unknown as Cache;
  });
  return { caches: { open } as Pick<CacheStorage, 'open'>, stores, open };
}

function recordingFetch(
  handler: (url: string) => { ok: boolean } | 'throw' = () => ({ ok: true }),
) {
  const seen: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const r = handler(url);
    if (r === 'throw') throw new TypeError('Failed to fetch');
    return { ok: r.ok, status: r.ok ? 200 : 404 } as Response;
  }) as unknown as typeof fetch;
  return { fetch: fn, seen };
}

describe('the cache names', () => {
  it('match the ones the service worker reads from', () => {
    // A rename on either side would have the button fill a cache nothing ever looks in, and
    // every check here would still pass. So the config itself is read.
    const config = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8');
    expect(config).toContain(`cacheName: '${POSTER_CACHE}'`);
    expect(config).toContain(`cacheName: '${CLIP_CACHE}'`);
  });
});

describe('distinctMedia', () => {
  it('drops gaps and repeats, keeping order', () => {
    expect(distinctMedia(['0002', undefined, '0001', '0002', ''])).toEqual(['0002', '0001']);
  });
});

describe('offlineStatus', () => {
  it('counts an exercise as saved only when both still and clip are there', async () => {
    const c = fakeCaches();
    const posters = await c.caches.open(POSTER_CACHE);
    const clips = await c.caches.open(CLIP_CACHE);
    await posters.put(posterUrl('0001'), new Response());
    await clips.put(clipUrl('0001'), new Response());
    await posters.put(posterUrl('0002'), new Response()); // still only, no clip
    const s = await offlineStatus(['0001', '0002', '0003'], { caches: c.caches });
    expect(s).toEqual({ total: 3, saved: 1 });
  });

  it('counts each demonstration once however often the routine repeats it', async () => {
    const s = await offlineStatus(['0001', '0001', undefined], { caches: fakeCaches().caches });
    expect(s).toEqual({ total: 1, saved: 0 });
  });

  it('has nothing to say where the browser keeps no caches', async () => {
    expect(await offlineStatus(['0001'], {})).toBeUndefined();
  });

  it('has nothing to say when storage is refused', async () => {
    const c = fakeCaches({ refuseOpen: true });
    expect(await offlineStatus(['0001'], { caches: c.caches })).toBeUndefined();
  });

  it('reports an empty routine as nothing to save, without opening a cache', async () => {
    const c = fakeCaches();
    expect(await offlineStatus([undefined], { caches: c.caches })).toEqual({ total: 0, saved: 0 });
    expect(c.open).not.toHaveBeenCalled();
  });
});

describe('saveMediaOffline', () => {
  it('stores every still and clip in the caches the worker reads', async () => {
    const c = fakeCaches();
    const f = recordingFetch();
    const out = await saveMediaOffline(['0001', '0002'], undefined, {
      caches: c.caches,
      fetch: f.fetch,
    });
    expect(out).toEqual({ total: 2, saved: 2, failed: 0 });
    expect([...c.stores.get(POSTER_CACHE)!.keys()].sort()).toEqual([
      posterUrl('0001'),
      posterUrl('0002'),
    ]);
    expect([...c.stores.get(CLIP_CACHE)!.keys()].sort()).toEqual([
      clipUrl('0001'),
      clipUrl('0002'),
    ]);
    // And the status agrees with what was just done.
    expect(await offlineStatus(['0001', '0002'], { caches: c.caches })).toEqual({
      total: 2,
      saved: 2,
    });
  });

  it('does not fetch what is already on the phone', async () => {
    const c = fakeCaches();
    await (await c.caches.open(CLIP_CACHE)).put(clipUrl('0001'), new Response());
    const f = recordingFetch();
    await saveMediaOffline(['0001'], undefined, { caches: c.caches, fetch: f.fetch });
    expect(f.seen).toEqual([posterUrl('0001')]);
  });

  it('a second press fetches nothing at all', async () => {
    const c = fakeCaches();
    const first = recordingFetch();
    await saveMediaOffline(['0001', '0002'], undefined, { caches: c.caches, fetch: first.fetch });
    const second = recordingFetch();
    const out = await saveMediaOffline(['0001', '0002'], undefined, {
      caches: c.caches,
      fetch: second.fetch,
    });
    expect(second.seen).toEqual([]);
    expect(out).toEqual({ total: 2, saved: 2, failed: 0 });
  });

  it('reports progress per exercise, from nothing to everything', async () => {
    const progress: [number, number][] = [];
    await saveMediaOffline(['0001', '0002', '0003'], (d, t) => progress.push([d, t]), {
      caches: fakeCaches().caches,
      fetch: recordingFetch().fetch,
    });
    expect(progress[0]).toEqual([0, 3]);
    expect(progress[progress.length - 1]).toEqual([3, 3]);
    expect(progress.map(([d]) => d)).toEqual([0, 1, 2, 3]);
  });

  it('says exactly how many failed when some are missing', async () => {
    const c = fakeCaches();
    const f = recordingFetch((url) => ({ ok: !url.includes('9999') }));
    const out = await saveMediaOffline(['0001', '9999', '0002'], undefined, {
      caches: c.caches,
      fetch: f.fetch,
    });
    expect(out).toEqual({ total: 3, saved: 2, failed: 1 });
    // A 404 is never stored: the worker would serve it back as if it were the clip.
    expect(c.stores.get(CLIP_CACHE)!.has(clipUrl('9999'))).toBe(false);
  });

  it('counts an exercise as failed when only its clip arrived', async () => {
    const f = recordingFetch((url) => ({ ok: !url.includes('posters') }));
    const out = await saveMediaOffline(['0001'], undefined, {
      caches: fakeCaches().caches,
      fetch: f.fetch,
    });
    expect(out).toEqual({ total: 1, saved: 0, failed: 1 });
  });

  it('survives having no signal at all', async () => {
    const out = await saveMediaOffline(['0001', '0002'], undefined, {
      caches: fakeCaches().caches,
      fetch: recordingFetch(() => 'throw').fetch,
    });
    expect(out).toEqual({ total: 2, saved: 0, failed: 2 });
  });

  it('survives a full disk part way through', async () => {
    const c = fakeCaches({ refusePut: (url) => url.includes('0002') });
    const out = await saveMediaOffline(['0001', '0002'], undefined, {
      caches: c.caches,
      fetch: recordingFetch().fetch,
    });
    expect(out).toEqual({ total: 2, saved: 1, failed: 1 });
  });

  it('reports everything failed when storage is refused outright', async () => {
    const progress: [number, number][] = [];
    const out = await saveMediaOffline(['0001', '0002'], (d, t) => progress.push([d, t]), {
      caches: fakeCaches({ refuseOpen: true }).caches,
      fetch: recordingFetch().fetch,
    });
    expect(out).toEqual({ total: 2, saved: 0, failed: 2 });
    expect(progress[progress.length - 1]).toEqual([2, 2]);
  });

  it('cannot do anything where the browser keeps no caches', async () => {
    expect(await saveMediaOffline(['0001'], undefined, { fetch: recordingFetch().fetch })).toBe(
      undefined,
    );
  });

  it('finishes at once for a routine with no demonstrations', async () => {
    const f = recordingFetch();
    const out = await saveMediaOffline([undefined, undefined], undefined, {
      caches: fakeCaches().caches,
      fetch: f.fetch,
    });
    expect(out).toEqual({ total: 0, saved: 0, failed: 0 });
    expect(f.seen).toEqual([]);
  });

  it('keeps at most four exercises in flight on a slow connection', async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    const ids = Array.from({ length: 12 }, (_, i) => String(i).padStart(4, '0'));
    const out = await saveMediaOffline(ids, undefined, {
      caches: fakeCaches().caches,
      fetch: slow,
    });
    expect(out?.saved).toBe(12);
    // Two files per exercise, four exercises at once.
    expect(peak).toBeLessThanOrEqual(8);
  });
});

describe('urls', () => {
  it('puts stills under their own path, so the worker can cache them separately', () => {
    expect(posterUrl('0001')).toBe('/exercises/posters/0001.webp');
    expect(clipUrl('0001')).toBe('/exercises/0001.webp');
  });
});
