import { describe, expect, it } from 'vitest';
import {
  addToBank,
  decodeEntities,
  fetchTrends,
  FEEDS,
  parseFeed,
  pickFromBank,
  sampleTrends,
  trendsStale,
  type BankRecipe,
} from './trends';

const RSS = `<?xml version="1.0"?><rss><channel><title>Site</title>
<item><title><![CDATA[Crispy Gnocchi with Brown Butter &amp; Sage]]></title><pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Sheet-Pan Chicken Thighs &#8217; Night</title><pubDate>Tue, 15 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Old soup</title><pubDate>Tue, 01 Jan 2025 10:00:00 GMT</pubDate></item>
<item><title>Big <b>Bold</b> Beans</title></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title>
<entry><title>Miso Butter Salmon</title><published>2026-09-20T08:00:00Z</published></entry></feed>`;

describe('parseFeed', () => {
  it('reads RSS and Atom titles with dates, stripping CDATA, tags and entities', () => {
    const rss = parseFeed(RSS, 'Site');
    expect(rss.map((i) => i.title)).toEqual([
      'Crispy Gnocchi with Brown Butter & Sage',
      'Sheet-Pan Chicken Thighs ’ Night',
      'Old soup',
      'Big Bold Beans',
    ]);
    expect(rss[0]!.date).toBe('2026-09-21');
    expect(rss[3]!.date).toBeUndefined();
    expect(parseFeed(ATOM, 'Blog')).toEqual([
      { title: 'Miso Butter Salmon', source: 'Blog', date: '2026-09-20' },
    ]);
  });

  it('decodes numeric and named entities', () => {
    expect(decodeEntities('Mac &amp; Cheese &#8212; fast &#x2019;n easy &apos;ok&apos;')).toBe(
      "Mac & Cheese — fast ’n easy 'ok'",
    );
  });
});

describe('fetchTrends', () => {
  it('interleaves publishers, drops old items, and survives dead feeds', async () => {
    const now = new Date('2026-09-22T09:00:00Z');
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('bonappetit')) return new Response(RSS);
      if (u.includes('smittenkitchen')) return new Response(ATOM);
      if (u.includes('bbcgoodfood')) return new Response('nope', { status: 402 });
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const t = await fetchTrends(fetchImpl, now);
    expect(t.updated_at).toBe(now.toISOString());
    expect(t.items.map((i) => i.title)).toEqual([
      'Crispy Gnocchi with Brown Butter & Sage',
      'Miso Butter Salmon',
      'Sheet-Pan Chicken Thighs ’ Night',
      'Big Bold Beans',
    ]);
    expect(FEEDS.length).toBeGreaterThan(8);
  });

  it('knows when it is stale and samples deterministically', () => {
    const t = { updated_at: '2026-09-01T00:00:00Z', items: [{ title: 'a', source: 's' }] };
    expect(trendsStale(t, new Date('2026-09-22T00:00:00Z'))).toBe(true);
    expect(trendsStale(t, new Date('2026-09-05T00:00:00Z'))).toBe(false);
    expect(trendsStale(null)).toBe(true);
    const many = {
      updated_at: '2026-09-22T00:00:00Z',
      items: Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, source: 's' })),
    };
    const a = sampleTrends(many, 5, 7).map((i) => i.title);
    const b = sampleTrends(many, 5, 7).map((i) => i.title);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(5);
  });
});

describe('bank', () => {
  const base = { blurb: '', tags: [], portions: 4, time_min: 30, ingredients: [], steps: [] };
  it('grows with new recipes and counts repeats', () => {
    let bank: BankRecipe[] = [];
    bank = addToBank(bank, { ...base, name: 'Dal' }, new Date('2026-09-22'));
    bank = addToBank(bank, { ...base, name: 'dal ' }, new Date('2026-09-23'));
    bank = addToBank(bank, { ...base, name: 'Ragu' }, new Date('2026-09-23'));
    expect(bank.map((b) => [b.name, b.kept])).toEqual([
      ['Dal', 2],
      ['Ragu', 1],
    ]);
  });

  it('picks what the user has not seen, weighted by how often it was kept', () => {
    const bank: BankRecipe[] = [
      { ...base, name: 'A', kept: 50, first_kept: '2026-09-01' },
      { ...base, name: 'B', kept: 1, first_kept: '2026-09-01' },
      { ...base, name: 'C', kept: 1, first_kept: '2026-09-01' },
    ];
    const picked = pickFromBank(bank, ['a'], 2, 3);
    expect(picked.map((p) => p.name).sort()).toEqual(['B', 'C']);
    expect(pickFromBank(bank, [], 5, 1)).toHaveLength(3);
    expect(pickFromBank([], [], 2)).toEqual([]);
  });
});
