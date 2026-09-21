import type { WaterLog } from '@/core/types';
import { db, isLive, LOCAL_USER_ID, newMeta, nowIso } from '../db';

export async function addWater(date: string, ml: number): Promise<WaterLog> {
  const row: WaterLog = { ...newMeta(), date, logged_at: nowIso(), ml };
  await db.water_logs.add(row);
  return row;
}

/** Live logs for the day, oldest first. */
export async function listWaterForDate(date: string): Promise<WaterLog[]> {
  const rows = await db.water_logs.where('[user_id+date]').equals([LOCAL_USER_ID, date]).toArray();
  return rows.filter(isLive).sort((a, b) => (a.logged_at < b.logged_at ? -1 : 1));
}

export async function deleteWater(id: string): Promise<void> {
  const ts = nowIso();
  await db.water_logs.update(id, { deleted_at: ts, updated_at: ts });
}

export async function listAllWater(): Promise<WaterLog[]> {
  return db.water_logs.toArray();
}

export async function bulkPutWater(rows: readonly WaterLog[]): Promise<void> {
  await db.water_logs.bulkPut([...rows]);
}

export async function restoreWater(id: string): Promise<void> {
  const ts = nowIso();
  await db.water_logs.update(id, { deleted_at: null, updated_at: ts });
}
