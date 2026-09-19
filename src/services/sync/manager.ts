// Runs the sync at the right moments: sign-in, app foreground, reconnect, and shortly after
// local writes. One run at a time; a run requested during a run queues one more.
import type { Session } from '@supabase/supabase-js';
import { onStorageMutated } from '@/db/db';
import { getSetting, setSetting } from '@/db/repo/settings';
import { syncOnce, type SyncReport } from './engine';
import { dexieLocal } from './local';
import { syncConfigured } from './config';

export type SyncStatus =
  | { state: 'off' }
  | { state: 'idle'; lastAt: string | null }
  | { state: 'syncing'; lastAt: string | null }
  | { state: 'error'; lastAt: string | null; message: string }
  /** Signed in as someone other than the account whose data is on this phone. */
  | { state: 'mismatch'; ownerEmail: string | null };

type Listener = (s: SyncStatus, session: Session | null, recovery: boolean) => void;

const LAST_AT = 'sync:last_at';
/** The account this phone's data belongs to, set on the first successful sync. */
const OWNER = 'sync:user_id';
const listeners = new Set<Listener>();
let session: Session | null = null;
let status: SyncStatus = { state: 'off' };
/** True after arriving through a password-reset link, until a new password is saved. */
let recovery = false;
let running = false;
let queued = false;
let started = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

function emit() {
  for (const l of listeners) l(status, session, recovery);
}

export function clearRecovery(): void {
  recovery = false;
  emit();
}

async function setStatus(s: SyncStatus) {
  status = s;
  emit();
}

export async function syncNow(): Promise<SyncReport | null> {
  if (!session || !navigator.onLine) return null;
  if (running) {
    queued = true;
    return null;
  }
  // Never merge two people's data: a phone syncs with exactly one account until it is reset.
  const owner = await getSetting<{ id: string; email: string | null }>(OWNER);
  if (owner && owner.id !== session.user.id) {
    await setStatus({ state: 'mismatch', ownerEmail: owner.email });
    return null;
  }
  running = true;
  const lastAt = (await getSetting<string>(LAST_AT)) ?? null;
  await setStatus({ state: 'syncing', lastAt });
  try {
    const { supabaseRemote } = await import('./supabase');
    const report = await syncOnce(supabaseRemote(session.user.id), dexieLocal);
    const now = new Date().toISOString();
    if (!owner) await setSetting(OWNER, { id: session.user.id, email: session.user.email ?? null });
    await setSetting(LAST_AT, now);
    await setStatus({ state: 'idle', lastAt: now });
    return report;
  } catch (err) {
    await setStatus({ state: 'error', lastAt, message: (err as Error).message });
    return null;
  } finally {
    running = false;
    if (queued) {
      queued = false;
      void syncNow();
    }
  }
}

function scheduleSoon() {
  // Writes made by the sync itself (pulled rows, cursors) must not schedule another sync.
  if (!session || running) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), 4000);
}

/** Idempotent; called once from the app shell. */
export async function startSync(): Promise<void> {
  if (started || !syncConfigured) return;
  started = true;
  // supabase-js is ~40 KB gzipped; it loads after first paint, only when sync is configured.
  const { getSession, supabase } = await import('./supabase');
  session = await getSession();
  status = session
    ? { state: 'idle', lastAt: (await getSetting<string>(LAST_AT)) ?? null }
    : { state: 'off' };
  emit();

  supabase().auth.onAuthStateChange((event, next) => {
    const signedIn = !session && next;
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    session = next;
    if (!next) status = { state: 'off' };
    emit();
    if (signedIn) void syncNow();
  });

  if (session) void syncNow();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  window.addEventListener('online', () => void syncNow());
  onStorageMutated(scheduleSoon);
}

/** Wipes everything on this phone (after sign-out) so another person can sign in. */
export async function resetThisPhone(): Promise<void> {
  const { db } = await import('@/db/db');
  await db.delete();
  window.location.replace('/');
}

export function subscribeSync(l: Listener): () => void {
  listeners.add(l);
  l(status, session, recovery);
  return () => listeners.delete(l);
}
