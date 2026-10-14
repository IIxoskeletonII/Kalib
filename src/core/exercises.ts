// SPEC §20.2 — reading the open exercise library into something the app can log against.
//
// Two jobs the library does not do for us. It does not say what a *set* of an exercise is made
// of, so `loadTypeFor` infers it: a plank has no reps, a pull-up has no weight until you hang a
// belt off it, and a treadmill has neither. And it names things the way an anatomy textbook
// would ("Barbell Bent Over Row", "Barbell Full Squat"), not the way anyone standing in a gym
// types them, so `autoAliases` derives the shorthand. Both are pure so they can be tested and
// then reused by the seed script and by custom exercises alike.
import type { ExerciseCategory, LoadType } from './types';

/** Cardio machines that report a distance; the rest are logged as time alone. */
const DISTANCE_MACHINES = new Set([
  'elliptical machine',
  'stationary bike',
  'stepmill machine',
  'skierg machine',
  'upper body ergometer',
]);

/** Movements held rather than repeated, whatever they are loaded with. */
const HELD = /\b(plank|hold|isometric|hang|wall sit|l-?sit|bridge hold|dead hang|superman)\b/i;

/** Movements you can add a belt or a dumbbell to; everything else bodyweight stays bodyweight. */
const LOADABLE_BODYWEIGHT =
  /\b(pull[- ]?up|chin[- ]?up|dip|muscle[- ]?up|push[- ]?up|pullup|chinup)\b/i;

export function loadTypeFor(o: {
  name: string;
  equipment: string;
  category: ExerciseCategory;
}): LoadType {
  const eq = o.equipment.trim().toLowerCase();
  if (o.category === 'cardio') return DISTANCE_MACHINES.has(eq) ? 'distance_time' : 'time';
  // A stretch is held; so is most balance and mobility work. Reps would be the wrong question.
  if (o.category === 'stretching' || o.category === 'mobility' || o.category === 'balance') {
    return 'time';
  }
  if (HELD.test(o.name)) return 'time';
  if (eq === 'weighted') return 'weighted_bodyweight';
  if (eq === 'body weight') {
    return LOADABLE_BODYWEIGHT.test(o.name) ? 'weighted_bodyweight' : 'bodyweight_reps';
  }
  // An assisted machine takes weight off you rather than adding it, so the number on the stack
  // is not load. Reps are the honest measure and the thing that progresses.
  if (eq === 'assisted') return 'bodyweight_reps';
  return 'weight_reps';
}

/** Does a set of this kind carry an external load the user types in? */
export function usesWeight(t: LoadType): boolean {
  return t === 'weight_reps' || t === 'weighted_bodyweight';
}

export function usesReps(t: LoadType): boolean {
  return t === 'weight_reps' || t === 'bodyweight_reps' || t === 'weighted_bodyweight';
}

/** Words the library uses where a gym says something shorter. */
const SHORTHAND: [RegExp, string][] = [
  [/\bbarbell\b/g, 'bb'],
  [/\bdumbbell\b/g, 'db'],
  [/\bkettlebell\b/g, 'kb'],
  [/\bez barbell\b/g, 'ez bar'],
  [/\bresistance band\b/g, 'band'],
  [/\bsmith machine\b/g, 'smith'],
  // The library calls every plate-loaded or selectorised machine a "Lever".
  [/\blever\b/g, 'machine'],
  [/\bsled\b/g, 'machine'],
];

/** Leading equipment words worth stripping, so "Barbell Bench Press" also answers to "bench press". */
const LEADING =
  /^(barbell|dumbbell|kettlebell|cable|lever|smith|ez barbell|band|resistance band|weighted|assisted|sled|olympic barbell|trap bar|medicine ball|stability ball|bosu ball|roller|wheel roller|rope|hammer|tire)\s+/i;

function clean(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9°\- ]/g, '')
    .trim();
}

/**
 * Shorthand for one exercise name. Never includes the name itself: the caller indexes that
 * separately, and a duplicate would double its search weight for no reason.
 */
export function autoAliases(name: string): string[] {
  const base = clean(name);
  const out = new Set<string>();

  const withoutEquipment = clean(name.replace(LEADING, ''));
  if (withoutEquipment && withoutEquipment !== base) out.add(withoutEquipment);

  // Drop any parenthesised qualifier: "Cable Squat Row (with Rope Attachment)" is also just
  // "cable squat row" to someone searching for it.
  const withoutParens = clean(name.replace(/\([^)]*\)/g, ''));
  if (withoutParens && withoutParens !== base) out.add(withoutParens);

  for (const source of [base, withoutParens]) {
    if (!source) continue;
    let short = source;
    for (const [re, to] of SHORTHAND) short = short.replace(re, to);
    short = clean(short);
    if (short && short !== source) out.add(short);
  }

  out.delete(base);
  out.delete('');
  return [...out];
}

/** Camera-angle duplicates of an exercise already in the library. */
export function isCameraVariant(name: string): boolean {
  return /\((front|side|back)\s*pov\)/i.test(name);
}
