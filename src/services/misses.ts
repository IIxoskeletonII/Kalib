// Searches that found nothing, kept so the food database grows from real use (SPEC §7.3)
// instead of guesses. A setting, so it syncs like everything else and shows in Settings.
import { getSetting, setSetting } from '@/db/repo/settings';
import { todayKey } from '@/core/dates';

export const MISSES_KEY = 'search:misses';
const MAX = 60;

export interface SearchMiss {
  q: string;
  /** Local day of the most recent miss. */
  date: string;
  count: number;
}

export async function listMisses(): Promise<SearchMiss[]> {
  return (await getSetting<SearchMiss[]>(MISSES_KEY)) ?? [];
}

/** Remembers `q` (most recent first, de-duplicated, capped). Short or empty queries are noise. */
export async function recordMiss(q: string): Promise<void> {
  const term = q.trim().toLowerCase().replace(/\s+/g, ' ');
  if (term.length < 3 || term.length > 60) return;
  const misses = await listMisses();
  const existing = misses.find((m) => m.q === term);
  const next: SearchMiss[] = [
    { q: term, date: todayKey(), count: (existing?.count ?? 0) + 1 },
    ...misses.filter((m) => m.q !== term),
  ].slice(0, MAX);
  await setSetting(MISSES_KEY, next);
}

export async function forgetMiss(q: string): Promise<void> {
  await setSetting(
    MISSES_KEY,
    (await listMisses()).filter((m) => m.q !== q),
  );
}

export async function clearMisses(): Promise<void> {
  await setSetting(MISSES_KEY, []);
}
