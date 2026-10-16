// Which country's menus you are looking at (SPEC §21).
//
// A Big Mac is 510 kcal in Italy, 560 in Oman and 540 in the United States. Three real numbers
// for three different sandwiches, and a search that returned all three would be worse than
// useless — you would have to know which was which before you could trust any of them.
//
// So one market is current at a time and search shows only that one. The market is derived from
// the phone's own time zone rather than asked for, because the phone already knows: it is the
// one setting that can be right without a question. It is never changed silently, though —
// macros moving under you while you are mid-log is a worse failure than showing the wrong
// country's menu, so a change is always offered and never applied on its own.
//
// Only chain foods have a market. A national food table is not a menu.

/** The markets with chain data. ISO 3166-1 alpha-2, lowercased in storage keys. */
export const MARKETS = ['IT', 'OM', 'AE', 'SA', 'US'] as const;
export type Market = (typeof MARKETS)[number];

export const MARKET_NAME: Record<Market, string> = {
  IT: 'Italy',
  OM: 'Oman',
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  US: 'United States',
};

/**
 * Markets whose menus are the same menu.
 *
 * The Gulf chains run one regional menu: of the 72 Domino's items that appear in both the
 * Omani and the Emirati published tables, **all 72 agree within 2%** — not one differs. So a
 * Dubai figure answers an Omani question, and the Emirati table is the larger of the two (128
 * rows against 74), which means grouping them adds items Oman never published rather than
 * merely avoiding an empty result.
 *
 * Grouping is never across regions. Standing in Muscat you may be shown a figure published in
 * Dubai; you are never shown one published in Milan, because an Italian Big Mac is a different
 * sandwich and saying otherwise would be a lie dressed as a convenience.
 */
export type Region = 'gcc' | 'eu' | 'us';

export const REGION: Record<Market, Region> = {
  IT: 'eu',
  OM: 'gcc',
  AE: 'gcc',
  SA: 'gcc',
  US: 'us',
};

/**
 * The markets that may answer for this one, the person's own first.
 *
 * Order matters: a row from your own country wins over an identical row from next door, so
 * that the common case needs no explanation and only the borrowed rows carry a label.
 */
export function marketsFor(current: Market): Market[] {
  const siblings = MARKETS.filter((m) => m !== current && REGION[m] === REGION[current]);
  return [current, ...siblings];
}

/** How to say where a figure came from, or nothing when it came from where you are. */
export function borrowedFrom(item: Market, current: Market): string | undefined {
  return item === current ? undefined : MARKET_NAME[item];
}

/** The settings key. Synced, so both phones agree on where you are. */
export const MARKET_KEY = 'chain_market';

export function isMarket(v: unknown): v is Market {
  return typeof v === 'string' && (MARKETS as readonly string[]).includes(v);
}

/**
 * IANA zones that mean a market we carry.
 *
 * Listed rather than inferred from a country-code library: three markets do not justify a
 * dependency, and an explicit list is the thing a reader can check. Zones are matched exactly,
 * then by region prefix, so `America/Detroit` lands on the United States without naming every
 * American city.
 */
const ZONE_TO_MARKET: ReadonlyArray<readonly [RegExp, Market]> = [
  [/^Europe\/(Rome|Vatican|San_Marino|Busingen)$/, 'IT'],
  [/^Asia\/Muscat$/, 'OM'],
  // The Emirates is its own market now that it has its own data. It previously fell through
  // to Oman on the grounds that the Gulf menu is shared — a reasonable guess, and wrong once
  // there was a real alternative.
  [/^Asia\/Dubai$/, 'AE'],
  [/^Asia\/Riyadh$/, 'SA'],
  // Named, not prefixed. `^America/` would also catch São Paulo, Mexico City and Toronto, and
  // would hand a Brazilian an American menu — which is exactly the mixing this module exists
  // to stop. The `US/` forms are the deprecated aliases some devices still report.
  [
    /^America\/(New_York|Chicago|Denver|Phoenix|Los_Angeles|Anchorage|Adak|Juneau|Sitka|Nome|Yakutat|Metlakatla|Boise|Detroit|Menominee|Indiana\/\w+|Kentucky\/\w+|North_Dakota\/\w+)$/,
    'US',
  ],
  [/^US\//, 'US'],
  [/^Pacific\/(Honolulu|Midway|Wake)$/, 'US'],
];

/**
 * The market a time zone implies, or undefined when it is somewhere we have no data for.
 *
 * Undefined is a real answer and the common one — most of the world is not one of three
 * countries — so callers must handle it rather than defaulting to a market the person is not in.
 */
export function marketForZone(zone: string | undefined): Market | undefined {
  if (!zone) return undefined;
  for (const [pattern, market] of ZONE_TO_MARKET) {
    if (pattern.test(zone)) return market;
  }
  return undefined;
}

/**
 * What to do on launch, given where the phone thinks it is and what was last chosen.
 *
 * `offer` is the only way the market ever changes after the first run. The first run may set it
 * outright, because there is nothing to disturb and no question worth asking.
 */
export type MarketDecision =
  | { action: 'keep'; market: Market | undefined }
  | { action: 'adopt'; market: Market }
  | { action: 'offer'; market: Market; from: Market };

export function decideMarket(stored: unknown, zone: string | undefined): MarketDecision {
  const here = marketForZone(zone);
  const chosen = isMarket(stored) ? stored : undefined;

  if (!chosen)
    return here ? { action: 'adopt', market: here } : { action: 'keep', market: undefined };
  if (!here || here === chosen) return { action: 'keep', market: chosen };
  return { action: 'offer', market: here, from: chosen };
}

/** The phone's current zone, or undefined where the browser will not say. */
export function deviceZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
