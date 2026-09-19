// SPEC §8 — home screen surfaces the top 8 foods by frequency × recency. Derived from the
// log, no separate table: each use contributes exp(-days_ago / halfLife).
import { diffDays, toDateKey } from './dates';

export interface FavouriteInput {
  food_id?: string | undefined;
  name: string;
  grams: number;
  kcal: number;
  date: string;
  logged_at: string;
}

export interface Favourite {
  food_id: string;
  name: string;
  score: number;
  count: number;
  last_grams: number;
  last_kcal: number;
  last_logged_at: string;
}

export const FAVOURITE_LIMIT = 8;
export const FAVOURITE_DECAY_DAYS = 14;

export function rankFavourites(
  entries: readonly FavouriteInput[],
  now: Date = new Date(),
  limit: number = FAVOURITE_LIMIT,
  decayDays: number = FAVOURITE_DECAY_DAYS,
): Favourite[] {
  const today = toDateKey(now);
  const acc = new Map<string, Favourite>();
  for (const e of entries) {
    if (!e.food_id) continue;
    const daysAgo = Math.max(0, diffDays(e.date, today));
    const w = Math.exp(-daysAgo / decayDays);
    const cur = acc.get(e.food_id);
    if (!cur) {
      acc.set(e.food_id, {
        food_id: e.food_id,
        name: e.name,
        score: w,
        count: 1,
        last_grams: e.grams,
        last_kcal: e.kcal,
        last_logged_at: e.logged_at,
      });
    } else {
      cur.score += w;
      cur.count += 1;
      if (e.logged_at > cur.last_logged_at) {
        cur.last_logged_at = e.logged_at;
        cur.last_grams = e.grams;
        cur.last_kcal = e.kcal;
        cur.name = e.name;
      }
    }
  }
  return [...acc.values()]
    .sort((a, b) => b.score - a.score || (b.last_logged_at < a.last_logged_at ? -1 : 1))
    .slice(0, limit);
}
