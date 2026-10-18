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
