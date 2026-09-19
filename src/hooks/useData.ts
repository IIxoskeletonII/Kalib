// Reactive reads. useLiveQuery re-runs whenever the underlying Dexie tables change, so every
// write through a repo function updates every screen with no manual invalidation.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { addDays, todayKey } from '@/core/dates';
import { rankFavourites } from '@/core/favourites';
import { getDailyTarget } from '@/db/repo/dailyTargets';
import { listSearchDocs, listUserFoods } from '@/db/repo/foods';
import {
  firstActivityDate,
  foodUsageCounts,
  listEntriesForDate,
  listEntriesSince,
} from '@/db/repo/logEntries';
import { getCurrentProfile } from '@/db/repo/profiles';
import { getSetting } from '@/db/repo/settings';
import { listWeighIns } from '@/db/repo/weighIns';
import { computeCoach, type CoachState } from '@/services/coach';
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

/** Custom foods and cached packaged products, newest first. */
export function useUserFoods() {
  return useLiveQuery(
    async () =>
      (await listUserFoods())
        .filter((f) => f.deleted_at == null)
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [],
  );
}

/** Days in [from, to] that have at least one live entry. */
export function useLoggedDates(from: string, to: string): ReadonlySet<string> | undefined {
  const entries = useLiveQuery(() => listEntriesSince(from), [from]);
  return useMemo(() => {
    if (!entries) return undefined;
    const s = new Set<string>();
    for (const e of entries) if (e.date <= to) s.add(e.date);
    return s;
  }, [entries, to]);
}

export function useSetting<T>(key: string, fallback: T): T {
  const v = useLiveQuery(() => getSetting<T>(key), [key]);
  return v === undefined ? fallback : v;
}

export function useFirstActivityDate() {
  return useLiveQuery(async () => (await firstActivityDate()) ?? null, []);
}

/** §16 coach for the trailing week ending on `date`. Recomputed when the log or targets change. */
export function useCoach(date: string): CoachState | undefined {
  const profile = useProfile();
  const entries = useLiveQuery(() => listEntriesSince(addDays(date, -6)), [date]);
  const [state, setState] = useState<CoachState | undefined>(undefined);
  const stamp = entries?.map((e) => e.updated_at).join('|');
  useEffect(() => {
    if (!profile || stamp === undefined) return;
    let cancelled = false;
    void computeCoach(date, profile.sex).then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [date, profile, stamp]);
  return state;
}
