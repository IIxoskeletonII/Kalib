// SPEC §20.2 — making a routine's demonstrations available without a signal.
//
// The clips are not precached: 1,394 of them is 67 MB, and nobody should pay for a library
// they will use forty of. The service worker keeps whatever has been fetched, so an exercise
// you have opened is already offline.
//
// That leaves one gap, and it is the one that matters in a basement gym or on a trip: a routine
// you built at home and have never opened exercise-by-exercise. So saving a routine warms its
// own clips. It is a few hundred kilobytes for a workout, fetched once, on whatever connection
// you had when you were sitting down to plan.
//
// Failure is not an error here. Building a routine offline simply means the clips arrive the
// first time you open them, which is the behaviour that existed before this.

/** Enough to be quick on a decent connection, few enough not to monopolise a bad one. */
const CONCURRENCY = 4;

export function clipUrl(media: string): string {
  return `/exercises/${media}.webp`;
}

export function posterUrl(media: string): string {
  return `/exercises/posters/${media}.webp`;
}

/**
 * Pull every demonstration a routine needs into the cache.
 *
 * Resolves with how many arrived. The caller does not wait for it: a routine is saved whether
 * or not its pictures are, and blocking the screen on a download would be the wrong trade.
 */
export async function warmExerciseMedia(
  media: readonly (string | undefined)[],
): Promise<{ cached: number; missed: number }> {
  if (typeof fetch !== 'function') return { cached: 0, missed: 0 };

  const urls = [...new Set(media.filter((m): m is string => !!m))].flatMap((m) => [
    posterUrl(m),
    clipUrl(m),
  ]);

  let cached = 0;
  let missed = 0;
  let next = 0;

  async function worker(): Promise<void> {
    for (let i = next++; i < urls.length; i = next++) {
      const url = urls[i];
      if (!url) continue;
      try {
        // The response body has to be read, not merely requested: a CacheFirst worker stores
        // what it has finished reading, and an unread body can be dropped on the floor.
        const r = await fetch(url);
        if (r.ok) {
          await r.blob();
          cached++;
        } else {
          missed++;
        }
      } catch {
        missed++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return { cached, missed };
}

// ---- Saving a routine for offline, on purpose (§20.14) ----
//
// Warming on save is best effort and silent, and it only works once the service worker is
// controlling the page — the first visit after an install, or a browser that has evicted the
// worker, fetches straight past it and keeps nothing. Before a trip that is not good enough:
// you want to *know* the demonstrations are on the phone. So this path writes into the very
// caches the service worker reads from, checks what is already there, and reports exactly what
// it could not get.

/** Must match the `cacheName`s in vite.config.ts; exerciseMedia.test.ts reads that file to check. */
export const POSTER_CACHE = 'kalib-exercise-posters';
export const CLIP_CACHE = 'kalib-exercise-media';

export interface OfflineMediaEnv {
  caches?: Pick<CacheStorage, 'open'>;
  fetch?: typeof fetch;
}

function mediaEnv(): OfflineMediaEnv {
  const env: OfflineMediaEnv = {};
  if (typeof caches !== 'undefined') env.caches = caches;
  if (typeof fetch === 'function') env.fetch = (...a) => fetch(...a);
  return env;
}

/** The distinct demonstrations a list of exercises has, in order, without the gaps. */
export function distinctMedia(media: readonly (string | undefined)[]): string[] {
  return [...new Set(media.filter((m): m is string => !!m))];
}

export interface OfflineStatus {
  /** Exercises with a demonstration to save. */
  total: number;
  /** Of those, how many have both their still and their clip on the phone. */
  saved: number;
}

/**
 * How much of a routine would work without a signal, or undefined where the browser keeps no
 * caches a page can see (an insecure origin, some private modes) — there is then nothing honest
 * to say and nothing the button could do.
 */
export async function offlineStatus(
  media: readonly (string | undefined)[],
  env: OfflineMediaEnv = mediaEnv(),
): Promise<OfflineStatus | undefined> {
  if (!env.caches) return undefined;
  const ids = distinctMedia(media);
  if (ids.length === 0) return { total: 0, saved: 0 };
  try {
    const [posters, clips] = await Promise.all([
      env.caches.open(POSTER_CACHE),
      env.caches.open(CLIP_CACHE),
    ]);
    let saved = 0;
    for (const id of ids) {
      const [p, c] = await Promise.all([posters.match(posterUrl(id)), clips.match(clipUrl(id))]);
      if (p && c) saved++;
    }
    return { total: ids.length, saved };
  } catch {
    return undefined;
  }
}

export interface OfflineResult extends OfflineStatus {
  /** Exercises whose still or clip could not be fetched or stored. */
  failed: number;
}

/**
 * Fetches and stores every demonstration a routine needs that is not already on the phone.
 * Progress is reported per exercise, since that is the unit a person counts in.
 */
export async function saveMediaOffline(
  media: readonly (string | undefined)[],
  onProgress?: (done: number, total: number) => void,
  env: OfflineMediaEnv = mediaEnv(),
): Promise<OfflineResult | undefined> {
  const { caches: store, fetch: get } = env;
  if (!store || !get) return undefined;
  const ids = distinctMedia(media);
  const total = ids.length;
  if (total === 0) return { total: 0, saved: 0, failed: 0 };

  let posters: Cache;
  let clips: Cache;
  try {
    [posters, clips] = await Promise.all([store.open(POSTER_CACHE), store.open(CLIP_CACHE)]);
  } catch {
    // Storage refused outright: quota, or a browser clearing site data. Nothing can be saved.
    onProgress?.(total, total);
    return { total, saved: 0, failed: total };
  }

  const keep = async (cache: Cache, url: string): Promise<boolean> => {
    try {
      if (await cache.match(url)) return true;
      const r = await get(url);
      if (!r.ok) return false;
      // The worker may already have stored this very response on its way past (CacheFirst
      // keeps what it fetches); writing it again is harmless and covers the case where it
      // was not in control of the page.
      await cache.put(url, r);
      return true;
    } catch {
      return false;
    }
  };

  let saved = 0;
  let failed = 0;
  let done = 0;
  let next = 0;
  onProgress?.(0, total);

  async function worker(): Promise<void> {
    for (let i = next++; i < ids.length; i = next++) {
      const id = ids[i]!;
      const [p, c] = await Promise.all([keep(posters, posterUrl(id)), keep(clips, clipUrl(id))]);
      if (p && c) saved++;
      else failed++;
      done++;
      onProgress?.(done, total);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
  return { total, saved, failed };
}
