// Reminders: what the user asked for (a setting) plus keeping the Worker informed of what has
// already been done today, so a nudge only goes out when it is needed.
import { getSetting, setSetting } from '@/db/repo/settings';
import { authHeaders } from '@/services/apiAuth';
import {
  currentSubscription,
  disableReminders,
  enableReminders,
  pingReminders,
  registerSubscription,
  type ReminderPrefs,
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

let lastPing = '';
/** Cheap and idempotent: only talks to the Worker when the day's facts changed. */
export async function pingIfEnabled(done: DoneToday): Promise<void> {
  const s = await getReminderSettings();
  if (!s.enabled) return;
  const stamp = `${done.lastLoggedDate ?? ''}|${done.lastWeighedDate ?? ''}`;
  if (stamp === lastPing) return;
  lastPing = stamp;
  const auth = await authHeaders();
  if ('authorization' in auth) await pingReminders(done, auth);
}
