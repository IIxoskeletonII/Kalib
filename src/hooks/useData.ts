// Reactive reads. useLiveQuery re-runs whenever the underlying Dexie tables change, so every
// write through a repo function updates every screen with no manual invalidation.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo } from 'react';
import { addDays, todayKey } from '@/core/dates';
import { rankFavourites } from '@/core/favourites';
import { getDailyTarget } from '@/db/repo/dailyTargets';
import { listSearchDocs } from '@/db/repo/foods';
import {
  firstActivityDate,
  foodUsageCounts,
  listEntriesForDate,
  listEntriesSince,
} from '@/db/repo/logEntries';
import { getCurrentProfile } from '@/db/repo/profiles';
import { getSetting } from '@/db/repo/settings';
import { listWeighIns } from '@/db/repo/weighIns';
import { ensureTargetForDate } from '@/services/targets';

/** undefined = still loading; null = onboarded state unknown → no profile. */
export function useProfile() {
  return useLiveQuery(async () => (await getCurrentProfile()) ?? null, []);
}

export function useEntries(date: string) {
  return useLiveQuery(() => listEntriesForDate(date), [date]);
}

export function useWeighIns() {
  return useLiveQuery(listWeighIns, []);
}

/** Stored target for the day, created on first view of that day. */
export function useDailyTarget(date: string) {
  const target = useLiveQuery(async () => (await getDailyTarget(date)) ?? null, [date]);
  const profile = useProfile();
  const weighIns = useWeighIns();
  useEffect(() => {
    if (target === null && profile && weighIns && weighIns.length > 0) {
      void ensureTargetForDate(date);
    }
  }, [target, profile, weighIns, date]);
  return target;
}

export function useSearchDocs() {
  return useLiveQuery(listSearchDocs, []);
}

export function useFoodUsage() {
  return useLiveQuery(foodUsageCounts, []);
}

export function useFavourites(limit = 8) {
  const since = addDays(todayKey(), -60);
  const entries = useLiveQuery(() => listEntriesSince(since), [since]);
  return useMemo(
    () => (entries ? rankFavourites(entries, new Date(), limit) : undefined),
    [entries, limit],
  );
}

export function useSetting<T>(key: string, fallback: T): T {
  const v = useLiveQuery(() => getSetting<T>(key), [key]);
  return v === undefined ? fallback : v;
}

export function useFirstActivityDate() {
  return useLiveQuery(async () => (await firstActivityDate()) ?? null, []);
}
