import Dexie from 'dexie';
import type { LogEntry, SyncMeta } from '@/core/types';
import { db, isLive, LOCAL_USER_ID, newMeta, nowIso } from '../db';

export type LogEntryInput = Omit<LogEntry, keyof SyncMeta>;

export async function addEntry(input: LogEntryInput): Promise<LogEntry> {
  const row: LogEntry = { ...newMeta(), ...input };
  await db.log_entries.add(row);
  return row;
}

export async function getEntry(id: string): Promise<LogEntry | undefined> {
  const row = await db.log_entries.get(id);
  return row && isLive(row) ? row : undefined;
}

export async function updateEntry(
  id: string,
  patch: Partial<Omit<LogEntry, keyof SyncMeta>>,
): Promise<void> {
  await db.log_entries.update(id, { ...patch, updated_at: nowIso() });
}

export async function deleteEntry(id: string): Promise<void> {
  await db.log_entries.update(id, { deleted_at: nowIso(), updated_at: nowIso() });
}

/** Live entries for one local day, in logging order. */
export async function listEntriesForDate(date: string): Promise<LogEntry[]> {
  const rows = await db.log_entries.where('[user_id+date]').equals([LOCAL_USER_ID, date]).toArray();
  return rows.filter(isLive).sort((a, b) => (a.logged_at < b.logged_at ? -1 : 1));
}

/** Live entries from `fromDate` (inclusive) onward. */
export async function listEntriesSince(fromDate: string): Promise<LogEntry[]> {
  const rows = await db.log_entries
    .where('[user_id+date]')
    .between([LOCAL_USER_ID, fromDate], [LOCAL_USER_ID, Dexie.maxKey])
    .toArray();
  return rows.filter(isLive);
}

export async function listAllEntries(): Promise<LogEntry[]> {
  const rows = await db.log_entries
    .where('[user_id+date]')
    .between([LOCAL_USER_ID, Dexie.minKey], [LOCAL_USER_ID, Dexie.maxKey])
    .toArray();
  return rows.filter(isLive);
}

/** Earliest live date across log entries and weigh-ins — the start of the calibration clock. */
export async function firstActivityDate(): Promise<string | undefined> {
  const [entry, weigh] = await Promise.all([
    db.log_entries
      .where('[user_id+date]')
      .between([LOCAL_USER_ID, Dexie.minKey], [LOCAL_USER_ID, Dexie.maxKey])
      .filter(isLive)
      .first(),
    db.weigh_ins
      .where('[user_id+date]')
      .between([LOCAL_USER_ID, Dexie.minKey], [LOCAL_USER_ID, Dexie.maxKey])
      .filter(isLive)
      .first(),
  ]);
  const dates = [entry?.date, weigh?.date].filter((d): d is string => !!d).sort();
  return dates[0];
}

/** How many grams the user logged last time for this food (prefill for the number pad). */
export async function lastGramsForFood(food_id: string): Promise<number | undefined> {
  const rows = await db.log_entries.where('food_id').equals(food_id).filter(isLive).toArray();
  if (rows.length === 0) return undefined;
  rows.sort((a, b) => (a.logged_at < b.logged_at ? 1 : -1));
  return rows[0]!.grams;
}

/** Count of live entries per food_id — the usage signal for search ranking. */
export async function foodUsageCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await db.log_entries.each((e) => {
    if (e.food_id && isLive(e)) counts.set(e.food_id, (counts.get(e.food_id) ?? 0) + 1);
  });
  return counts;
}

export async function bulkPutEntries(rows: readonly LogEntry[]): Promise<void> {
  await db.log_entries.bulkPut([...rows]);
}

/** Undo of a soft delete. */
export async function restoreEntry(id: string): Promise<void> {
  await db.log_entries.update(id, { deleted_at: null, updated_at: nowIso() });
}
