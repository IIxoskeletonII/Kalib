// Reminders: what the user asked for (a setting) plus keeping the Worker informed of what has
// already been done today, so a nudge only goes out when it is needed.
import { addDays, fromDateKey, todayKey } from '@/core/dates';
import { getSetting, setSetting } from '@/db/repo/settings';
import { authHeaders } from '@/services/apiAuth';
import {
  currentSubscription,
  disableReminders,
  enableReminders,
  pingReminders,
  registerSubscription,
  sendTestNotification,
  serverStatus,
  type DayReport,
  type ReminderPrefs,
  type ServerStatus,
  type TestResult,
} from '@/platform/push';

export const REMINDERS_KEY = 'reminders';

export interface ReminderSettings extends ReminderPrefs {
  enabled: boolean;
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: false,
  weighAt: '07:30',
  logAt: '20:00',
};

export async function getReminderSettings(): Promise<ReminderSettings> {
  return (await getSetting<ReminderSettings>(REMINDERS_KEY)) ?? DEFAULT_REMINDERS;
}

export interface DoneToday {
  lastLoggedDate?: string | undefined;
  lastWeighedDate?: string | undefined;
  day?: DayReport | undefined;
}

export async function turnOn(prefs: ReminderPrefs, done: DoneToday) {
  const auth = await authHeaders();
  if (!('authorization' in auth)) return 'signin' as const;
  const r = await enableReminders(prefs, done, auth);
  if (r === 'ok')
    await setSetting(REMINDERS_KEY, { enabled: true, ...prefs } satisfies ReminderSettings);
  return r;
}

export async function turnOff(prefs: ReminderPrefs): Promise<void> {
  await disableReminders(await authHeaders());
  await setSetting(REMINDERS_KEY, { enabled: false, ...prefs } satisfies ReminderSettings);
}

/** Saves new times; re-registers with the Worker when reminders are on. */
export async function updatePrefs(s: ReminderSettings, done: DoneToday): Promise<void> {
  await setSetting(REMINDERS_KEY, s);
  if (!s.enabled) return;
  const sub = await currentSubscription();
  if (sub) {
    await registerSubscription(
      sub,
      { weighAt: s.weighAt, logAt: s.logAt },
      done,
      await authHeaders(),
    );
  }
}

export type Health =
  | { state: 'signin' }
  | { state: 'no-subscription' }
  | { state: 'registered'; status: ServerStatus }
  | { state: 're-registered'; status?: ServerStatus }
  | { state: 'unknown' };

/**
 * Reminders are only real if the server still holds this phone's subscription. When it does
 * not (a failed first registration, or a subscription the cron dropped), register it again.
 */
export async function checkHealth(s: ReminderSettings, done: DoneToday): Promise<Health> {
  const auth = await authHeaders();
  if (!('authorization' in auth)) return { state: 'signin' };
  const sub = await currentSubscription();
  if (!sub) return { state: 'no-subscription' };
  const status = await serverStatus(auth);
  if (!status) return { state: 'unknown' };
  if (status.registered) return { state: 'registered', status };
  await registerSubscription(sub, { weighAt: s.weighAt, logAt: s.logAt }, done, auth);
  const after = await serverStatus(auth);
  return after?.registered ? { state: 're-registered', status: after } : { state: 're-registered' };
}

/** "today 20:00" / "tomorrow 07:30" / "Thu 07:30" from the server's local timestamp. */
export function describeNext(next: string | null, now = new Date()): string | null {
  if (!next) return null;
  const [date, time] = next.split(' ');
  if (!date || !time) return null;
  const today = todayKey(now);
  if (date === today) return `today ${time}`;
  if (date === addDays(today, 1)) return `tomorrow ${time}`;
  return `${fromDateKey(date).toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

/** Pushes a test notification now; the result names what the push service answered. */
export async function testNow(): Promise<TestResult> {
  const auth = await authHeaders();
  if (!('authorization' in auth)) {
    return { outcome: 'failed', status: 401, detail: 'Sign in first.' };
  }
  return sendTestNotification(auth);
}

let lastPing = '';
/** Cheap and idempotent: only talks to the Worker when the day's facts changed. */
export async function pingIfEnabled(done: DoneToday): Promise<void> {
  const s = await getReminderSettings();
  if (!s.enabled) return;
  const d = done.day;
  const stamp = `${done.lastLoggedDate ?? ''}|${done.lastWeighedDate ?? ''}|${
    d ? `${d.date}:${d.weighed}:${d.logged}:${d.supplements_left}:${d.water_left_ml}` : ''
  }`;
  if (stamp === lastPing) return;
  lastPing = stamp;
  const auth = await authHeaders();
  if ('authorization' in auth) {
    await pingReminders(done, auth, { weighAt: s.weighAt, logAt: s.logAt });
  }
}
