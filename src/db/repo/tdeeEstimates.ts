import Dexie from 'dexie';
import type { SyncMeta, TdeeEstimate } from '@/core/types';
import { db, isLive, LOCAL_USER_ID, newMeta, nowIso } from '../db';

export type TdeeEstimateInput = Omit<TdeeEstimate, keyof SyncMeta>;

/** One row per computed_on; recomputing the same day overwrites it. */
export async function upsertTdeeEstimate(input: TdeeEstimateInput): Promise<TdeeEstimate> {
  return db.transaction('rw', db.tdee_estimates, async () => {
    const existing = await db.tdee_estimates
      .where('[user_id+computed_on]')
      .equals([LOCAL_USER_ID, input.computed_on])
      .first();
    if (existing) {
      const patch = { ...input, updated_at: nowIso(), deleted_at: null };
      await db.tdee_estimates.update(existing.id, patch);
      return { ...existing, ...patch };
    }
    const row: TdeeEstimate = { ...newMeta(), ...input };
    await db.tdee_estimates.add(row);
    return row;
  });
}

/** Live estimates, ascending by computed_on. */
export async function listTdeeEstimates(): Promise<TdeeEstimate[]> {
  const rows = await db.tdee_estimates
    .where('[user_id+computed_on]')
    .between([LOCAL_USER_ID, Dexie.minKey], [LOCAL_USER_ID, Dexie.maxKey])
    .toArray();
  return rows.filter(isLive);
}

export async function latestTdeeEstimate(): Promise<TdeeEstimate | undefined> {
  const rows = await listTdeeEstimates();
  return rows[rows.length - 1];
}
