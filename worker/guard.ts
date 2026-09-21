// Who may spend money or write state through the Worker (see SECURITY.md).
//
// The static app is public and so is the OpenRouter-backed estimate endpoint's URL, so every
// endpoint that costs money (estimate) or writes durable state (push subscriptions) requires a
// Supabase session: the Worker asks Supabase's auth service who the bearer token belongs to.
// On top of that sit daily quotas (per user and global, in KV) that bound the worst case even
// if an account is compromised, and a short per-minute rate limit against bursts.

export interface GuardEnv {
  /**
   * Public project URL + publishable key, same values the app itself ships with. The VITE_
   * names are accepted too, so `wrangler secret bulk .env.local` uploads them as they are.
   */
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  /** Daily caps for estimation; defaults below. */
  ESTIMATE_DAILY_USER?: string;
  ESTIMATE_DAILY_TOTAL?: string;
}

export interface AuthUser {
  id: string;
  email: string | null;
}

export const DEFAULT_DAILY_USER = 30;
export const DEFAULT_DAILY_TOTAL = 100;

/** Verified sessions are remembered for a minute per isolate, so a burst is one auth call. */
const cache = new Map<string, { user: AuthUser; until: number }>();
const CACHE_MS = 60_000;

function supabaseOf(env: GuardEnv): { url: string; key: string } | null {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

export function authConfigured(env: GuardEnv): boolean {
  return supabaseOf(env) !== null;
}

/**
 * Resolves the bearer token to a Supabase user, or null. Any failure (no header, bad token,
 * Supabase down) is "not signed in" — the caller answers 401 and spends nothing.
 */
export async function requireUser(
  request: Request,
  env: GuardEnv,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<AuthUser | null> {
  const sb = supabaseOf(env);
  if (!sb) return null;
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  // A JWT is three base64url segments; anything else is not worth a round trip.
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) || token.length > 4096) return null;

  const hit = cache.get(token);
  if (hit && hit.until > now) return hit.user;

  let res: Response;
  try {
    res = await fetchImpl(`${sb.url}/auth/v1/user`, {
      headers: { apikey: sb.key, authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { id?: unknown; email?: unknown } | null;
  if (!body || typeof body.id !== 'string') return null;
  const user: AuthUser = { id: body.id, email: typeof body.email === 'string' ? body.email : null };
  if (cache.size > 200) cache.clear();
  cache.set(token, { user, until: now + CACHE_MS });
  return user;
}

// ---- daily quotas (KV counters; eventual consistency may over-admit by one or two) ----

export interface QuotaStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function positiveInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Admits one estimate for `userId` if neither the user's nor the global daily count is at its
 * cap, counting it on admission. Returns what stopped it otherwise.
 */
export async function admitEstimate(
  store: QuotaStore,
  userId: string,
  env: GuardEnv,
  now = new Date(),
): Promise<
  { ok: true; usedToday: number; capUser: number } | { ok: false; reason: 'user' | 'total' }
> {
  const capUser = positiveInt(env.ESTIMATE_DAILY_USER, DEFAULT_DAILY_USER);
  const capTotal = positiveInt(env.ESTIMATE_DAILY_TOTAL, DEFAULT_DAILY_TOTAL);
  const day = utcDate(now);
  const userKey = `quota:estimate:${day}:${userId}`;
  const totalKey = `quota:estimate:${day}:all`;
  const [u, t] = await Promise.all([store.get(userKey), store.get(totalKey)]);
  const used = Number(u) || 0;
  const total = Number(t) || 0;
  if (used >= capUser) return { ok: false, reason: 'user' };
  if (total >= capTotal) return { ok: false, reason: 'total' };
  // Two days keeps yesterday readable for a while and lets the key expire on its own.
  const opts = { expirationTtl: 2 * 86_400 };
  await Promise.all([
    store.put(userKey, String(used + 1), opts),
    store.put(totalKey, String(total + 1), opts),
  ]);
  return { ok: true, usedToday: used + 1, capUser };
}

// ---- push endpoints: only the browsers' own push services, never an arbitrary URL ----

/** Hosts (or suffixes, with a leading dot) the cron may POST encrypted reminders to. */
const PUSH_HOSTS = [
  'fcm.googleapis.com', // Chrome, Brave, Samsung Internet, Opera, Vivaldi
  'android.googleapis.com',
  '.push.apple.com', // Safari / iOS Home Screen apps (web.push.apple.com)
  '.push.services.mozilla.com', // Firefox
  '.notify.windows.com', // Edge
  'push.samsungosp.com',
];

export function isPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
}

// ---- per-minute rate limits (Cloudflare Rate Limiting binding; absent in local dev) ----

export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** True when the request may proceed. Without a binding there is nothing to enforce. */
export async function underLimit(limiter: Limiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch {
    return true;
  }
}
