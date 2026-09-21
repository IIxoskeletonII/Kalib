// Cloudflare Worker: serves the built PWA from `dist/` and proxies Open Food Facts (SPEC §7.2).
// The proxy exists because OFF's search service has no CORS and its legacy endpoint is flaky;
// doing it server-side also lets us send the User-Agent OFF asks for, re-rank for completeness,
// and cache. Everything else falls through to static assets.
import { runEstimate, type EstimateEnv, type EstimateRequest } from './estimate';
import { normalizeOffProduct, rankOffProducts, type OffProduct, type OffHit } from './off';
import {
  dueReminders,
  reminderMessage,
  sendPush,
  type PushEnv,
  type PushSubscriptionJson,
  type ReminderPrefs,
  type StoredSubscription,
} from './push';

export interface Env extends EstimateEnv, PushEnv {
  ASSETS: Fetcher;
  /** Push subscriptions (reminders). Optional: without the binding the feature is off. */
  PUSH?: KVNamespace;
}

async function subKey(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function cleanPrefs(raw: unknown): ReminderPrefs {
  const p = (raw ?? {}) as Record<string, unknown>;
  const t = (v: unknown) => (typeof v === 'string' && HHMM.test(v) ? v : null);
  return { weighAt: t(p.weighAt), logAt: t(p.logAt) };
}

/** POST /api/push/subscribe, DELETE /api/push/subscribe, POST /api/push/ping, GET /api/push/config */
async function handlePush(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.pathname === '/api/push/config') {
    const on = Boolean(env.PUSH && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
    return json({ enabled: on, publicKey: on ? env.VAPID_PUBLIC_KEY : null });
  }
  if (!env.PUSH || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return json({ error: 'Reminders are not set up on the server.' }, 503);
  }
  const origin = request.headers.get('origin') ?? '';
  if (origin && origin !== url.origin) return json({ error: 'forbidden' }, 403);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
    const sub = body.subscription as PushSubscriptionJson | undefined;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return json({ error: 'bad subscription' }, 400);
    }
    const key = await subKey(sub.endpoint);
    const existing = (await env.PUSH.get(key, 'json')) as StoredSubscription | null;
    const stored: StoredSubscription = {
      subscription: sub,
      prefs: cleanPrefs(body.prefs),
      tz: typeof body.tz === 'string' ? body.tz : 'UTC',
      ...(typeof body.lastLoggedDate === 'string' ? { lastLoggedDate: body.lastLoggedDate } : {}),
      ...(typeof body.lastWeighedDate === 'string'
        ? { lastWeighedDate: body.lastWeighedDate }
        : {}),
      ...(existing?.sent ? { sent: existing.sent } : {}),
      updated_at: new Date().toISOString(),
    };
    await env.PUSH.put(key, JSON.stringify(stored));
    return json({ ok: true });
  }
  if (url.pathname === '/api/push/subscribe' && request.method === 'DELETE') {
    const endpoint = body.endpoint;
    if (typeof endpoint !== 'string') return json({ error: 'bad request' }, 400);
    await env.PUSH.delete(await subKey(endpoint));
    return json({ ok: true });
  }
  if (url.pathname === '/api/push/ping' && request.method === 'POST') {
    const endpoint = body.endpoint;
    if (typeof endpoint !== 'string') return json({ error: 'bad request' }, 400);
    const key = await subKey(endpoint);
    const existing = (await env.PUSH.get(key, 'json')) as StoredSubscription | null;
    if (!existing) return json({ error: 'unknown subscription' }, 404);
    if (typeof body.lastLoggedDate === 'string') existing.lastLoggedDate = body.lastLoggedDate;
    if (typeof body.lastWeighedDate === 'string') existing.lastWeighedDate = body.lastWeighedDate;
    existing.updated_at = new Date().toISOString();
    await env.PUSH.put(key, JSON.stringify(existing));
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}

/** Cron: every few minutes, send whatever is due. Dead subscriptions are dropped. */
export async function runReminders(
  env: Env,
  now = new Date(),
): Promise<{ sent: number; dropped: number }> {
  const out = { sent: 0, dropped: 0 };
  if (!env.PUSH || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return out;
  let cursor: string | null = null;
  do {
    const page: KVNamespaceListResult<unknown> = await env.PUSH.list(cursor ? { cursor } : {});
    for (const k of page.keys) {
      const s = (await env.PUSH.get(k.name, 'json')) as StoredSubscription | null;
      if (!s) continue;
      const due = dueReminders(s, now);
      if (due.length === 0) continue;
      const { date } = localClockFor(s, now);
      let changed = false;
      for (const kind of due) {
        const r = await sendPush(s.subscription, reminderMessage(kind), env);
        if (r === 'gone') {
          await env.PUSH.delete(k.name);
          out.dropped++;
          changed = false;
          break;
        }
        if (r === 'sent') {
          s.sent = { ...s.sent, [kind]: date };
          out.sent++;
          changed = true;
        }
      }
      if (changed) await env.PUSH.put(k.name, JSON.stringify(s));
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

function localClockFor(s: StoredSubscription, now: Date) {
  // Re-derive the local date the way dueReminders does, for the sent-today marker.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: s.tz || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}` };
}

const USER_AGENT = 'Kalib/0.1 (https://kalib.kalib.workers.dev)';
/** Bump when ranking/normalisation changes so edge-cached responses are not reused. */
const RANK_VERSION = 3;
const SEARCH_URL = 'https://search.openfoodfacts.org/search';
const LEGACY_SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';
const PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS =
  'code,product_name,product_name_en,product_name_it,brands,quantity,serving_size,serving_quantity,unique_scans_n,nutriments,countries_tags,completeness';

const json = (body: unknown, status = 200, cacheSeconds = 0): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Browsers keep it an hour; the edge cache keeps it for the full window.
      'cache-control': cacheSeconds ? `public, max-age=3600, s-maxage=${cacheSeconds}` : 'no-store',
    },
  });

async function offFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    cf: { cacheTtl: 3600, cacheEverything: true },
  } as RequestInit);
}

async function fetchHits(params: URLSearchParams): Promise<OffHit[]> {
  try {
    const res = await offFetch(`${SEARCH_URL}?${params}`);
    if (!res.ok) return [];
    return ((await res.json()) as { hits?: OffHit[] }).hits ?? [];
  } catch {
    return [];
  }
}

async function fetchLegacyHits(q: string): Promise<OffHit[]> {
  const legacy = new URLSearchParams({
    search_terms: q,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '40',
    fields: FIELDS,
  });
  const res = await offFetch(`${LEGACY_SEARCH_URL}?${legacy}`);
  if (!res.ok) throw new Error(`OFF ${res.status}`);
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new Error('OFF unavailable');
  return ((await res.json()) as { products?: OffHit[] }).products ?? [];
}

/**
 * Two queries in parallel: free-text relevance (finds "spaghetti n.5"), and the first word as a
 * brand sorted by popularity (finds the Pringles everyone actually scans, which relevance buries
 * under hundreds of half-filled entries). Merged, de-duplicated by barcode, then re-ranked.
 */
async function searchOff(q: string): Promise<OffProduct[]> {
  const brand = q.split(/\s+/)[0]?.replace(/[^\p{L}\p{N}'-]/gu, '') ?? '';
  const [byText, byBrand] = await Promise.all([
    fetchHits(new URLSearchParams({ q, page_size: '60', fields: FIELDS })),
    brand.length >= 3
      ? fetchHits(
          new URLSearchParams({
            q: `brands:"${brand}"`,
            sort_by: '-unique_scans_n',
            page_size: '40',
            fields: FIELDS,
          }),
        )
      : Promise.resolve([]),
  ]);
  let hits = [...byBrand, ...byText];
  if (hits.length === 0) hits = await fetchLegacyHits(q);
  const seen = new Set<string>();
  hits = hits.filter((h) => {
    const code = String(h.code ?? '');
    if (!code || seen.has(code)) return false;
    seen.add(code);
    return true;
  });
  return rankOffProducts(hits, q).slice(0, 20);
}

async function productOff(code: string): Promise<OffProduct | null> {
  const res = await offFetch(`${PRODUCT_URL}/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OFF ${res.status}`);
  const body = (await res.json()) as { status?: number; product?: OffHit };
  if (!body.product) return null;
  return normalizeOffProduct(body.product);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/push/')) return handlePush(request, url, env);

    // SPEC §9.4 — estimation. POST only, from the app's own origin, never cached.
    if (url.pathname === '/api/estimate') {
      if (request.method !== 'POST') return json({ error: 'method' }, 405);
      const origin = request.headers.get('origin') ?? '';
      if (origin && origin !== url.origin) return json({ error: 'forbidden' }, 403);
      let req: EstimateRequest;
      try {
        req = (await request.json()) as EstimateRequest;
      } catch {
        return json({ error: 'bad request' }, 400);
      }
      const out = await runEstimate(req, env);
      return out.ok
        ? json({ result: out.result, model: out.model })
        : json({ error: out.error }, out.status);
    }

    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET') return json({ error: 'method' }, 405);
      const cache = caches.default;
      const cacheKey = new Request(
        `${url.origin}${url.pathname}?${url.searchParams}&_r=${RANK_VERSION}`,
      );
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      let response: Response;
      try {
        if (url.pathname === '/api/off/search') {
          const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
          if (q.length < 2) return json({ error: 'query too short' }, 400);
          response = json({ query: q, products: await searchOff(q) }, 200, 86_400);
        } else if (url.pathname.startsWith('/api/off/product/')) {
          const code = url.pathname.slice('/api/off/product/'.length).replace(/\D/g, '');
          if (code.length < 6) return json({ error: 'bad barcode' }, 400);
          const product = await productOff(code);
          response = product ? json({ product }, 200, 86_400) : json({ product: null }, 404);
        } else {
          return json({ error: 'not found' }, 404);
        }
      } catch (err) {
        return json({ error: (err as Error).message }, 502);
      }
      if (response.ok) ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runReminders(env));
  },
};
