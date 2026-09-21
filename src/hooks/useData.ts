// Reactive reads. useLiveQuery re-runs whenever the underlying Dexie tables change, so every
// write through a repo function updates every screen with no manual invalidation.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { addDays, todayKey } from '@/core/dates';
import type { Batch, Food, Recipe } from '@/core/types';
import { rankFavourites } from '@/core/favourites';
import { getDailyTarget } from '@/db/repo/dailyTargets';
import { getFood, getFoods, listSearchDocs, listUserFoods } from '@/db/repo/foods';
import {
  firstActivityDate,
  foodUsageCounts,
  listEntriesForDate,
  listEntriesSince,
} from '@/db/repo/logEntries';
import { getCurrentProfile } from '@/db/repo/profiles';
import { getRecipe, listActiveBatches, listBatchesForRecipe, listRecipes } from '@/db/repo/recipes';
import { getSetting } from '@/db/repo/settings';
import {
  listSupplementLogsForDate,
  listSupplementLogsSince,
  listSupplements,
} from '@/db/repo/supplements';
import { listWaterForDate } from '@/db/repo/water';
import { listWeighIns } from '@/db/repo/weighIns';
import { personFor } from '@/services/supplements';
import { computeWeekBanking } from '@/services/banking';
import { computeCoach, weekOverview, type CoachState, type WeekOverview } from '@/services/coach';
import { ensureTargetForDate, weightFor } from '@/services/targets';
import { pingIfEnabled } from '@/services/reminders';
import { tdeeState, type TdeeState } from '@/services/tdee';

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
  const takes = useLiveQuery(() => listSupplementLogsSince(addDays(date, -6)), [date]);
  const [state, setState] = useState<CoachState | undefined>(undefined);
  const stamp =
    entries && takes ? [...entries, ...takes].map((e) => e.updated_at).join('|') : undefined;
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

/** §5 banking for the week containing `date`; recomputed live as entries and targets change. */
export function useBanking(date: string) {
  return useLiveQuery(() => computeWeekBanking(date), [date]);
}

/** §17.1 the day's water logs, oldest first. */
export function useWaterLogs(date: string) {
  return useLiveQuery(() => listWaterForDate(date), [date]);
}

/** §17.2 active supplements in list order. */
export function useSupplements() {
  return useLiveQuery(listSupplements, []);
}

/** Supplement ids taken on `date` (any live take counts). */
export function useTakenSupplements(date: string): ReadonlySet<string> | undefined {
  const logs = useLiveQuery(() => listSupplementLogsForDate(date), [date]);
  return useMemo(() => (logs ? new Set(logs.map((l) => l.supplement_id)) : undefined), [logs]);
}

/** §17.3 who doses are personalised for: the profile plus the latest weight. */
export function usePerson() {
  const profile = useProfile();
  const weighIns = useWeighIns();
  return useMemo(
    () => (profile ? personFor(profile, weightFor(weighIns ?? [], todayKey())) : undefined),
    [profile, weighIns],
  );
}

/** §8.2 recipes, newest first. */
export function useRecipes() {
  return useLiveQuery(listRecipes, []);
}

/** undefined = loading; null = no such recipe. */
export function useRecipe(id: string | undefined) {
  return useLiveQuery(async () => (id ? ((await getRecipe(id)) ?? null) : null), [id]);
}

/** The foods behind a recipe's ingredients, keyed by id. */
export function useRecipeFoods(items: readonly { food_id: string }[] | undefined) {
  const key = items?.map((i) => i.food_id).join('|') ?? '';
  return useLiveQuery(() => (key ? getFoods(key.split('|')) : Promise.resolve(new Map())), [key]);
}

/** Batches with portions left, with their recipe and food, most recently cooked first. */
export function useActiveBatches() {
  return useLiveQuery(async () => {
    const batches = await listActiveBatches();
    const out: { batch: Batch; recipe: Recipe; food: Food }[] = [];
    for (const batch of batches) {
      const recipe = await getRecipe(batch.recipe_id);
      const food = recipe ? await getFood(recipe.food_id) : undefined;
      if (recipe && food) out.push({ batch, recipe, food });
    }
    return out;
  }, []);
}

export function useBatchesForRecipe(recipe_id: string | undefined) {
  return useLiveQuery(
    () => (recipe_id ? listBatchesForRecipe(recipe_id) : Promise.resolve([])),
    [recipe_id],
  );
}

/** undefined = loading; null = missing. */
export function useFood(id: string | undefined) {
  return useLiveQuery(async () => (id ? ((await getFood(id)) ?? null) : null), [id]);
}

/**
 * §4 engine state for today: recomputes the estimate and runs the weekly publish whenever
 * the log or the weigh-ins change. undefined while the first computation runs.
 */
export function useTdee(): TdeeState | undefined {
  const today = todayKey();
  const profile = useProfile();
  const weighIns = useWeighIns();
  const entries = useLiveQuery(() => listEntriesSince(addDays(today, -45)), [today]);
  const [state, setState] = useState<TdeeState | undefined>(undefined);
  const stamp =
    weighIns && entries ? [...weighIns, ...entries].map((r) => r.updated_at).join('|') : undefined;
  useEffect(() => {
    if (!profile || stamp === undefined) return;
    let cancelled = false;
    void tdeeState(today).then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [today, profile, stamp]);
  return state;
}

/** v2 week in review for the 7 days ending on `date`; live with the log, takes and weigh-ins. */
export function useWeekOverview(date: string): WeekOverview | undefined {
  const profile = useProfile();
  const weighIns = useWeighIns();
  const entries = useLiveQuery(() => listEntriesSince(addDays(date, -6)), [date]);
  const takes = useLiveQuery(() => listSupplementLogsSince(addDays(date, -6)), [date]);
  const [state, setState] = useState<WeekOverview | undefined>(undefined);
  const stamp =
    entries && takes && weighIns
      ? [...entries, ...takes, ...weighIns].map((e) => e.updated_at).join('|')
      : undefined;
  useEffect(() => {
    if (!profile || stamp === undefined) return;
    let cancelled = false;
    void weekOverview(date, profile.sex).then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [date, profile, stamp]);
  return state;
}

/** Keeps the reminder service informed of what has been logged and weighed today. */
export function useReminderPing() {
  const today = todayKey();
  const entries = useEntries(today);
  const weighIns = useWeighIns();
  const logged = entries && entries.length > 0 ? today : undefined;
  const weighed = weighIns?.some((w) => w.date === today) ? today : undefined;
  useEffect(() => {
    if (entries === undefined || weighIns === undefined) return;
    void pingIfEnabled({ lastLoggedDate: logged, lastWeighedDate: weighed });
  }, [entries, weighIns, logged, weighed]);
}
