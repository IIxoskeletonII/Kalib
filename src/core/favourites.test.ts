import { describe, expect, it } from 'vitest';
import { rankFavourites, type FavouriteInput } from './favourites';

const now = new Date(2026, 9, 10, 12); // 10 Oct 2026, local

function e(food_id: string | undefined, date: string, grams: number, hour = 8): FavouriteInput {
  return {
    food_id,
    name: food_id ? `Food ${food_id}` : 'Manual',
    grams,
    kcal: grams * 2,
    date,
    logged_at: `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`,
  };
}

describe('rankFavourites (§8)', () => {
  it('weights recent uses more than old ones', () => {
    const favs = rankFavourites(
      [e('old', '2026-09-01', 100), e('old', '2026-09-02', 100), e('new', '2026-10-09', 100)],
      now,
    );
    expect(favs.map((f) => f.food_id)).toEqual(['new', 'old']);
  });

  it('frequency can outrank recency', () => {
    const entries = [e('new', '2026-10-09', 100)];
    for (let d = 1; d <= 5; d++) entries.push(e('freq', `2026-10-0${d}`, 100));
    expect(rankFavourites(entries, now)[0]!.food_id).toBe('freq');
  });

  it('carries the most recent grams and name', () => {
    const favs = rankFavourites(
      [e('a', '2026-10-01', 100, 8), e('a', '2026-10-09', 150, 8), e('a', '2026-10-09', 120, 7)],
      now,
    );
    expect(favs[0]!.last_grams).toBe(150);
    expect(favs[0]!.last_kcal).toBe(300);
    expect(favs[0]!.count).toBe(3);
  });

  it('ignores entries without a food_id', () => {
    expect(rankFavourites([e(undefined, '2026-10-09', 100)], now)).toEqual([]);
  });

  it('respects the limit', () => {
    const entries: FavouriteInput[] = [];
    for (let i = 0; i < 12; i++) entries.push(e(`f${i}`, '2026-10-09', 100));
    expect(rankFavourites(entries, now)).toHaveLength(8);
    expect(rankFavourites(entries, now, 3)).toHaveLength(3);
  });

  it('treats future-dated entries as today rather than boosting them', () => {
    const favs = rankFavourites([e('a', '2026-10-20', 100), e('b', '2026-10-10', 100)], now);
    expect(favs[0]!.score).toBeCloseTo(favs[1]!.score, 9);
  });
});
