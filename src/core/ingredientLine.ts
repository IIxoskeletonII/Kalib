// SPEC §8.2 — reading the ingredient lines a recipe page publishes.
//
// A recipe site writes "250 g red lentils", "2 tbsp olive oil", "1 tin chopped tomatoes",
// "salt and pepper to taste". Every one of those has to become a weight and a database search
// before it can be a recipe here, and none of them says so in the same way.
//
// This module does the reading and nothing else: no database, no matching, no guessing at what
// an onion weighs. A bare count ("2 eggs") deliberately comes back *without* grams, because the
// food's own portions answer that question far better than a table of averages would — see
// `core/units.ts`, which already knows that an egg is 50 g because USDA says so.
//
// Anything it cannot read comes back with `grams: undefined` and is shown to the person, never
// silently dropped or invented.

/** How a line's weight was arrived at, so the review screen can say. */
export type QuantityBasis = 'weight' | 'volume' | 'measure' | 'package' | 'count';

export interface ParsedLine {
  /** The line exactly as published. */
  raw: string;
  /** Grams for the whole recipe, when the line gives enough to work them out. */
  grams?: number | undefined;
  basis?: QuantityBasis | undefined;
  /** The count, for a line like "2 eggs" whose weight the matched food has to supply. */
  count?: number | undefined;
  /** Two to four generic words to search the food database with. */
  term: string;
  /** What to call it in the list. */
  name: string;
  /** Seasoning with no quantity — safe to leave out of the macros. */
  seasoning: boolean;
}

/** Grams per unit. Volumes assume water density, which is what a recipe writer means. */
const UNITS: Record<string, { grams: number; basis: QuantityBasis }> = {
  g: { grams: 1, basis: 'weight' },
  gr: { grams: 1, basis: 'weight' },
  gram: { grams: 1, basis: 'weight' },
  grams: { grams: 1, basis: 'weight' },
  gramme: { grams: 1, basis: 'weight' },
  grammes: { grams: 1, basis: 'weight' },
  kg: { grams: 1000, basis: 'weight' },
  kilo: { grams: 1000, basis: 'weight' },
  kilos: { grams: 1000, basis: 'weight' },
  kilogram: { grams: 1000, basis: 'weight' },
  kilograms: { grams: 1000, basis: 'weight' },
  mg: { grams: 0.001, basis: 'weight' },
  oz: { grams: 28.35, basis: 'weight' },
  ounce: { grams: 28.35, basis: 'weight' },
  ounces: { grams: 28.35, basis: 'weight' },
  lb: { grams: 453.6, basis: 'weight' },
  lbs: { grams: 453.6, basis: 'weight' },
  pound: { grams: 453.6, basis: 'weight' },
  pounds: { grams: 453.6, basis: 'weight' },
  ml: { grams: 1, basis: 'volume' },
  millilitre: { grams: 1, basis: 'volume' },
  millilitres: { grams: 1, basis: 'volume' },
  milliliter: { grams: 1, basis: 'volume' },
  milliliters: { grams: 1, basis: 'volume' },
  cl: { grams: 10, basis: 'volume' },
  dl: { grams: 100, basis: 'volume' },
  l: { grams: 1000, basis: 'volume' },
  litre: { grams: 1000, basis: 'volume' },
  litres: { grams: 1000, basis: 'volume' },
  liter: { grams: 1000, basis: 'volume' },
  liters: { grams: 1000, basis: 'volume' },
  tsp: { grams: 5, basis: 'measure' },
  teaspoon: { grams: 5, basis: 'measure' },
  teaspoons: { grams: 5, basis: 'measure' },
  tbsp: { grams: 15, basis: 'measure' },
  tbs: { grams: 15, basis: 'measure' },
  tablespoon: { grams: 15, basis: 'measure' },
  tablespoons: { grams: 15, basis: 'measure' },
  cup: { grams: 240, basis: 'measure' },
  cups: { grams: 240, basis: 'measure' },
  pinch: { grams: 0.5, basis: 'measure' },
  pinches: { grams: 0.5, basis: 'measure' },
  handful: { grams: 30, basis: 'measure' },
  handfuls: { grams: 30, basis: 'measure' },
  clove: { grams: 3, basis: 'measure' },
  cloves: { grams: 3, basis: 'measure' },
  slice: { grams: 25, basis: 'measure' },
  slices: { grams: 25, basis: 'measure' },
  rasher: { grams: 25, basis: 'measure' },
  rashers: { grams: 25, basis: 'measure' },
  sprig: { grams: 2, basis: 'measure' },
  sprigs: { grams: 2, basis: 'measure' },
  can: { grams: 400, basis: 'package' },
  cans: { grams: 400, basis: 'package' },
  tin: { grams: 400, basis: 'package' },
  tins: { grams: 400, basis: 'package' },
  jar: { grams: 350, basis: 'package' },
  jars: { grams: 350, basis: 'package' },
  packet: { grams: 250, basis: 'package' },
  packets: { grams: 250, basis: 'package' },
  pack: { grams: 250, basis: 'package' },
  packs: { grams: 250, basis: 'package' },
};

/** Words that describe preparation rather than the food, and only get in a search's way. */
const NOISE = new Set([
  'fresh',
  'freshly',
  'dried',
  'ground',
  'chopped',
  'finely',
  'roughly',
  'thinly',
  'sliced',
  'diced',
  'minced',
  'grated',
  'crushed',
  'peeled',
  'trimmed',
  'rinsed',
  'drained',
  'large',
  'small',
  'medium',
  'ripe',
  'raw',
  'good',
  'quality',
  'extra',
  'plus',
  'more',
  'optional',
  'taste',
  'serve',
  'serving',
  'garnish',
  'about',
  'approximately',
  'roughly',
  'plenty',
  'of',
  'to',
  'for',
  'and',
  'or',
  'the',
  'a',
  'an',
  'with',
  'into',
  'at',
  'room',
  'temperature',
  'cut',
  'halved',
  'quartered',
  'deseeded',
  'seeded',
  'stoned',
  'zest',
  'juice',
  'few',
  'handful',
  'knob',
  'splash',
  'drizzle',
  'good-quality',
]);

/** Lines that are seasoning and carry no useful quantity. */
const SEASONING =
  /^(salt|pepper|sea salt|black pepper|salt and pepper|salt & pepper|freshly ground black pepper|seasoning)\b/i;

/** "500 g *of* flour", and the same connector in Italian and French recipes. */
const OF = /^\s*(?:of|di|de)\s+/i;

const VULGAR: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

/** "1", "1.5", "1/2", "1 1/2", "½", "1½", "2-3" (takes the lower bound). */
export function parseQuantity(text: string): { value: number; rest: string } | undefined {
  let s = text.trimStart();
  // Expand a leading vulgar fraction, with or without a whole number in front of it.
  for (const [glyph, value] of Object.entries(VULGAR)) {
    if (s.startsWith(glyph)) {
      s = s.slice(glyph.length);
      return { value, rest: s };
    }
    const m = new RegExp(`^(\\d+)\\s*${glyph}`).exec(s);
    if (m) return { value: Number(m[1]) + value, rest: s.slice(m[0].length) };
  }
  // A range means "somewhere between"; the lower bound is the honest choice.
  const range = /^(\d+(?:[.,]\d+)?)\s*(?:-|–|to)\s*\d+(?:[.,]\d+)?/.exec(s);
  if (range) return { value: Number(range[1]!.replace(',', '.')), rest: s.slice(range[0].length) };
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)/.exec(s);
  if (mixed) {
    return {
      value: Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]),
      rest: s.slice(mixed[0].length),
    };
  }
  const fraction = /^(\d+)\s*\/\s*(\d+)/.exec(s);
  if (fraction) {
    return { value: Number(fraction[1]) / Number(fraction[2]), rest: s.slice(fraction[0].length) };
  }
  const plain = /^(\d+(?:[.,]\d+)?)/.exec(s);
  if (plain) return { value: Number(plain[1]!.replace(',', '.')), rest: s.slice(plain[0].length) };
  return undefined;
}

/** Strips preparation words and punctuation down to something worth searching for. */
export function searchTermFor(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-zÀ-ɏ\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NOISE.has(w));
  return words.slice(0, 4).join(' ');
}

function tidy(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[,;].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read one published ingredient line. Weight and volume become grams; a bare count comes back
 * as `count` for the matched food's own portions to resolve.
 */
export function parseIngredientLine(raw: string): ParsedLine {
  const line = raw.replace(/\s+/g, ' ').trim();
  if (line === '') return { raw, term: '', name: '', seasoning: true };
  if (SEASONING.test(line)) {
    return { raw, term: searchTermFor(line), name: tidy(line), seasoning: true };
  }

  const q = parseQuantity(line);
  if (!q) {
    const name = tidy(line);
    return { raw, term: searchTermFor(name), name, seasoning: false };
  }

  let rest = q.rest.trimStart();

  // An optional unit word: "250 *g* flour", "1 *tin* tomatoes".
  const unitMatch = /^([a-zÀ-ɏ]+)\.?\b/i.exec(rest);
  const unitWord = unitMatch?.[1]?.toLowerCase();
  const unit = unitWord ? UNITS[unitWord] : undefined;
  if (unit) rest = rest.slice(unitMatch![0].length);
  rest = rest.trimStart();

  // A weight printed in brackets beats every assumption on the line, whether it follows
  // the count or the unit: "1 tin (400 g) chopped tomatoes".
  const bracketed = /^\(\s*(\d+(?:[.,]\d+)?)\s*(g|gr|grams?|kg|ml|l|oz|lb)\s*\)/i.exec(rest);
  if (bracketed) {
    const inner = UNITS[bracketed[2]!.toLowerCase()];
    const printed = tidy(rest.slice(bracketed[0].length).replace(OF, ' '));
    return {
      raw,
      grams: q.value * Number(bracketed[1]!.replace(',', '.')) * (inner?.grams ?? 1),
      basis: 'weight',
      term: searchTermFor(printed),
      name: printed,
      seasoning: false,
    };
  }

  // "500 g of flour" / "2 cups of rice"
  const name = tidy(rest.replace(OF, ' '));
  if (unit) {
    return {
      raw,
      grams: q.value * unit.grams,
      basis: unit.basis,
      term: searchTermFor(name),
      name,
      seasoning: false,
    };
  }

  return {
    raw,
    count: q.value,
    basis: 'count',
    term: searchTermFor(name),
    name,
    seasoning: false,
  };
}

/** Read a whole published list, dropping only the blank lines. */
export function parseIngredientLines(lines: readonly string[]): ParsedLine[] {
  return lines.map((l) => parseIngredientLine(l)).filter((p) => p.name !== '' || !p.seasoning);
}
