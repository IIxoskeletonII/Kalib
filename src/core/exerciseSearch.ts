// SPEC §20.2 — finding an exercise by what people type.
//
// Ranking differs from food search in one way that matters. USDA names lead with the food and
// qualify afterwards ("Oil, olive, salad or cooking"), so matching the head noun is everything.
// Exercise names qualify in front ("Barbell Reverse Grip Decline Bench Press"), so a query of
// "bench" matches that one exactly as well as it matches "Barbell Bench Press". The plain
// movement is nearly always what was meant, so brevity carries real weight here and a long name
// has to earn its place through an exact match on the words that make it long.
import { bestTokenScore, tokenize } from './text';
import type { Exercise, ExerciseCategory, Muscle } from './types';

export interface ExerciseDoc {
  id: string;
  name: string;
  equipment: string;
  primary_muscle: Muscle;
  /** Kept on the doc so a muscle filter can match work that trains it indirectly. */
  secondary_muscles: Muscle[];
  category: ExerciseCategory;
  custom: boolean;
  /** One of the exercises a gym actually works from (§20.19): shown first, ranked first. */
  popular: boolean;
  /** Basename of the demo, so a result can show the movement without a second read. */
  media?: string;
  tokens: string[];
  /** The whole name, normalised, so typing it exactly is recognised as meaning exactly it. */
  nameKey: string;
  /**
   * The hand-written shorthand, normalised whole, for the same reason: "bb row" is not three
   * stray words. Derived aliases are deliberately left out — they strip the equipment word, so
   * four exercises would each insist they are "squat".
   */
  shorthandKeys: string[];
  /** Words in the displayed name, for the brevity bonus; aliases must not inflate it. */
  nameLength: number;
}

export interface ExerciseHit extends ExerciseDoc {
  score: number;
}

export function buildExerciseDoc(e: {
  id: string;
  name: string;
  aliases?: string[] | undefined;
  shorthand?: string[] | undefined;
  equipment: string;
  primary_muscle: Muscle;
  secondary_muscles?: Muscle[] | undefined;
  category: ExerciseCategory;
  media?: string | undefined;
  popular?: boolean | undefined;
  source: Exercise['source'];
}): ExerciseDoc {
  // Aliases join the index but not the name, so a hit on "rdl" still shows "Barbell Romanian
  // Deadlift" — the name the gym's chart uses.
  const nameTokens = tokenize(e.name);
  return {
    id: e.id,
    name: e.name,
    equipment: e.equipment,
    primary_muscle: e.primary_muscle,
    secondary_muscles: e.secondary_muscles ?? [],
    category: e.category,
    custom: e.source === 'custom',
    popular: e.popular === true,
    ...(e.media ? { media: e.media } : {}),
    tokens: tokenize([e.name, ...(e.aliases ?? [])].join(' ')),
    nameKey: nameTokens.join(' '),
    shorthandKeys: (e.shorthand ?? []).map((a) => tokenize(a).join(' ')).filter(Boolean),
    nameLength: nameTokens.length,
  };
}

/**
 * What a bare movement name means by default. Someone typing "bench press" means a barbell, and
 * the library has eleven other things that phrase also describes. Small, so it only ever breaks
 * a tie between otherwise equal matches.
 */
const EQUIPMENT_BOOST: Record<string, number> = {
  barbell: 0.35,
  dumbbell: 0.3,
  cable: 0.25,
  'leverage machine': 0.2,
  'body weight': 0.2,
  'smith machine': 0.12,
  'ez barbell': 0.1,
  kettlebell: 0.1,
};

/** Strength first: someone typing "squat" wants to load a bar, not a hip-opener. */
const CATEGORY_BOOST: Record<ExerciseCategory, number> = {
  strength: 0.6,
  plyometrics: 0.2,
  cardio: 0.1,
  mobility: 0,
  stretching: 0,
  balance: 0,
  rehabilitation: 0,
};

/**
 * What a popular exercise is worth over an obscure one that matches as well. Enough that "fly"
 * means the chest fly before "Cable Incline Fly (on Stability Ball)"; not so much that it beats
 * a name typed in full, which is worth 2.5.
 */
export const POPULAR_BOOST = 1;

/** Damerau–Levenshtein distance of at most one, decided without building the matrix. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    // One substitution, or two neighbours swapped.
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  // One letter missing or one extra.
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** How often each word appears across a catalogue, for choosing what a typo meant. */
const vocabularies = new WeakMap<readonly ExerciseDoc[], Map<string, number>>();

function vocabulary(docs: readonly ExerciseDoc[]): Map<string, number> {
  let v = vocabularies.get(docs);
  if (!v) {
    v = new Map();
    for (const d of docs) for (const t of d.tokens) v.set(t, (v.get(t) ?? 0) + 1);
    vocabularies.set(docs, v);
  }
  return v;
}

/**
 * A query with its slips corrected against the catalogue's own words: "incline dumbell press"
 * becomes "incline dumbbell press", and from there is the same search as if it had been typed
 * right — including the decisive full-phrase match, which a per-word fuzzy score would miss.
 *
 * Only words of five letters or more are touched — "row" one letter off is "raw", "rod" or
 * "tow" — and only ones that are not words of the catalogue as typed. Then:
 *
 *   - the last word may still be being typed, so if it starts a real word it is left alone and
 *     matches as a prefix, as it always has;
 *   - an earlier word is finished, so one that only starts a real word was cut short: "barbel
 *     row" is "barbell row", not every row that happens to use a barbell;
 *   - a word that starts nothing is a slip, corrected to a word one letter away — wrong,
 *     missing, extra, or two swapped.
 *
 * When several words qualify, the commonest wins, since that is the likelier one.
 */
export function correctQuery(q: readonly string[], docs: readonly ExerciseDoc[]): string[] {
  const vocab = vocabulary(docs);
  return q.map((t, i) => {
    if (t.length < 5 || vocab.has(t)) return t;
    let completion: string | undefined;
    let completionCount = 0;
    for (const [w, n] of vocab) {
      if (w.startsWith(t) && n > completionCount) {
        completion = w;
        completionCount = n;
      }
    }
    if (completion) return i === q.length - 1 ? t : completion;
    let best: string | undefined;
    let bestCount = 0;
    for (const [w, n] of vocab) {
      if (w.length >= 5 && n > bestCount && withinOneEdit(t, w)) {
        best = w;
        bestCount = n;
      }
    }
    return best ?? t;
  });
}

export function searchExercises(
  docs: readonly ExerciseDoc[],
  query: string,
  usage: ReadonlyMap<string, number> = new Map(),
  limit = 40,
): ExerciseHit[] {
  const typed = tokenize(query);
  if (typed.length === 0) return [];
  const q = correctQuery(typed, docs);
  const qKey = q.join(' ');
  const out: ExerciseHit[] = [];

  for (const doc of docs) {
    let sum = 0;
    let missed = false;
    for (const t of q) {
      const s = bestTokenScore(t, doc.tokens);
      // Every word has to land somewhere, or "incline bench" would return every bench.
      if (s === 0) {
        missed = true;
        break;
      }
      sum += s;
    }
    if (missed) continue;

    const quality = sum / q.length;
    // Each extra word beyond the query is a qualifier the person did not ask for. Capped, so a
    // genuinely long name someone spelled out in full is not buried.
    const brevity = -Math.min(1.2, 0.18 * Math.max(0, doc.nameLength - q.length));
    // Typing a name or a known shorthand in full is a statement of intent, not a coincidence of
    // words: "bench" is the bench press, not Bench Hip Extension, which merely starts with it.
    const exact = doc.nameKey === qKey ? 2.5 : doc.shorthandKeys.includes(qKey) ? 2.2 : 0;
    const used = usage.get(doc.id) ?? 0;
    const score =
      quality +
      exact +
      brevity +
      CATEGORY_BOOST[doc.category] +
      (EQUIPMENT_BOOST[doc.equipment.toLowerCase()] ?? 0) +
      (doc.custom ? 1.5 : 0) +
      (doc.popular ? POPULAR_BOOST : 0) +
      Math.log1p(used) * 0.6;
    out.push({ ...doc, score });
  }

  out.sort(
    (a, b) => b.score - a.score || a.nameLength - b.nameLength || (a.name < b.name ? -1 : 1),
  );
  return out.slice(0, limit);
}

/** Match quality alone, 0–3, for grounding a model's exercise name against the catalogue (§20.7). */
export function exerciseMatchQuality(doc: ExerciseDoc, query: string): number {
  const q = tokenize(query);
  if (q.length === 0) return 0;
  let sum = 0;
  for (const t of q) {
    const s = bestTokenScore(t, doc.tokens);
    if (s === 0) return 0;
    sum += s;
  }
  return sum / q.length;
}
