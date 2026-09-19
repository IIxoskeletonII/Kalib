import Dexie from 'dexie';
import type { WeighIn, WeighInSource } from '@/core/types';
import { db, isLive, LOCAL_USER_ID, newMeta, nowIso } from '../db';

/** One weigh-in per day (SPEC §6 UNIQUE(user_id, date)); a second save replaces the first. */
export async function upsertWeighIn(
  date: string,
  weight_kg: number,
  opts: { bodyfat_pct?: number | undefined; source?: WeighInSource } = {},
): Promise<WeighIn> {
  return db.transaction('rw', db.weigh_ins, async () => {
    const existing = await db.weigh_ins
      .where('[user_id+date]')
      .equals([LOCAL_USER_ID, date])
      .first();
    const source = opts.source ?? 'manual';
    if (existing) {
      const patch: Partial<WeighIn> = { weight_kg, source, updated_at: nowIso() };
      if (opts.bodyfat_pct != null) patch.bodyfat_pct = opts.bodyfat_pct;
      await db.weigh_ins.update(existing.id, { ...patch, deleted_at: null });
      return { ...existing, ...patch, deleted_at: null } as WeighIn;
    }
    const row: WeighIn = { ...newMeta(), date, weight_kg, source };
    if (opts.bodyfat_pct != null) row.bodyfat_pct = opts.bodyfat_pct;
    await db.weigh_ins.add(row);
    return row;
  });
}

export async function getWeighIn(date: string): Promise<WeighIn | undefined> {
  const row = await db.weigh_ins.where('[user_id+date]').equals([LOCAL_USER_ID, date]).first();
  return row && isLive(row) ? row : undefined;
}

/** All live weigh-ins, ascending by date. */
export async function listWeighIns(): Promise<WeighIn[]> {
  const rows = await db.weigh_ins
    .where('[user_id+date]')
    .between([LOCAL_USER_ID, Dexie.minKey], [LOCAL_USER_ID, Dexie.maxKey])
    .toArray();
  return rows.filter(isLive);
}

export async function latestWeighIn(): Promise<WeighIn | undefined> {
  const rows = await listWeighIns();
  return rows[rows.length - 1];
}

export async function deleteWeighIn(date: string): Promise<void> {
  const row = await db.weigh_ins.where('[user_id+date]').equals([LOCAL_USER_ID, date]).first();
  if (row) await db.weigh_ins.update(row.id, { deleted_at: nowIso(), updated_at: nowIso() });
}
