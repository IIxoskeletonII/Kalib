import Dexie from 'dexie';
import type { Supplement, SupplementLog, SyncMeta } from '@/core/types';
import { db, isLive, LOCAL_USER_ID, newMeta, nowIso } from '../db';

export type SupplementInput = Omit<Supplement, keyof SyncMeta | 'sort_order' | 'active'>;

/** Active supplements in list order. */
export async function listSupplements(): Promise<Supplement[]> {
  const rows = await db.supplements
    .where('[user_id+sort_order]')
    .between([LOCAL_USER_ID, Dexie.minKey], [LOCAL_USER_ID, Dexie.maxKey])
    .toArray();
  return rows.filter((r) => isLive(r) && r.active);
}

export async function getSupplement(id: string): Promise<Supplement | undefined> {
  const row = await db.supplements.get(id);
  return row && isLive(row) ? row : undefined;
}

export async function addSupplement(input: SupplementInput): Promise<Supplement> {
  const existing = await listSupplements();
  const sort_order = existing.length ? Math.max(...existing.map((s) => s.sort_order)) + 1 : 0;
  const row: Supplement = { ...newMeta(), ...input, sort_order, active: true };
  await db.supplements.add(row);
  return row;
}

export async function updateSupplement(id: string, patch: Partial<SupplementInput>): Promise<void> {
  await db.supplements.update(id, { ...patch, updated_at: nowIso() });
}

export async function deleteSupplement(id: string): Promise<void> {
  const ts = nowIso();
  await db.supplements.update(id, { deleted_at: ts, updated_at: ts });
}

/** Live takes for the day. */
export async function listSupplementLogsForDate(date: string): Promise<SupplementLog[]> {
  const rows = await db.supplement_logs
    .where('[user_id+date]')
    .equals([LOCAL_USER_ID, date])
    .toArray();
  return rows.filter(isLive);
}

export async function listSupplementLogsSince(from: string): Promise<SupplementLog[]> {
  const rows = await db.supplement_logs.where('date').aboveOrEqual(from).toArray();
  return rows.filter((r) => r.user_id === LOCAL_USER_ID && isLive(r));
}

export async function addSupplementLog(
  s: Pick<Supplement, 'id' | 'dose' | 'unit'>,
  date: string,
): Promise<SupplementLog> {
  const row: SupplementLog = {
    ...newMeta(),
    supplement_id: s.id,
    date,
    taken_at: nowIso(),
    dose: s.dose,
    unit: s.unit,
  };
  await db.supplement_logs.add(row);
  return row;
}

/** Untake: soft-delete the day's latest take of that supplement. */
export async function removeSupplementLog(supplement_id: string, date: string): Promise<void> {
  const rows = (
    await db.supplement_logs.where('[supplement_id+date]').equals([supplement_id, date]).toArray()
  ).filter(isLive);
  const last = rows.sort((a, b) => (a.taken_at < b.taken_at ? -1 : 1)).at(-1);
  if (!last) return;
  const ts = nowIso();
  await db.supplement_logs.update(last.id, { deleted_at: ts, updated_at: ts });
}

export async function listAllSupplements(): Promise<Supplement[]> {
  return db.supplements.toArray();
}

export async function listAllSupplementLogs(): Promise<SupplementLog[]> {
  return db.supplement_logs.toArray();
}

export async function bulkPutSupplements(rows: readonly Supplement[]): Promise<void> {
  await db.supplements.bulkPut([...rows]);
}

export async function bulkPutSupplementLogs(rows: readonly SupplementLog[]): Promise<void> {
  await db.supplement_logs.bulkPut([...rows]);
}
