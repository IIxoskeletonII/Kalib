import Dexie from 'dexie';
import type { DailyTarget, SyncMeta } from '@/core/types';
import { db, isLive, LOCAL_USER_ID, newMeta, nowIso } from '../db';

export type DailyTargetInput = Omit<DailyTarget, keyof SyncMeta | 'date'>;

export async function getDailyTarget(date: string): Promise<DailyTarget | undefined> {
  const row = await db.daily_targets.where('[user_id+date]').equals([LOCAL_USER_ID, date]).first();
  return row && isLive(row) ? row : undefined;
}

/**
 * Returns the stored target for `date`, computing and persisting one if absent. Targets are
 * written once per day so the history stays stable when the profile changes later.
 */
export async function ensureDailyTarget(
  date: string,
  compute: () => Promise<DailyTargetInput> | DailyTargetInput,
): Promise<DailyTarget> {
  const existing = await getDailyTarget(date);
  if (existing) return existing;
  const values = await compute();
  return upsertDailyTarget(date, values);
}

/** Overwrite the target for `date` (profile edited today, or the v2 engine publishing). */
export async function upsertDailyTarget(
  date: string,
  values: DailyTargetInput,
): Promise<DailyTarget> {
  return db.transaction('rw', db.daily_targets, async () => {
    const existing = await db.daily_targets
      .where('[user_id+date]')
      .equals([LOCAL_USER_ID, date])
      .first();
    if (existing) {
      const patch = { ...values, updated_at: nowIso(), deleted_at: null };
      await db.daily_targets.update(existing.id, patch);
      return { ...existing, ...patch } as DailyTarget;
    }
    const row: DailyTarget = { ...newMeta(), date, ...values };
    await db.daily_targets.add(row);
    return row;
  });
}

export async function listDailyTargets(): Promise<DailyTarget[]> {
  const rows = await db.daily_targets
    .where('[user_id+date]')
    .between([LOCAL_USER_ID, Dexie.minKey], [LOCAL_USER_ID, Dexie.maxKey])
    .toArray();
  return rows.filter(isLive);
}
