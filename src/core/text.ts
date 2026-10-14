// Token matching shared by every search in the app (§7.3, §20.2).
//
// Extracted from core/search.ts when exercise search arrived: the two searches rank completely
// differently — a food cares which table it came from and whether it is "dried" or "canned", an
// exercise cares about equipment and which muscle it trains — but they agree entirely on what
// counts as a word and on the fact that people type plurals at singular names and the reverse.
// Keeping one copy of that means a fix to it fixes both.

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** "eggs" → "egg", "berries" → "berry"; catalogue names are singular, people type either. */
export function singular(q: string): string | undefined {
  if (q.length < 4) return undefined;
  if (q.endsWith('ies')) return q.slice(0, -3) + 'y';
  if (q.endsWith('es') && /[sxz]es$|[cs]hes$/.test(q)) return q.slice(0, -2);
  if (q.endsWith('s') && !q.endsWith('ss')) return q.slice(0, -1);
  return undefined;
}

/** One query token against one document token: 3 exact, ~2.9 plural, 2–2.5 prefix, 0 nothing. */
export function matchToken(q: string, t: string): number {
  if (t === q) return 3;
  // Plural either way is as good as exact: "banana" ↔ "bananas", "eggs" ↔ "egg".
  if (t === q + 's' || t === q + 'es') return 2.9;
  const sg = singular(q);
  if (sg && t === sg) return 2.9;
  if (t.startsWith(q)) return 2;
  if (sg && t.startsWith(sg)) return 2.5;
  return 0;
}

/**
 * Best match of a query token against a document's tokens, with a small penalty the further
 * into the name the match sits: the nearer the front, the more the name is about it.
 */
export function bestTokenScore(q: string, tokens: readonly string[]): number {
  let best = 0;
  for (let i = 0; i < tokens.length; i++) {
    const s = matchToken(q, tokens[i]!);
    if (s > 0 && s - Math.min(0.4, 0.05 * i) > best) best = s - Math.min(0.4, 0.05 * i);
  }
  return best;
}
