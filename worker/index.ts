// Cloudflare Worker: serves the built PWA from `dist/` and proxies Open Food Facts (SPEC §7.2).
// The proxy exists because OFF's search service has no CORS and its legacy endpoint is flaky;
// doing it server-side also lets us send the User-Agent OFF asks for, re-rank for completeness,
// and cache. Everything else falls through to static assets.
//
// Trust model (SECURITY.md): the OFF proxy is public but rate-limited and cached; anything
// that spends money (estimate) or writes durable state (push subscriptions) needs a Supabase
// session and sits behind daily quotas.
import { runEstimate, type EstimateEnv, type EstimateRequest } from './estimate';
import {
  admitEstimate,
  authConfigured,
  isPushEndpoint,
  isStaticFileRequest,
  mayEstimate,
  requireUser,
  underLimit,
  type GuardEnv,
  type Limiter,
} from './guard';
import { normalizeOffProduct, rankOffProducts, type OffProduct, type OffHit } from './off';
import { runSuggest, type SuggestEnv, type SuggestRequest } from './suggest';
import {
  addToBank,
  BANK_KEY,
  fetchTrends,
  pickFromBank,
  sampleTrends,
  TRENDS_KEY,
  trendsStale,
  type BankRecipe,
  type Trends,
} from './trends';
import {
  dueReminders,
  reminderMessage,
  sendPushDetailed,
  type PushEnv,
  type PushSubscriptionJson,
  type ReminderPrefs,
  type StoredSubscription,
} from './push';

export interface Env extends EstimateEnv, SuggestEnv, PushEnv, GuardEnv {
  ASSETS: Fetcher;
  /** Push subscriptions and daily quota counters. Optional: without it reminders are off. */
  PUSH?: KVNamespace;
  /** Rate Limiting bindings (wrangler.jsonc); absent under `wrangler dev`. */
  ESTIMATE_LIMIT?: Limiter;
  API_LIMIT?: Limiter;
}

/** A phone or two per person is normal; more than this is not a person. */
const MAX_DEVICES_PER_USER = 5;

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
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
    const on = Boolean(
      env.PUSH && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && authConfigured(env),
    );
    return json({ enabled: on, publicKey: on ? env.VAPID_PUBLIC_KEY : null });
  }
  if (!env.PUSH || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !authConfigured(env)) {
    return json({ error: 'Reminders are not set up on the server.' }, 503);
  }
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return json({ error: 'method' }, 405);
  }
  const origin = request.headers.get('origin') ?? '';
  if (origin && origin !== url.origin) return json({ error: 'forbidden' }, 403);
  if (!(await underLimit(env.API_LIMIT, `push:${clientIp(request)}`))) {
    return json({ error: 'Too many requests. Try again in a minute.' }, 429);
  }
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in to use reminders.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const devicesKey = `devices:${user.id}`;
  const devices = ((await env.PUSH.get(devicesKey, 'json')) as string[] | null) ?? [];

  if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
    const sub = body.subscription as PushSubscriptionJson | undefined;
    if (
      !sub ||
      !isPushEndpoint(sub.endpoint) ||
      typeof sub.keys?.p256dh !== 'string' ||
      typeof sub.keys?.auth !== 'string' ||
      sub.keys.p256dh.length > 200 ||
      sub.keys.auth.length > 64
    ) {
      return json({ error: 'bad subscription' }, 400);
    }
    const key = await subKey(sub.endpoint);
    const existing = (await env.PUSH.get(key, 'json')) as StoredSubscription | null;
    if (existing?.user_id && existing.user_id !== user.id) {
      return json({ error: 'forbidden' }, 403);
    }
    if (!devices.includes(key)) {
      if (devices.length >= MAX_DEVICES_PER_USER) {
        return json({ error: 'Too many devices have reminders on this account.' }, 429);
      }
      await env.PUSH.put(devicesKey, JSON.stringify([...devices, key]));
    }
    const stored: StoredSubscription = {
      subscription: {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      },
      prefs: cleanPrefs(body.prefs),
      tz: typeof body.tz === 'string' && body.tz.length <= 64 ? body.tz : 'UTC',
      ...(typeof body.lastLoggedDate === 'string' ? { lastLoggedDate: body.lastLoggedDate } : {}),
      ...(typeof body.lastWeighedDate === 'string'
        ? { lastWeighedDate: body.lastWeighedDate }
        : {}),
      ...(existing?.sent ? { sent: existing.sent } : {}),
      user_id: user.id,
      updated_at: new Date().toISOString(),
    };
    await env.PUSH.put(key, JSON.stringify(stored));
    return json({ ok: true });
  }

  const endpoint = body.endpoint;
  if (!isPushEndpoint(endpoint)) return json({ error: 'bad request' }, 400);
  const key = await subKey(endpoint);
  const existing = (await env.PUSH.get(key, 'json')) as StoredSubscription | null;

  if (url.pathname === '/api/push/subscribe' && request.method === 'DELETE') {
    if (existing?.user_id && existing.user_id !== user.id) {
      return json({ error: 'forbidden' }, 403);
    }
    await env.PUSH.delete(key);
    if (devices.includes(key)) {
      await env.PUSH.put(devicesKey, JSON.stringify(devices.filter((d) => d !== key)));
    }
    return json({ ok: true });
  }
  if (url.pathname === '/api/push/status' && request.method === 'POST') {
    if (!existing) return json({ registered: false });
    if (existing.user_id && existing.user_id !== user.id) return json({ error: 'forbidden' }, 403);
    return json({
      registered: true,
      prefs: existing.prefs,
      tz: existing.tz,
      lastLoggedDate: existing.lastLoggedDate ?? null,
      lastWeighedDate: existing.lastWeighedDate ?? null,
      sent: existing.sent ?? {},
      updated_at: existing.updated_at,
    });
  }
  if (url.pathname === '/api/push/test' && request.method === 'POST') {
    if (!existing) return json({ error: 'unknown subscription' }, 404);
    if (existing.user_id && existing.user_id !== user.id) return json({ error: 'forbidden' }, 403);
    const r = await sendPushDetailed(
      existing.subscription,
      {
        title: 'Kalib reminders are on',
        body: 'This is the test. The real ones come at the times you set.',
        url: '/',
        tag: 'test',
      },
      env,
    );
    console.log(JSON.stringify({ push: 'test', user: user.id, ...r }));
    return json(r);
  }
  if (url.pathname === '/api/push/ping' && request.method === 'POST') {
    if (!existing) return json({ error: 'unknown subscription' }, 404);
    if (existing.user_id && existing.user_id !== user.id) return json({ error: 'forbidden' }, 403);
    if (typeof body.lastLoggedDate === 'string') existing.lastLoggedDate = body.lastLoggedDate;
    if (typeof body.lastWeighedDate === 'string') existing.lastWeighedDate = body.lastWeighedDate;
    // Subscriptions from before sign-in was required are adopted by the first owner to ping.
    existing.user_id = user.id;
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
  let checked = 0;
  let failed = 0;
  let cursor: string | null = null;
  do {
    const page: KVNamespaceListResult<unknown> = await env.PUSH.list(cursor ? { cursor } : {});
    for (const k of page.keys) {
      if (k.name.includes(':')) continue; // quota counters and device indexes, not subscriptions
      const s = (await env.PUSH.get(k.name, 'json')) as StoredSubscription | null;
      // Never POST anywhere but a browser push service, whatever is in the store.
      if (!s?.subscription || !isPushEndpoint(s.subscription.endpoint)) continue;
      checked++;
      const due = dueReminders(s, now);
      if (due.length === 0) continue;
      const { date } = localClockFor(s, now);
      let changed = false;
      for (const kind of due) {
        const r = await sendPushDetailed(s.subscription, reminderMessage(kind), env);
        if (r.outcome === 'gone') {
          console.warn(
            JSON.stringify({ push: 'dropped', kind, status: r.status, detail: r.detail }),
          );
          await env.PUSH.delete(k.name);
          out.dropped++;
          changed = false;
          break;
        }
        if (r.outcome === 'sent') {
          s.sent = { ...s.sent, [kind]: date };
          out.sent++;
          changed = true;
        } else {
          failed++;
          console.warn(
            JSON.stringify({ push: 'failed', kind, status: r.status, detail: r.detail }),
          );
        }
      }
      if (changed) await env.PUSH.put(k.name, JSON.stringify(s));
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  console.log(
    JSON.stringify({ cron: 'reminders', checked, sent: out.sent, dropped: out.dropped, failed }),
  );
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

/** This week's publisher titles from KV, refreshed in place when the Monday cron missed. */
async function currentTrends(env: Env): Promise<Trends | null> {
  if (!env.PUSH) return null;
  const stored = (await env.PUSH.get(TRENDS_KEY, 'json')) as Trends | null;
  if (!trendsStale(stored)) return stored;
  const fresh = await fetchTrends();
  if (fresh.items.length > 0) await env.PUSH.put(TRENDS_KEY, JSON.stringify(fresh));
  console.log(JSON.stringify({ trends: 'refreshed', items: fresh.items.length }));
  return fresh.items.length > 0 ? fresh : stored;
}

export async function refreshTrends(env: Env): Promise<number> {
  if (!env.PUSH) return 0;
  const fresh = await fetchTrends();
  if (fresh.items.length > 0) await env.PUSH.put(TRENDS_KEY, JSON.stringify(fresh));
  console.log(JSON.stringify({ cron: 'trends', items: fresh.items.length }));
  return fresh.items.length;
}

async function readBank(env: Env): Promise<BankRecipe[]> {
  if (!env.PUSH) return [];
  return ((await env.PUSH.get(BANK_KEY, 'json')) as BankRecipe[] | null) ?? [];
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
      'x-content-type-options': 'nosniff',
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

    // §18.6 — a kept suggestion joins the shared bank (content only, no one's data).
    if (url.pathname === '/api/suggest/keep') {
      if (request.method !== 'POST') return json({ error: 'method' }, 405);
      const origin = request.headers.get('origin') ?? '';
      if (origin && origin !== url.origin) return json({ error: 'forbidden' }, 403);
      if (!env.PUSH) return json({ ok: false }, 503);
      if (!(await underLimit(env.API_LIMIT, `keep:${clientIp(request)}`))) {
        return json({ error: 'Too many requests.' }, 429);
      }
      const user = await requireUser(request, env);
      if (!user) return json({ error: 'Sign in first.' }, 401);
      const size = Number(request.headers.get('content-length') ?? 0);
      if (size > 20_000) return json({ error: 'Too large.' }, 413);
      let body: { recipe?: Record<string, unknown> };
      try {
        body = (await request.json()) as { recipe?: Record<string, unknown> };
      } catch {
        return json({ error: 'bad request' }, 400);
      }
      const r = body.recipe;
      if (!r || typeof r.name !== 'string' || !Array.isArray(r.ingredients)) {
        return json({ error: 'bad recipe' }, 400);
      }
      const strings = (v: unknown, max: number) =>
        Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string').slice(0, max) : [];
      const bank = addToBank(await readBank(env), {
        name: r.name.slice(0, 80),
        blurb: typeof r.blurb === 'string' ? r.blurb.slice(0, 160) : '',
        tags: strings(r.tags, 8),
        portions: Number(r.portions) || 4,
        time_min: Number(r.time_min) || 30,
        ...(Number(r.oven_c) ? { oven_c: Number(r.oven_c) } : {}),
        ingredients: r.ingredients.slice(0, 30),
        steps: strings(r.steps, 12),
        ...(typeof r.inspiration === 'string' ? { inspiration: r.inspiration.slice(0, 140) } : {}),
      });
      await env.PUSH.put(BANK_KEY, JSON.stringify(bank));
      return json({ ok: true, size: bank.length });
    }

    // SPEC §9.4 estimation and §18.6 suggestions both cost money: signed in, rate-limited,
    // and sharing one daily cap (a batch of suggestions counts as one estimate).
    if (url.pathname === '/api/estimate' || url.pathname === '/api/suggest') {
      const suggesting = url.pathname === '/api/suggest';
      if (request.method !== 'POST') return json({ error: 'method' }, 405);
      const origin = request.headers.get('origin') ?? '';
      if (origin && origin !== url.origin) return json({ error: 'forbidden' }, 403);
      if (!authConfigured(env) || !env.PUSH) {
        return json({ error: 'Estimation is not set up on the server yet.' }, 503);
      }
      const user = await requireUser(request, env);
      if (!user) {
        return json(
          {
            error: suggesting
              ? 'Sign in (Settings → Sync) to get suggestions.'
              : 'Sign in (Settings → Sync) to estimate meals.',
          },
          401,
        );
      }
      if (!mayEstimate(user, env)) {
        return json({ error: 'Meal estimation is switched on for household accounts only.' }, 403);
      }
      if (!(await underLimit(env.ESTIMATE_LIMIT, user.id))) {
        return json({ error: 'One at a time — try again in a minute.' }, 429);
      }
      const size = Number(request.headers.get('content-length') ?? 0);
      if (size > (suggesting ? 20_000 : 2_500_000)) return json({ error: 'Too large.' }, 413);
      let req: EstimateRequest & SuggestRequest;
      try {
        req = (await request.json()) as EstimateRequest & SuggestRequest;
      } catch {
        return json({ error: 'bad request' }, 400);
      }
      const admitted = await admitEstimate(env.PUSH, user.id, env);
      if (!admitted.ok) {
        return json(
          {
            error:
              admitted.reason === 'user'
                ? 'You have used today’s estimates. Tomorrow is a new day.'
                : 'Estimation is paused until tomorrow.',
          },
          429,
        );
      }
      if (suggesting) {
        // Some of the batch can come from the bank for free; the model writes the rest.
        const wanted = Math.min(8, Math.max(1, Math.round(Number(req.count) || 4)));
        const exclude = Array.isArray(req.exclude)
          ? req.exclude.filter((n): n is string => typeof n === 'string')
          : [];
        const fromBank =
          req.include_bank === false
            ? []
            : pickFromBank(await readBank(env), exclude, Math.min(2, wanted - 1));
        const trends = sampleTrends(await currentTrends(env), 30);
        const out = await runSuggest(
          {
            ...req,
            count: wanted - fromBank.length,
            exclude: [...exclude, ...fromBank.map((b) => b.name)],
          },
          env,
          fetch,
          { trends },
        );
        if (!out.ok) return json({ error: out.error }, out.status);
        const modelRecipes = ((out.result as { recipes?: unknown[] })?.recipes ?? []) as unknown[];
        return json({
          result: {
            recipes: [...modelRecipes, ...fromBank.map((b) => ({ ...b, from_bank: true }))],
          },
          model: out.model,
          trends: trends.length,
          bank: fromBank.length,
          used: admitted.usedToday,
          cap: admitted.capUser,
        });
      }
      const out = await runEstimate(req, env);
      return out.ok
        ? json({
            result: out.result,
            model: out.model,
            used: admitted.usedToday,
            cap: admitted.capUser,
          })
        : json({ error: out.error }, out.status);
    }

    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET') return json({ error: 'method' }, 405);
      if (!(await underLimit(env.API_LIMIT, `off:${clientIp(request)}`))) {
        return json({ error: 'Too many requests. Try again in a minute.' }, 429);
      }
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
      } catch {
        return json({ error: 'Open Food Facts is unavailable right now.' }, 502);
      }
      if (response.ok) ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // A build's files are immutable and hashed. When an installed app asks for one that a
    // later deploy removed, it must hear 404 — not the SPA fallback's index.html, which the
    // browser would try to execute as JavaScript and fail on forever (the client then clears
    // its caches and reloads, see platform/recovery.ts).
    const res = await env.ASSETS.fetch(request);
    if (
      res.ok &&
      isStaticFileRequest(url.pathname) &&
      (res.headers.get('content-type') ?? '').includes('text/html')
    ) {
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
      });
    }
    return res;
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Monday early: this week's publisher titles. Every ten minutes: reminders.
    ctx.waitUntil(event.cron === '0 5 * * 1' ? refreshTrends(env) : runReminders(env));
  },
};
