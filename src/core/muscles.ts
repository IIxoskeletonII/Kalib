// SPEC §20.2 — normalising the open exercise library onto the muscles volume is counted against.
//
// The library names its primary target with 19 terms and its secondary muscles with 75, and the
// two vocabularies disagree with each other: `quads` and `quadriceps`, `delts` and `deltoids`
// and `shoulders`, `traps` and `trapezius` and `upper trapezius` all appear. Left alone, "sets
// for shoulders this week" would count a third of the sets that actually trained them. Anything
// unrecognised is dropped rather than guessed at, because a wrong muscle is worse than a missing
// one: §20.5 reports coverage gaps, and a gap invented by a typo would send someone to the gym
// for no reason.
import type { Muscle } from './types';

const ALIASES: Record<string, Muscle> = {
  // chest
  pectorals: 'chest',
  chest: 'chest',
  'upper chest': 'chest',
  // back
  lats: 'lats',
  'latissimus dorsi': 'lats',
  'upper back': 'upper back',
  back: 'upper back',
  rhomboids: 'upper back',
  traps: 'traps',
  trapezius: 'traps',
  'upper trapezius': 'traps',
  'lower back': 'lower back',
  spine: 'lower back',
  // shoulders and arms
  delts: 'shoulders',
  deltoids: 'shoulders',
  shoulders: 'shoulders',
  'rear deltoids': 'shoulders',
  'rotator cuff': 'shoulders',
  'serratus anterior': 'shoulders',
  biceps: 'biceps',
  brachialis: 'biceps',
  triceps: 'triceps',
  forearms: 'forearms',
  'wrist flexors': 'forearms',
  'wrist extensors': 'forearms',
  wrists: 'forearms',
  hands: 'forearms',
  'grip muscles': 'forearms',
  // legs
  quads: 'quads',
  quadriceps: 'quads',
  hamstrings: 'hamstrings',
  glutes: 'glutes',
  'gluteus medius': 'glutes',
  'gluteus minimus': 'glutes',
  'gluteus medius (posterior fibers)': 'glutes',
  piriformis: 'glutes',
  'obturator internus': 'glutes',
  'obturator internus/externus': 'glutes',
  'gemellus superior/inferior': 'glutes',
  'hip flexors': 'quads',
  calves: 'calves',
  gastrocnemius: 'calves',
  soleus: 'calves',
  shins: 'calves',
  ankles: 'calves',
  'ankle stabilizers': 'calves',
  feet: 'calves',
  'tibialis anterior': 'calves',
  'tibialis posterior': 'calves',
  'peroneus longus': 'calves',
  'peroneus brevis': 'calves',
  'peroneus tertius': 'calves',
  'extensor digitorum longus': 'calves',
  'extensor hallucis longus': 'calves',
  'flexor digitorum longus': 'calves',
  'flexor hallucis longus': 'calves',
  adductors: 'adductors',
  'inner thighs': 'adductors',
  groin: 'adductors',
  abductors: 'abductors',
  // trunk
  abs: 'abs',
  abdominals: 'abs',
  'lower abs': 'abs',
  core: 'abs',
  obliques: 'obliques',
  // neck
  neck: 'neck',
  'levator scapulae': 'neck',
  sternocleidomastoid: 'neck',
  scalenes: 'neck',
  'splenius capitis': 'neck',
  'splenius cervicis': 'neck',
  'semispinalis capitis': 'neck',
  suboccipitals: 'neck',
  'deep cervical flexors': 'neck',
  'longus colli': 'neck',
  'longus capitis': 'neck',
  // whole-body
  'cardiovascular system': 'cardio',
  cardio: 'cardio',
};

/** The library's word for a muscle, or undefined when it names something we do not count. */
export function normaliseMuscle(raw: string): Muscle | undefined {
  return ALIASES[raw.trim().toLowerCase()];
}

/** Normalises a list, dropping unknowns and duplicates while keeping the original order. */
export function normaliseMuscles(raw: readonly string[]): Muscle[] {
  const out: Muscle[] = [];
  for (const r of raw) {
    const m = normaliseMuscle(r);
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

/** How a muscle is written in the UI. Sentence case; the library shouts in places. */
export const MUSCLE_LABEL: Record<Muscle, string> = {
  chest: 'Chest',
  lats: 'Lats',
  'upper back': 'Upper back',
  traps: 'Traps',
  'lower back': 'Lower back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  adductors: 'Adductors',
  abductors: 'Abductors',
  abs: 'Abs',
  obliques: 'Obliques',
  neck: 'Neck',
  cardio: 'Cardio',
};

/**
 * Muscles grouped the way people plan a week, for §20.5's coverage check. `cardio` and `neck`
 * are deliberately outside it: nobody's push/pull/legs split is incomplete without them.
 */
export const MUSCLE_REGIONS: { label: string; muscles: readonly Muscle[] }[] = [
  { label: 'Push', muscles: ['chest', 'shoulders', 'triceps'] },
  { label: 'Pull', muscles: ['lats', 'upper back', 'traps', 'biceps', 'forearms'] },
  { label: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'] },
  { label: 'Core', muscles: ['abs', 'obliques', 'lower back'] },
];
