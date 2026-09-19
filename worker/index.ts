// Cloudflare Worker: serves the built PWA from `dist/` and proxies Open Food Facts (SPEC §7.2).
// The proxy exists because OFF's search service has no CORS and its legacy endpoint is flaky;
// doing it server-side also lets us send the User-Agent OFF asks for, re-rank for completeness,
// and cache. Everything else falls through to static assets.
import { normalizeOffProduct, rankOffProducts, type OffProduct, type OffHit } from './off';

export interface Env {
  ASSETS: Fetcher;
}

const USER_AGENT = 'Kalib/0.1 (https://kalib.kalib.workers.dev)';
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
      'cache-control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-store',
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

    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET') return json({ error: 'method' }, 405);
      const cache = caches.default;
      const cached = await cache.match(request);
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
      if (response.ok) ctx.waitUntil(cache.put(request, response.clone()));
      return response;
    }

    return env.ASSETS.fetch(request);
  },
};
