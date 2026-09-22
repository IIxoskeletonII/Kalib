// An installed app must never be stranded on a build whose files are gone. When a script or a
// lazily-loaded screen fails to arrive, the caches and the service worker are dropped and the
// page is reloaded once, so the next load comes fresh from the network.
//
// Logs, weigh-ins, recipes and settings live in IndexedDB and are never touched by any of this.

const KEY = 'kalib:recovered-at';
/** Two recoveries inside this window would be a loop, so the second one is refused. */
const COOLDOWN_MS = 60_000;

function lastRecovery(): number {
  try {
    return Number(sessionStorage.getItem(KEY) ?? 0);
  } catch {
    return 0; // private mode: no memory of a previous attempt, so allow one
  }
}

function markRecovery(now: number): void {
  try {
    sessionStorage.setItem(KEY, String(now));
  } catch {
    /* nothing to do: the reload still happens, the loop guard is simply weaker */
  }
}

/** True when the message is a module that could not be fetched or parsed (a stale build). */
export function isStaleBuildError(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  return /dynamically imported module|importing a module script failed|failed to fetch dynamically|expected a javascript(-or-wasm)? module script|unexpected token '<'|error loading dynamically imported module/i.test(
    message,
  );
}

/** Whether a recovery may run now (not already attempted in this tab, and online). */
export function shouldRecover(now: number, last: number, online: boolean): boolean {
  if (!online) return false;
  return now - last > COOLDOWN_MS;
}

export async function clearCachesAndWorkers(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
  }
  if ('caches' in window) {
    const keys = await caches.keys().catch(() => []);
    await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
  }
}

async function recover(reason: string): Promise<void> {
  const now = Date.now();
  if (!shouldRecover(now, lastRecovery(), navigator.onLine)) return;
  markRecovery(now);
  console.warn(`[kalib] stale build (${reason}) — clearing caches and reloading`);
  await clearCachesAndWorkers();
  window.location.reload();
}

/** Installs the listeners. Safe to call once at startup. */
export function installRecovery(): void {
  // Vite raises this when a preloaded chunk cannot be fetched.
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault();
    void recover('preload');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: unknown } | undefined;
    if (isStaleBuildError(r?.message) || isStaleBuildError(r)) void recover('import');
  });
  window.addEventListener('error', (e) => {
    // A <script> that resolved to HTML fails here rather than as a rejection.
    if (isStaleBuildError(e.message)) void recover('script');
  });
}

/** Called by the error boundary when a screen fails to load. */
export function recoverNow(reason: string): void {
  void recover(reason);
}
