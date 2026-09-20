import { describe, expect, it } from 'vitest';
import {
  LOCAL_USER,
  syncOnce,
  type Row,
  type SyncLocal,
  type SyncRemote,
  type SyncTable,
} from './engine';

class MemoryRemote implements SyncRemote {
  userId = 'uuid-1';
  data = new Map<SyncTable, Map<string, Row>>();
  pushes = 0;
  private key(t: SyncTable, r: Row) {
    return String(t === 'settings' ? r.key : r.id);
  }
  async push(table: SyncTable, rows: Row[]) {
    this.pushes += rows.length;
    const m = this.data.get(table) ?? new Map();
    for (const r of rows) m.set(this.key(table, r), r);
    this.data.set(table, m);
  }
  async pull(table: SyncTable, since: string | null) {
    return [...(this.data.get(table)?.values() ?? [])]
      .filter((r) => since == null || r.updated_at > since)
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1));
  }
}

class MemoryLocal implements SyncLocal {
  data = new Map<SyncTable, Map<string, Row>>();
  cursors = new Map<string, string>();
  private key(t: SyncTable, r: Row) {
    return String(t === 'settings' ? r.key : r.id);
  }
  seed(table: SyncTable, rows: Row[]) {
    const m = this.data.get(table) ?? new Map();
    for (const r of rows) m.set(this.key(table, r), r);
    this.data.set(table, m);
  }
  async changedSince(table: SyncTable, since: string | null) {
    return [...(this.data.get(table)?.values() ?? [])].filter(
      (r) => since == null || r.updated_at > since,
    );
  }
  async get(table: SyncTable, key: string) {
    return this.data.get(table)?.get(key);
  }
  async put(table: SyncTable, rows: Row[]) {
    this.seed(table, rows);
  }
  async getCursor(name: string) {
    return this.cursors.get(name) ?? null;
  }
  async setCursor(name: string, value: string) {
    this.cursors.set(name, value);
  }
}

const row = (id: string, updated_at: string, extra: Record<string, unknown> = {}): Row => ({
  id,
  user_id: LOCAL_USER,
  updated_at,
  ...extra,
});

describe('syncOnce', () => {
  it('pushes local rows stamped with the account user, then pulls nothing new', async () => {
    const remote = new MemoryRemote();
    const local = new MemoryLocal();
    local.seed('weigh_ins', [row('w1', '2026-09-20T08:00:00.000Z', { weight_kg: 110 })]);
    const r = await syncOnce(remote, local);
    expect(r.pushed).toBe(1);
    expect(r.pulled).toBe(0);
    expect(remote.data.get('weigh_ins')?.get('w1')?.user_id).toBe('uuid-1');
    expect(await local.getCursor('sync:push:weigh_ins')).toBe('2026-09-20T08:00:00.000Z');
  });

  it('pulls remote rows into the local sentinel user and keeps a newer local copy', async () => {
    const remote = new MemoryRemote();
    const local = new MemoryLocal();
    await remote.push('log_entries', [
      { ...row('e1', '2026-09-20T09:00:00.000Z', { name: 'remote' }), user_id: 'uuid-1' },
      { ...row('e2', '2026-09-20T09:30:00.000Z', { name: 'remote-newer' }), user_id: 'uuid-1' },
    ]);
    local.seed('log_entries', [row('e1', '2026-09-20T10:00:00.000Z', { name: 'local-newer' })]);
    const r = await syncOnce(remote, local);
    expect(r.skipped).toBe(1);
    expect(r.pulled).toBe(1);
    expect((await local.get('log_entries', 'e1'))?.name).toBe('local-newer');
    expect(await local.get('log_entries', 'e2')).toMatchObject({
      name: 'remote-newer',
      user_id: 'local',
    });
  });

  it('is incremental: a second run moves nothing new except the one-time echo', async () => {
    const remote = new MemoryRemote();
    const local = new MemoryLocal();
    local.seed('foods', [row('f1', '2026-09-20T08:00:00.000Z')]);
    await remote.push('foods', [{ ...row('f2', '2026-09-20T07:00:00.000Z'), user_id: 'uuid-1' }]);
    await syncOnce(remote, local);
    const second = await syncOnce(remote, local);
    expect(second.pulled).toBe(0);
    // f2 was pulled (updated 07:00) but the push cursor sits at 08:00, so nothing echoes here.
    expect(second.pushed).toBe(0);
  });

  it('never lets a pulled row hide an unpushed local edit', async () => {
    const remote = new MemoryRemote();
    const local = new MemoryLocal();
    // Local edit at 08:00 not yet pushed; remote has a row at 09:00.
    await remote.push('weigh_ins', [
      { ...row('w9', '2026-09-20T09:00:00.000Z'), user_id: 'uuid-1' },
    ]);
    await syncOnce(remote, local); // pulls w9, pushes nothing
    local.seed('weigh_ins', [row('w1', '2026-09-20T08:30:00.000Z', { weight_kg: 109 })]);
    // w1 is older than the pulled row but newer than the push cursor (which is still null).
    const r = await syncOnce(remote, local);
    expect(remote.data.get('weigh_ins')?.has('w1')).toBe(true);
    expect(r.pushed).toBeGreaterThanOrEqual(1);
  });

  it('keys settings by key', async () => {
    const remote = new MemoryRemote();
    const local = new MemoryLocal();
    local.seed('settings', [
      { key: 'theme', value: 'dark', user_id: LOCAL_USER, updated_at: '2026-09-20T08:00:00.000Z' },
    ]);
    await syncOnce(remote, local);
    expect(remote.data.get('settings')?.get('theme')?.value).toBe('dark');
  });
});

describe('a failing table', () => {
  it('does not stop the others, and the error surfaces afterwards', async () => {
    const local = new MemoryLocal();
    local.seed('weigh_ins', [row('w1', '2026-09-01T00:00:00Z')]);
    local.seed('water_logs', [row('h1', '2026-09-01T00:00:00Z')]);
    const pushed: string[] = [];
    const remote: SyncRemote = {
      userId: 'u1',
      async push(table, rows) {
        if (table === 'weigh_ins') throw new Error('relation "weigh_ins" does not exist');
        pushed.push(...rows.map((r) => `${table}:${String(r.id)}`));
      },
      async pull() {
        return [];
      },
    };
    await expect(syncOnce(remote, local)).rejects.toThrow('weigh_ins');
    expect(pushed).toEqual(['water_logs:h1']);
  });
});
