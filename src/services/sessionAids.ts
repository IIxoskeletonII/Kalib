// SPEC §20.14 — the settings behind the session's aids. The behaviour lives in platform/ (the
// browser calls) and core/restTimer.ts (when an alert is due); this is only the stored choice.
import { getSetting, setSetting } from '@/db/repo/settings';

/**
 * Whether the end of a rest sounds and buzzes. A preference about the person rather than the
 * phone, so it syncs like the weight unit does: someone who trains with it off on one phone
 * wants it off on the other.
 */
export const REST_ALERT_KEY = 'rest_alert';

/** On unless turned off: a countdown that ends in silence is easy to miss across a gym. */
export async function getRestAlert(): Promise<boolean> {
  return (await getSetting<boolean>(REST_ALERT_KEY)) !== false;
}

export async function setRestAlert(on: boolean): Promise<void> {
  await setSetting(REST_ALERT_KEY, on);
}
