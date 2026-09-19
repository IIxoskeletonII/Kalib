import Dexie from 'dexie';
import type { SyncMeta } from '@/core/types';
import { KalibDB, LOCAL_USER_ID } from './schema';

export const db = new KalibDB();
export { LOCAL_USER_ID };

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Fresh sync metadata for a new row. */
export function newMeta(id: string = newId()): SyncMeta {
  const ts = nowIso();
  return { id, user_id: LOCAL_USER_ID, created_at: ts, updated_at: ts };
}

export function isLive<T extends { deleted_at?: string | null }>(row: T): boolean {
  return row.deleted_at == null;
}

/** Fires after any write to any table (Dexie's global mutation event). Returns an unsubscribe. */
export function onStorageMutated(cb: () => void): () => void {
  const handler = () => cb();
  Dexie.on('storagemutated', handler);
  return () => Dexie.on('storagemutated').unsubscribe(handler);
}
