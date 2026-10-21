// Platform adapter: keep the screen on while a workout runs. Under Capacitor: the KeepAwake
// plugin, behind the same two calls.
//
// A phone propped on a bench that dims and locks between sets means a passcode before every
// tick, and the rest countdown is invisible exactly when it is being waited on. The Screen Wake
// Lock API fixes that, with two habits worth knowing:
//
//   - The browser drops the lock whenever the page is hidden — switching apps, locking the
//     phone — and never gives it back by itself. So it is asked for again each time the page
//     becomes visible, for as long as the hold lasts.
//   - It can be refused (battery saver, a policy, a page not yet visible), and on iOS it worked
//     in Safari tabs long before it worked in installed web apps (fixed in iOS 18.4). Refusal is
//     not an error to show: the screen simply sleeps as it always has.

export interface WakeLockEnv {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> };
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
}

function defaults(): WakeLockEnv {
  return {
    ...(typeof navigator !== 'undefined' && 'wakeLock' in navigator
      ? { wakeLock: navigator.wakeLock }
      : {}),
    ...(typeof document !== 'undefined' ? { doc: document } : {}),
  };
}

/** Whether this browser can keep the screen on at all. */
export function canKeepScreenOn(env: WakeLockEnv = defaults()): boolean {
  return env.wakeLock != null && env.doc != null;
}

/**
 * Holds the screen on until the returned function is called. Safe to call where the API does
 * not exist (it does nothing) and safe to release twice.
 */
export function keepScreenOn(env: WakeLockEnv = defaults()): () => void {
  const { wakeLock, doc } = env;
  if (!wakeLock || !doc) return () => {};

  let sentinel: WakeLockSentinel | null = null;
  let pending = false;
  let stopped = false;

  const acquire = async () => {
    // One request at a time: a visibility change landing while the first request is still in
    // flight would otherwise leave two locks, one of which nothing would ever release.
    if (stopped || pending || doc.visibilityState !== 'visible') return;
    if (sentinel && !sentinel.released) return;
    pending = true;
    try {
      const s = await wakeLock.request('screen');
      if (stopped) void s.release().catch(() => {});
      else sentinel = s;
    } catch {
      // Refused. The screen sleeps as it would have without us.
    } finally {
      pending = false;
    }
  };

  const onVisibility = () => void acquire();
  doc.addEventListener('visibilitychange', onVisibility);
  void acquire();

  return () => {
    if (stopped) return;
    stopped = true;
    doc.removeEventListener('visibilitychange', onVisibility);
    const s = sentinel;
    sentinel = null;
    if (s && !s.released) void s.release().catch(() => {});
  };
}
