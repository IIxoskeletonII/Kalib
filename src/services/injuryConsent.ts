// SPEC §20.16 — the agreement to injury help, kept apart from the feature so Settings can show
// and withdraw it without loading the red-flag screen and the rest of injury help.
import { getSetting, setSetting } from '@/db/repo/settings';

export const INJURY_CONSENT_KEY = 'consent:injury';
/**
 * What was agreed to. It names what is sent; if that ever changes, so does this, and the
 * person is asked again rather than held to an agreement about something else. The Worker
 * refuses a request without the current value.
 */
export const INJURY_CONSENT_VERSION = 'injury-v1';

export interface InjuryConsent {
  version: string;
  at: string;
}

export async function getInjuryConsent(): Promise<InjuryConsent | undefined> {
  const c = await getSetting<InjuryConsent | null>(INJURY_CONSENT_KEY);
  return c && c.version === INJURY_CONSENT_VERSION ? c : undefined;
}

export async function giveInjuryConsent(now = new Date()): Promise<void> {
  await setSetting(INJURY_CONSENT_KEY, {
    version: INJURY_CONSENT_VERSION,
    at: now.toISOString(),
  } satisfies InjuryConsent);
}

export async function withdrawInjuryConsent(): Promise<void> {
  await setSetting(INJURY_CONSENT_KEY, null);
}
