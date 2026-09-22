// SPEC §18.6 — what food publishers are posting this week, and the bank of recipes people
// kept. Both live in KV and feed the suggestion prompt so it never draws from a stale,
// fixed set. Titles are used as themes for inspiration; no recipe text is copied.

export interface TrendItem {
  title: string;
  source: string;
  /** ISO date when the feed gave one. */
  date?: string;
}

export interface Trends {
  updated_at: string;
  items: TrendItem[];
}

/** Free public feeds of recipe publishers. Checked 22 Sep 2026; a dead one just yields nothing. */
export const FEEDS: { name: string; url: string }[] = [
  { name: 'Bon Appétit', url: 'https://www.bonappetit.com/feed/recipes/rss' },
  { name: 'BBC Good Food', url: 'https://www.bbcgoodfood.com/feed' },
  { name: 'The Kitchn', url: 'https://www.thekitchn.com/main.rss' },
  { name: 'Smitten Kitchen', url: 'https://smittenkitchen.com/feed/' },
  { name: 'Budget Bytes', url: 'https://www.budgetbytes.com/feed/' },
  { name: 'RecipeTin Eats', url: 'https://www.recipetineats.com/feed/' },
  { name: 'Skinnytaste', url: 'https://www.skinnytaste.com/feed/' },
  { name: 'Minimalist Baker', url: 'https://minimalistbaker.com/feed/' },
  { name: 'Cookie and Kate', url: 'https://cookieandkate.com/feed/' },
  { name: 'Half Baked Harvest', url: 'https://www.halfbakedharvest.com/feed/' },
  { name: 'Love and Lemons', url: 'https://www.loveandlemons.com/feed/' },
  { name: 'Pinch of Yum', url: 'https://pinchofyum.com/feed' },
  { name: 'Ambitious Kitchen', url: 'https://www.ambitiouskitchen.com/feed/' },
];

export const TRENDS_KEY = 'trends:current';
export const BANK_KEY = 'bank:recipes';
/** Refresh when older than this (the Monday cron normally beats it). */
export const TRENDS_MAX_AGE_MS = 8 * 86_400_000;
const PER_FEED = 12;
const MAX_ITEMS = 150;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  '#8217': '’',
  '#8216': '‘',
  '#8220': '“',
  '#8221': '”',
  '#8211': '–',
  '#8212': '—',
  nbsp: ' ',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e in ENTITIES) return ENTITIES[e]!;
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return m;
  });
}

function text(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return undefined;
  const inner = m[1]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  return decodeEntities(inner.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** RSS 2.0 `<item>` or Atom `<entry>`: titles with a date when present. */
export function parseFeed(xml: string, source: string): TrendItem[] {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const out: TrendItem[] = [];
  for (const b of blocks) {
    const title = text(b, 'title');
    if (!title || title.length < 4 || title.length > 140) continue;
    const raw =
      text(b, 'pubDate') ?? text(b, 'published') ?? text(b, 'updated') ?? text(b, 'dc:date');
    const d = raw ? new Date(raw) : undefined;
    out.push({
      title,
      source,
      ...(d && !Number.isNaN(d.getTime()) ? { date: d.toISOString().slice(0, 10) } : {}),
    });
    if (out.length >= PER_FEED) break;
  }
  return out;
}

/** Pulls every feed (failures are skipped) and keeps the newest titles, publishers interleaved. */
export async function fetchTrends(
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<Trends> {
  const results = await Promise.all(
    FEEDS.map(async (f) => {
      try {
        const res = await fetchImpl(f.url, {
          headers: {
            'user-agent': 'Kalib/0.16 (+https://kalib.kalib.workers.dev)',
            accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return [];
        return parseFeed(await res.text(), f.name);
      } catch {
        return [];
      }
    }),
  );
  const cutoff = new Date(now.getTime() - 21 * 86_400_000).toISOString().slice(0, 10);
  const fresh = results.map((items) => items.filter((i) => !i.date || i.date >= cutoff));
  const items: TrendItem[] = [];
  for (let i = 0; items.length < MAX_ITEMS; i++) {
    let any = false;
    for (const list of fresh) {
      const it = list[i];
      if (it) {
        items.push(it);
        any = true;
      }
    }
    if (!any) break;
  }
  return { updated_at: now.toISOString(), items };
}

export function trendsStale(t: Trends | null, now = new Date()): boolean {
  if (!t || t.items.length === 0) return true;
  return now.getTime() - new Date(t.updated_at).getTime() > TRENDS_MAX_AGE_MS;
}

/** A varied sample of titles for the prompt: `n` at most, spread across publishers. */
export function sampleTrends(t: Trends | null, n: number, seed = Date.now()): TrendItem[] {
  if (!t || t.items.length === 0) return [];
  // Deterministic shuffle from the seed so tests are stable.
  let s = seed >>> 0 || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const items = [...t.items];
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items.slice(0, n);
}

// ---- the bank: recipes people kept, content only, growing with every accepted card ----

export interface BankRecipe {
  name: string;
  blurb: string;
  tags: string[];
  portions: number;
  time_min: number;
  oven_c?: number;
  ingredients: unknown[];
  steps: string[];
  inspiration?: string;
  /** How many times someone kept it. */
  kept: number;
  first_kept: string;
}

export const BANK_MAX = 500;

export function addToBank(
  bank: BankRecipe[],
  recipe: Omit<BankRecipe, 'kept' | 'first_kept'>,
  now = new Date(),
): BankRecipe[] {
  const key = recipe.name.trim().toLowerCase();
  const existing = bank.find((b) => b.name.trim().toLowerCase() === key);
  if (existing) {
    existing.kept++;
    return bank;
  }
  const next = [...bank, { ...recipe, kept: 1, first_kept: now.toISOString().slice(0, 10) }];
  // When full, the least-kept oldest entries go first.
  if (next.length > BANK_MAX) {
    next.sort((a, b) => b.kept - a.kept || b.first_kept.localeCompare(a.first_kept));
    next.length = BANK_MAX;
  }
  return next;
}

/** Up to `n` bank recipes the user has not seen, kept-count weighted, varied by seed. */
export function pickFromBank(
  bank: BankRecipe[],
  exclude: readonly string[],
  n: number,
  seed = Date.now(),
): BankRecipe[] {
  const ex = new Set(exclude.map((e) => e.trim().toLowerCase()));
  const pool = bank.filter((b) => !ex.has(b.name.trim().toLowerCase()));
  let s = seed >>> 0 || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const out: BankRecipe[] = [];
  while (pool.length && out.length < n) {
    const total = pool.reduce((a, b) => a + b.kept, 0);
    let r = rnd() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx]!.kept;
      if (r <= 0) break;
    }
    out.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0]!);
  }
  return out;
}
