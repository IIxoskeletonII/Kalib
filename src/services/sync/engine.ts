// Sync engine: last-write-wins by `updated_at`, soft deletes travel as ordinary updates.
// Pure over two small interfaces so it is testable without Supabase or IndexedDB.
export type SyncTable =
  | 'profiles'
  | 'weigh_ins'
  | 'foods'
  | 'log_entries'
  | 'daily_targets'
  | 'tdee_estimates'
  | 'settings'
  | 'water_logs'
  | 'supplements'
  | 'supplement_logs'
  | 'recipes'
  | 'batches'
  | 'week_plans'
  | 'prices';

export const SYNC_TABLES: SyncTable[] = [
  'profiles',
  'foods',
  'weigh_ins',
  'log_entries',
  'daily_targets',
  'tdee_estimates',
  'settings',
  'water_logs',
  'supplements',
  'supplement_logs',
  'recipes',
  'batches',
  'week_plans',
  'prices',
];

export type Row = Record<string, unknown> & { updated_at: string; user_id: string };

/** Identity of a row: `id` everywhere except settings, which are keyed by `key`. */
export function rowKey(table: SyncTable, row: Row): string {
  return String(table === 'settings' ? row.key : row.id);
}

export interface SyncRemote {
  userId: string;
  /** Upsert by key. */
  push(table: SyncTable, rows: Row[]): Promise<void>;
  /** Rows with updated_at strictly after `since` (all rows when null), ascending by updated_at. */
  pull(table: SyncTable, since: string | null): Promise<Row[]>;
}

export interface SyncLocal {
  /** Local rows changed strictly after `since` (all when null). Only syncable rows. */
  changedSince(table: SyncTable, since: string | null): Promise<Row[]>;
  get(table: SyncTable, key: string): Promise<Row | undefined>;
  put(table: SyncTable, rows: Row[]): Promise<void>;
  getCursor(name: string): Promise<string | null>;
  setCursor(name: string, value: string): Promise<void>;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  skipped: number;
  tables: Partial<Record<SyncTable, { pushed: number; pulled: number }>>;
}

/** The local sentinel user; rows are stamped with the real user on the way up and back on the way down. */
export const LOCAL_USER = 'local';

export async function syncOnce(remote: SyncRemote, local: SyncLocal): Promise<SyncReport> {
  const report: SyncReport = { pushed: 0, pulled: 0, skipped: 0, tables: {} };
  // One table failing (typically a migration not yet run on the server) must not stop the
  // others from syncing; the first error is rethrown once every table has had its turn.
  const errors: Error[] = [];
  for (const table of SYNC_TABLES) {
    const t = { pushed: 0, pulled: 0 };
    report.tables[table] = t;
    try {
      await syncTable(table, remote, local, report, t);
    } catch (err) {
      errors.push(err as Error);
    }
  }
  if (errors.length > 0) throw errors[0];
  return report;
}

async function syncTable(
  table: SyncTable,
  remote: SyncRemote,
  local: SyncLocal,
  report: SyncReport,
  t: { pushed: number; pulled: number },
): Promise<void> {
  // Push: everything changed since the last push, stamped with the account's user id.
  const pushCursor = await local.getCursor(`sync:push:${table}`);
  const outgoing = await local.changedSince(table, pushCursor);
  if (outgoing.length > 0) {
    await remote.push(
      table,
      outgoing.map((r) => ({ ...r, user_id: remote.userId })),
    );
    t.pushed = outgoing.length;
    const max = outgoing.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), pushCursor ?? '');
    await local.setCursor(`sync:push:${table}`, max);
  }

  // Pull: remote changes since the last pull; a newer local copy wins.
  const pullCursor = await local.getCursor(`sync:pull:${table}`);
  const incoming = await remote.pull(table, pullCursor);
  const accepted: Row[] = [];
  for (const r of incoming) {
    const mine = await local.get(table, rowKey(table, r));
    if (mine && mine.updated_at >= r.updated_at) {
      report.skipped++;
      continue;
    }
    accepted.push({ ...r, user_id: LOCAL_USER });
  }
  if (accepted.length > 0) await local.put(table, accepted);
  t.pulled = accepted.length;
  if (incoming.length > 0) {
    const max = incoming.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), pullCursor ?? '');
    await local.setCursor(`sync:pull:${table}`, max);
    // Accepted rows will be pushed back once on the next run with identical content. That
    // is harmless (same updated_at, so no other device sees a change) and keeps the push
    // cursor honest: moving it past pulled rows could skip an unpushed local edit.
  }
  report.pushed += t.pushed;
  report.pulled += t.pulled;
}
