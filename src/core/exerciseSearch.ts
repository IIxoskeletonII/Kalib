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

export function searchExercises(
  docs: readonly ExerciseDoc[],
  query: string,
  usage: ReadonlyMap<string, number> = new Map(),
  limit = 40,
): ExerciseHit[] {
  const q = tokenize(query);
  if (q.length === 0) return [];
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
