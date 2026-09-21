// Platform adapter for reminders (Web Push). On iOS this only works from the Home Screen app
// (16.4+); the browser tab has no push. Under Capacitor: the Push Notifications plugin.

export interface ReminderPrefs {
  weighAt: string | null;
  logAt: string | null;
}

export type PushSupport = 'ready' | 'needs-install' | 'unsupported';

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    // iOS Safari tab: PushManager is absent until the app is installed.
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
    return ios ? 'needs-install' : 'unsupported';
  }
  return 'ready';
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function toKey(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

export async function serverConfig(): Promise<{ enabled: boolean; publicKey: string | null }> {
  const res = await fetch('/api/push/config');
  if (!res.ok) return { enabled: false, publicKey: null };
  return (await res.json()) as { enabled: boolean; publicKey: string | null };
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ready') return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export interface SubscribeState {
  lastLoggedDate?: string | undefined;
  lastWeighedDate?: string | undefined;
}

/** Asks permission (must come from a tap), subscribes, and registers with the Worker. */
export async function enableReminders(
  prefs: ReminderPrefs,
  state: SubscribeState,
): Promise<'ok' | 'denied' | 'unavailable'> {
  const cfg = await serverConfig();
  if (!cfg.enabled || !cfg.publicKey) return 'unavailable';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toKey(cfg.publicKey) as BufferSource,
    }));
  await registerSubscription(sub, prefs, state);
  return 'ok';
}

export async function registerSubscription(
  sub: PushSubscription,
  prefs: ReminderPrefs,
  state: SubscribeState,
): Promise<void> {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      prefs,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...state,
    }),
  });
  if (!res.ok) throw new Error('Could not save the reminder on the server.');
}

export async function disableReminders(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => undefined);
  await sub.unsubscribe();
}

/** Tells the Worker what has been done today, so a due reminder is not sent needlessly. */
export async function pingReminders(state: SubscribeState): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch('/api/push/ping', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint, ...state }),
  }).catch(() => undefined);
}
