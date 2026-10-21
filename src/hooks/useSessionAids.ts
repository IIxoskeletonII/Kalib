// SPEC §20.14 — what a running session asks of the phone: keep the screen on, and say when a
// rest is over.
//
// Mounted from the workout bar, which is the one component on screen for the whole life of a
// session whatever page is showing (it hides itself on the session screen, but its hooks still
// run). So the screen stays on while you log a shake mid-workout, and the rest still ends with
// a chime when you are reading the trend.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';
import { restAlertDue, type RestTimer } from '@/core/restTimer';
import { restChime } from '@/platform/chime';
import { keepScreenOn } from '@/platform/wakeLock';
import { getRestAlert } from '@/services/sessionAids';

/** Whether rests end with a sound; on until turned off. */
export function useRestAlertEnabled(): boolean {
  return useLiveQuery(getRestAlert, []) ?? true;
}

/** Holds the screen on while `active`. */
export function useKeepScreenOn(active: boolean): void {
  useEffect(() => (active ? keepScreenOn() : undefined), [active]);
}

/**
 * Unlocks audio on the session's taps. A browser only lets sound start from inside a gesture
 * until the page has played once, and a rest ends while nobody is touching anything — so the
 * unlocking has to happen on an earlier tap. `pointerup`, `touchend` and `keydown` are the
 * events that count as a gesture; `pointerdown` does not, for a finger.
 */
function useAudioUnlock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const unlock = () => restChime().unlock();
    const events = ['pointerup', 'touchend', 'keydown'] as const;
    for (const e of events) document.addEventListener(e, unlock, { capture: true, passive: true });
    return () => {
      for (const e of events) document.removeEventListener(e, unlock, { capture: true });
    };
  }, [active]);
}

/**
 * Sounds and buzzes once when the rest ends.
 *
 * One timeout aimed at the end instant, not a ticking interval: nothing needs repainting here.
 * If the page is hidden the timeout is throttled or frozen, and the check runs again when it
 * comes back — where `restAlertDue` decides whether the end is still fresh enough to announce
 * or already old news (core/restTimer.ts).
 */
export function useRestAlert(timer: RestTimer | null, active: boolean): void {
  const enabled = useRestAlertEnabled();
  const enabledRef = useRef(enabled);
  const alerted = useRef<string | undefined>(undefined);
  useAudioUnlock(active);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const endsAt = timer?.ends_at;
  const duration = timer?.duration_sec;

  useEffect(() => {
    if (!active || endsAt == null || duration == null) return;
    const t: RestTimer = { ends_at: endsAt, duration_sec: duration };
    const check = () => {
      if (!restAlertDue(t, new Date(), alerted.current)) return;
      alerted.current = t.ends_at;
      if (!enabledRef.current) return;
      const chime = restChime();
      chime.play();
      chime.buzz();
    };
    // A little past the end, so the remaining seconds have certainly reached zero: a timeout
    // may fire a millisecond early, and "1 second left" is not over.
    const ms = Math.max(0, new Date(endsAt).getTime() - Date.now()) + 50;
    const id = window.setTimeout(check, ms);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [active, endsAt, duration]);
}
