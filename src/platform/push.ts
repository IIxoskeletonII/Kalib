// Platform adapter for reminders (Web Push). On iOS this only works from the Home Screen app
// (16.4+); the browser tab has no push. Under Capacitor: the Push Notifications plugin.

/** Extra request headers (the session token) the caller supplies; see services/apiAuth.ts. */
export type AuthHeaders = Record<string, string>;

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

/** The phone's own account of the day, so a nudge can name what is still undone (§17). */
export interface DayReport {
  date: string;
  weighed: boolean;
  logged: boolean;
  supplements_left: number;
  supplements_total: number;
  water_left_ml: number;
}

export interface SubscribeState {
  lastLoggedDate?: string | undefined;
  lastWeighedDate?: string | undefined;
  day?: DayReport | undefined;
}

/** Asks permission (must come from a tap), subscribes, and registers with the Worker. */
export async function enableReminders(
  prefs: ReminderPrefs,
  state: SubscribeState,
  auth: AuthHeaders,
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
  await registerSubscription(sub, prefs, state, auth);
  return 'ok';
}

export async function registerSubscription(
  sub: PushSubscription,
  prefs: ReminderPrefs,
  state: SubscribeState,
  auth: AuthHeaders,
): Promise<void> {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      prefs,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...state,
    }),
  });
  if (res.status === 401) throw new Error('Sign in (Settings → Sync) to use reminders.');
  if (!res.ok) throw new Error('Could not save the reminder on the server.');
}

export async function disableReminders(auth: AuthHeaders): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => undefined);
  await sub.unsubscribe();
}

export interface ServerStatus {
  registered: boolean;
  prefs?: ReminderPrefs;
  tz?: string;
  sent?: { weigh?: string; log?: string };
  day?: DayReport | null;
  last_error?: { at: string; kind: string; status: number; detail: string } | null;
  /** What the server would send right now. */
  due?: ('weigh' | 'log')[];
  /** Local "YYYY-MM-DD HH:MM" each reminder is next considered, or null when switched off. */
  next?: { weigh: string | null; log: string | null };
}

/** Whether the Worker still holds this phone's subscription (it drops dead ones). */
export async function serverStatus(auth: AuthHeaders): Promise<ServerStatus | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const res = await fetch('/api/push/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()) as ServerStatus;
}

export interface TestResult {
  outcome: 'sent' | 'gone' | 'failed';
  status: number;
  detail: string;
}

/** Asks the Worker to push a test notification right now and reports what the push service said. */
export async function sendTestNotification(auth: AuthHeaders): Promise<TestResult> {
  const sub = await currentSubscription();
  if (!sub) return { outcome: 'failed', status: 0, detail: 'This phone has no subscription.' };
  const res = await fetch('/api/push/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  if (res.status === 404) return { outcome: 'gone', status: 404, detail: 'not registered' };
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    return { outcome: 'failed', status: res.status, detail: e.error ?? '' };
  }
  return (await res.json()) as TestResult;
}

/** Tells the Worker what has been done today, so a due reminder is not sent needlessly. */
export async function pingReminders(
  state: SubscribeState,
  auth: AuthHeaders,
  prefs?: ReminderPrefs,
): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch('/api/push/ping', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      ...state,
      // Sent every time: a phone that has travelled must nudge on its new clock.
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(prefs ? { prefs } : {}),
    }),
  }).catch(() => undefined);
}
