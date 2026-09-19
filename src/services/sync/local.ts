// SyncLocal over the Dexie store. Lives beside the repos (it is the one place that walks
// every table), and stays out of UI code.
import { db } from '@/db/db';
import { getSetting, setSetting } from '@/db/repo/settings';
import { rowKey, type Row, type SyncLocal, type SyncTable } from './engine';

/** Settings that describe this device, never the account. */
const DEVICE_ONLY = /^(seed_version:|sync:)/;
/** Food rows that originate from the seed are never synced. */
const USER_FOOD_SOURCES = new Set(['custom', 'off', 'photo']);

function table(name: SyncTable) {
  switch (name) {
    case 'profiles':
      return db.profiles;
    case 'weigh_ins':
      return db.weigh_ins;
    case 'foods':
      return db.foods;
    case 'log_entries':
      return db.log_entries;
    case 'daily_targets':
      return db.daily_targets;
    case 'tdee_estimates':
      return db.tdee_estimates;
    case 'settings':
      return db.settings;
  }
}

function syncable(name: SyncTable, row: Row): boolean {
  if (name === 'foods') return USER_FOOD_SOURCES.has(String(row.source));
  if (name === 'settings') return !DEVICE_ONLY.test(String(row.key));
  return true;
}

export const dexieLocal: SyncLocal = {
  async changedSince(name, since) {
    const rows = (await table(name).toArray()) as unknown as Row[];
    return rows.filter((r) => syncable(name, r) && (since == null || r.updated_at > since));
  },
  async get(name, key) {
    const row = (await table(name).get(key)) as unknown as Row | undefined;
    return row;
  },
  async put(name, rows) {
    // Settings keep their local user id; every other table carries the sentinel already.
    await (table(name) as { bulkPut(rows: unknown[]): Promise<unknown> }).bulkPut(
      rows.map((r) => ({ ...r, ...(name === 'settings' ? { user_id: 'local' } : {}) })),
    );
    void rowKey;
  },
  async getCursor(cursor) {
    return (await getSetting<string>(cursor)) ?? null;
  },
  async setCursor(cursor, value) {
    await setSetting(cursor, value);
  },
};
