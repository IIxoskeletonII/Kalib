// SPEC §20.18 — whether the routines, as written, train you evenly.
//
// §20.8's coverage reads the week you actually trained. This reads the week you *plan*: the
// routines themselves, each counted as often as it comes round. The difference matters most
// before anything has been logged — someone who has just written four routines wants to know
// now that nothing in them trains a hamstring, not after a month of finding out.
//
// It speaks the same language as coverage on purpose. A set counts once for the muscle it is
// aimed at and half for each muscle that assists (`SECONDARY_WEIGHT`), the band is §20.8's ten
// to twenty sets a week, and the muscles it holds you to are the ones Build-a-week programs on
// purpose (`PROGRAMMED`). A forearm or a neck is shown, never chased: they are trained by the
// movements that are already there, and a suggestion to add wrist curls to everyone's week
// would be noise.
//
// Then it does the part no tracker does: it proposes the fix. Each gap gets one concrete edit to
// one routine — add an exercise, or swap one that is doing redundant work for one that is not —
// with the before and after shown, so the decision is the person's and the arithmetic is ours.
import { MUSCLE_LABEL, MUSCLE_REGIONS } from './muscles';
import {
  MAX_EXERCISES_PER_DAY,
  NOT_PROGRAMMED,
  PROGRAMMED,
  SETS_PER_EXERCISE,
  STAPLE_EQUIPMENT,
  prescriptionFor,
  stapleTier,
  type ProgramExercise,
} from './program';
import { MAX_SETS, MIN_SETS, SECONDARY_WEIGHT } from './trainingLoad';
import { MUSCLES, type Muscle, type Routine, type RoutineItem } from './types';

/** What the balance needs to know about an exercise: what Build-a-week needs, no more. */
export type BalanceExercise = ProgramExercise;

/** The muscles the map and the list show. Cardio is in the union but is not a muscle. */
export const MAP_MUSCLES: readonly Muscle[] = MUSCLES.filter((m) => m !== 'cardio');

/**
 * Past this a routine is long enough. Twenty-four working sets is a long session at three minutes
 * a set with rest; a fix that would push past it swaps instead of adding.
 */
export const MAX_ROUTINE_SETS = 24;

/** Suggestions offered at once. More than this is a to-do list, not advice. */
export const MAX_SUGGESTIONS = 5;

/** Sets an added exercise starts with, before the routine's frequency is considered. */
const MIN_ADDED_SETS = 2;

export type MuscleStatus = 'untrained' | 'under' | 'in range' | 'over';

export interface MusclePlan {
  muscle: Muscle;
  /** Planned hard sets a week: aimed sets plus half of the assisting ones. */
  sets: number;
  /** Planned sets a week where this muscle is the point of the exercise. */
  direct_sets: number;
  /** Sessions a week that train it at all. Twice beats once for the same sets (§20.9). */
  frequency: number;
  status: MuscleStatus;
  /** Held to the 10–20 band. Muscles outside `PROGRAMMED` are shown but never chased. */
  target: boolean;
}

/**
 * The deltoid's three heads, read from the exercise's name.
 *
 * The library files every shoulder movement under one muscle, so a week of presses and a week
 * of reverse flyes look identical to it — and that is exactly the imbalance worth catching,
 * because pressing trains the front of the shoulder hard and almost nobody's pulling trains
 * the back of it. The name is the only place the head is written down, so the name is read.
 */
export type DeltHead = 'front' | 'side' | 'rear';

const REAR =
  /\b(rear|reverse (fly|flye|pec)|face pull|pull-?apart|bent[- ]over (lateral )?raise|prone (lateral |y |t )?raise)/i;
const SIDE = /\b(lateral raise|side raise|upright row|lu raise|cross[- ]?body raise)/i;
const FRONT = /\b(front raise|press|push-?up|dip|arnold|bench|landmine|pike)/i;

/** The head an exercise mostly trains, when its name says. */
export function deltHead(name: string): DeltHead | undefined {
  if (REAR.test(name)) return 'rear';
  // "Front lateral raise" is a front raise that the library chose to call lateral.
  if (/\bfront\b/i.test(name)) return 'front';
  if (SIDE.test(name)) return 'side';
  if (FRONT.test(name)) return 'front';
  return undefined;
}

/**
 * Which head an exercise's shoulder work lands on, as shares that sum to one.
 *
 * Named, it is that head. Unnamed, the movement decides: pressing with the chest or triceps
 * leading is front-delt work, pulling with the back leading is rear-delt work, and a shoulder
 * movement the name does not place is spread across all three rather than guessed.
 */
export function deltShares(
  e: Pick<BalanceExercise, 'name' | 'primary_muscle'>,
): Record<DeltHead, number> {
  const head = deltHead(e.name);
  if (head) return { front: 0, side: 0, rear: 0, [head]: 1 };
  if (e.primary_muscle === 'chest' || e.primary_muscle === 'triceps') {
    return { front: 1, side: 0, rear: 0 };
  }
  if (['lats', 'upper back', 'traps'].includes(e.primary_muscle)) {
    return { front: 0, side: 0, rear: 1 };
  }
  return { front: 1 / 3, side: 1 / 3, rear: 1 / 3 };
}

export type PairId =
  'push-pull' | 'quads-hamstrings' | 'front-rear-delts' | 'chest-back' | 'biceps-triceps';

/**
 * Pairs whose balance is worth a line, and how far apart they may drift.
 *
 * The honest summary of the evidence is that **no trial has set an ideal ratio of weekly sets
 * between opposing muscles**. What exists is strength ratios measured on dynamometers, and the
 * consensus of coaches, and both point the same way, so the thresholds are deliberately loose:
 * they flag a week that has plainly forgotten one side, not one that is a little lopsided.
 *
 *   - Push and pull. Shoulder-health guidance (e.g. Cools et al., *Br J Sports Med* 2014, on
 *     scapular muscle balance) leans toward at least as much pulling as pressing; nobody has
 *     shown harm from more. Flag pulling under 80 % of pressing.
 *   - Quads and hamstrings. Hamstring-to-quadriceps strength ratios of roughly 0.5–0.8 are the
 *     usual reference (Coombs & Garbutt, *J Sports Sci Med* 2002), and a low ratio is the one
 *     associated with hamstring injury. Flag hamstrings under half the quads' sets.
 *   - Front and rear delts. Pressing loads the front head heavily; the rear head is the one
 *     programs forget. Weak evidence, strong consensus. Flag rear under half of front.
 *   - Chest and upper back: the horizontal version of push and pull.
 *   - Biceps and triceps: the triceps is the larger muscle, so the triceps may lead; flag
 *     either side falling under half the other.
 */
interface PairRule {
  id: PairId;
  label: string;
  a: { label: string; of: (r: Totals) => number };
  b: { label: string; of: (r: Totals) => number };
  /** b may fall to this share of a before it is short. */
  bMin: number;
  /** a may fall to this share of b before it is short. */
  aMin: number;
  /** The muscle (and head) to add sets to when each side is short. */
  fixA: Deficit['muscle'];
  fixB: Deficit['muscle'];
  headA?: DeltHead;
  headB?: DeltHead;
}

interface Totals {
  sets: ReadonlyMap<Muscle, number>;
  delts: Record<DeltHead, number>;
}

const setsOf = (t: Totals, m: Muscle) => t.sets.get(m) ?? 0;

export const PAIRS: readonly PairRule[] = [
  {
    id: 'push-pull',
    label: 'Push and pull',
    a: { label: 'Push', of: (t) => setsOf(t, 'chest') + t.delts.front },
    b: { label: 'Pull', of: (t) => setsOf(t, 'lats') + setsOf(t, 'upper back') + t.delts.rear },
    bMin: 0.8,
    aMin: 0.5,
    fixA: 'chest',
    fixB: 'upper back',
  },
  {
    id: 'quads-hamstrings',
    label: 'Quads and hamstrings',
    a: { label: 'Quads', of: (t) => setsOf(t, 'quads') },
    b: { label: 'Hamstrings', of: (t) => setsOf(t, 'hamstrings') },
    bMin: 0.5,
    aMin: 0.5,
    fixA: 'quads',
    fixB: 'hamstrings',
  },
  {
    id: 'front-rear-delts',
    label: 'Front and rear delts',
    a: { label: 'Front delts', of: (t) => t.delts.front },
    b: { label: 'Rear delts', of: (t) => t.delts.rear },
    bMin: 0.5,
    aMin: 0.25,
    fixA: 'shoulders',
    fixB: 'shoulders',
    headA: 'front',
    headB: 'rear',
  },
  {
    id: 'chest-back',
    label: 'Chest and upper back',
    a: { label: 'Chest', of: (t) => setsOf(t, 'chest') },
    b: { label: 'Upper back', of: (t) => setsOf(t, 'upper back') },
    bMin: 0.7,
    aMin: 0.5,
    fixA: 'chest',
    fixB: 'upper back',
  },
  {
    id: 'biceps-triceps',
    label: 'Biceps and triceps',
    a: { label: 'Biceps', of: (t) => setsOf(t, 'biceps') },
    b: { label: 'Triceps', of: (t) => setsOf(t, 'triceps') },
    bMin: 0.5,
    aMin: 0.5,
    fixA: 'biceps',
    fixB: 'triceps',
  },
];

export interface PairReport {
  id: PairId;
  label: string;
  a: { label: string; sets: number };
  b: { label: string; sets: number };
  /** Which side is short, if either; `none` when neither side is trained at all. */
  short?: 'a' | 'b';
  verdict: 'balanced' | 'short' | 'none';
}

export interface BalanceReport {
  /** Routines counted. */
  routines: number;
  /** Every muscle on the map, in `MAP_MUSCLES` order. */
  muscles: MusclePlan[];
  /** Planned shoulder sets a week by head. */
  delts: Record<DeltHead, number>;
  pairs: PairReport[];
  /** Planned working sets whose exercise the catalogue does not know. */
  unknown_sets: number;
}

/** How often each routine comes round in a week, by routine id. Missing means once. */
export type Frequency = ReadonlyMap<string, number>;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function statusOf(sets: number): MuscleStatus {
  if (sets <= 0) return 'untrained';
  if (sets < MIN_SETS) return 'under';
  if (sets > MAX_SETS) return 'over';
  return 'in range';
}

const perWeekOf = (perWeek: Frequency | undefined, id: string) => {
  const n = perWeek?.get(id);
  return n != null && Number.isFinite(n) && n >= 0 ? n : 1;
};

/** What one routine item contributes a week, per muscle, at the routine's frequency. */
function itemLoad(
  item: RoutineItem,
  e: BalanceExercise,
  times: number,
): { muscle: Muscle; sets: number; direct: boolean }[] {
  const sets = Math.max(0, item.sets) * times;
  const out: { muscle: Muscle; sets: number; direct: boolean }[] = [];
  if (e.primary_muscle !== 'cardio') out.push({ muscle: e.primary_muscle, sets, direct: true });
  for (const m of e.secondary_muscles ?? []) {
    if (m === 'cardio' || m === e.primary_muscle || out.some((o) => o.muscle === m)) continue;
    out.push({ muscle: m, sets: sets * SECONDARY_WEIGHT, direct: false });
  }
  return out;
}

/**
 * Planned weekly sets per muscle from the routines, each counted as often as it comes round.
 *
 * Deterministic and pure: the same routines, catalogue and frequencies give the same report.
 */
export function planBalance(
  routines: readonly Pick<Routine, 'id' | 'items'>[],
  catalogue: ReadonlyMap<string, BalanceExercise>,
  perWeek?: Frequency,
): BalanceReport {
  const weighted = new Map<Muscle, number>();
  const direct = new Map<Muscle, number>();
  const frequency = new Map<Muscle, number>();
  const delts: Record<DeltHead, number> = { front: 0, side: 0, rear: 0 };
  let unknown_sets = 0;
  const bump = (m: Map<Muscle, number>, k: Muscle, n: number) => m.set(k, (m.get(k) ?? 0) + n);

  for (const r of routines) {
    const times = perWeekOf(perWeek, r.id);
    const touched = new Set<Muscle>();
    for (const item of r.items) {
      const e = catalogue.get(item.exercise_id);
      if (!e) {
        unknown_sets += Math.max(0, item.sets) * times;
        continue;
      }
      for (const l of itemLoad(item, e, times)) {
        bump(weighted, l.muscle, l.sets);
        if (l.direct) bump(direct, l.muscle, l.sets);
        if (l.sets > 0) touched.add(l.muscle);
        if (l.muscle === 'shoulders') {
          const share = deltShares(e);
          for (const h of ['front', 'side', 'rear'] as const) delts[h] += l.sets * share[h];
        }
      }
    }
    for (const m of touched) bump(frequency, m, times);
  }

  const muscles: MusclePlan[] = MAP_MUSCLES.map((muscle) => {
    const sets = round1(weighted.get(muscle) ?? 0);
    return {
      muscle,
      sets,
      direct_sets: round1(direct.get(muscle) ?? 0),
      frequency: round1(frequency.get(muscle) ?? 0),
      status: statusOf(sets),
      target: PROGRAMMED.includes(muscle),
    };
  });

  const roundedDelts = {
    front: round1(delts.front),
    side: round1(delts.side),
    rear: round1(delts.rear),
  };
  const totals: Totals = {
    sets: new Map(muscles.map((m) => [m.muscle, m.sets])),
    delts: roundedDelts,
  };
  const pairs = PAIRS.map((p): PairReport => {
    const a = round1(p.a.of(totals));
    const b = round1(p.b.of(totals));
    const base = {
      id: p.id,
      label: p.label,
      a: { label: p.a.label, sets: a },
      b: { label: p.b.label, sets: b },
    };
    if (a <= 0 && b <= 0) return { ...base, verdict: 'none' };
    if (b < a * p.bMin) return { ...base, short: 'b', verdict: 'short' };
    if (a < b * p.aMin) return { ...base, short: 'a', verdict: 'short' };
    return { ...base, verdict: 'balanced' };
  });

  return {
    routines: routines.length,
    muscles,
    delts: roundedDelts,
    pairs,
    unknown_sets: round1(unknown_sets),
  };
}

// ------------------------------------------------------------------------------ suggestions

/** A gap worth fixing: a muscle (or one head of the shoulder) and why. */
export interface Deficit {
  muscle: Muscle;
  head?: DeltHead;
  reason: 'untrained' | 'under' | PairId;
  /** For a pair, which side is short: what the fix is measured by. */
  side?: 'a' | 'b';
  /** Sets a week it is short by. */
  need: number;
}

interface FixBase {
  /** Stable, for a React key and for not offering the same thing twice. */
  id: string;
  routine_id: string;
  routine_name: string;
  for: Deficit;
  /** The short muscle's planned weekly sets now, and after the fix. */
  before: number;
  after: number;
  /** The exercise going in. */
  item: RoutineItem;
}

export interface AddFix extends FixBase {
  kind: 'add';
}

export interface SwapFix extends FixBase {
  kind: 'swap';
  /** Position in the routine of the exercise coming out. */
  index: number;
  out: { exercise_id: string; name: string; muscle: Muscle; before: number; after: number };
}

export type BalanceFix = AddFix | SwapFix;

/** The muscle's place in a week: which region a routine must train to be a natural home. */
function regionOf(m: Muscle, head?: DeltHead): readonly Muscle[] {
  // A rear delt is pulled, not pressed: its home is the back day, whatever the library files it
  // under.
  if (m === 'shoulders' && head === 'rear') {
    return MUSCLE_REGIONS.find((r) => r.label === 'Pull')?.muscles ?? [];
  }
  return MUSCLE_REGIONS.find((r) => r.muscles.includes(m))?.muscles ?? [m];
}

/**
 * The gaps, most serious first: a muscle never trained, then a side of a pair the week has
 * plainly forgotten, then muscles trained but under the band, furthest under first.
 *
 * A lopsided pair outranks a muscle a set or two short. Nine sets of biceps is nearly there;
 * no rear-delt work at all against a week of pressing is the imbalance the person asked about.
 */
export function deficits(report: BalanceReport): Deficit[] {
  const out: Deficit[] = [];
  const targets = report.muscles.filter((m) => m.target);
  const plan = (m: Muscle) => targets.find((x) => x.muscle === m);
  const listed = (m: Muscle) => out.some((d) => d.muscle === m && !d.head);

  for (const m of targets) {
    if (m.status === 'untrained') {
      out.push({ muscle: m.muscle, reason: 'untrained', need: MIN_SETS });
    }
  }

  for (const p of report.pairs) {
    if (p.verdict !== 'short' || !p.short) continue;
    const rule = PAIRS.find((r) => r.id === p.id)!;
    const muscle = p.short === 'a' ? rule.fixA : rule.fixB;
    const head = p.short === 'a' ? rule.headA : rule.headB;
    // One gap, one fix: a muscle already listed (never trained, or short in another pair) is
    // not offered a second exercise for the same shortfall.
    if (!head && listed(muscle)) continue;
    if (head && out.some((d) => d.muscle === muscle && d.head === head)) continue;
    const have = p.short === 'a' ? p.a.sets : p.b.sets;
    const other = p.short === 'a' ? p.b.sets : p.a.sets;
    const share = p.short === 'a' ? rule.aMin : rule.bMin;
    const pairNeed = other * share - have;
    // Short in a pair and under the band too: the larger of the two shortfalls is the need.
    const own = plan(muscle);
    const bandNeed = !head && own && own.status === 'under' ? MIN_SETS - own.sets : 0;
    out.push({
      muscle,
      ...(head ? { head } : {}),
      reason: p.id,
      side: p.short,
      need: Math.max(1, round1(Math.max(pairNeed, bandNeed))),
    });
  }

  const under = targets
    .filter((m) => m.status === 'under' && !listed(m.muscle))
    .sort((a, b) => a.sets - b.sets || PROGRAMMED.indexOf(a.muscle) - PROGRAMMED.indexOf(b.muscle));
  for (const m of under) {
    out.push({ muscle: m.muscle, reason: 'under', need: round1(MIN_SETS - m.sets) });
  }
  return out;
}

/** Equipment the person evidently has, read from what their routines already use. */
export function inferEquipment(
  routines: readonly Pick<Routine, 'items'>[],
  catalogue: ReadonlyMap<string, BalanceExercise>,
): Set<string> {
  const used = new Set<string>();
  for (const r of routines) {
    for (const it of r.items) {
      const e = catalogue.get(it.exercise_id);
      if (e) used.add(e.equipment.toLowerCase());
    }
  }
  // A barbell, a cable stack or a machine means a gym, and a gym has all of the staples. Short
  // of that, offer only what is already in use, plus the floor.
  const gym = ['barbell', 'cable', 'leverage machine', 'smith machine'].some((k) => used.has(k));
  if (used.size === 0 || gym) for (const k of STAPLE_EQUIPMENT) used.add(k);
  used.add('body weight');
  return used;
}

/**
 * Named movements for the rear of the shoulder, which `STAPLES` does not single out: it lists
 * shoulder staples, and every one of them is a press or a lateral raise.
 */
const REAR_DELT_STAPLES = [
  'Face Pull (Cable)',
  'Reverse Fly (Dumbbell)',
  'Reverse Fly (Machine)',
  'Reverse Fly (Cable)',
  'Rear Delt Row (Cable)',
  'Band Pull-Apart',
].map((n) => n.toLowerCase());

const DIFFICULTY: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };

/** Earlier in `STAPLE_EQUIPMENT` ranks higher; kit it does not list ranks last. */
function kitRank(equipment: string): number {
  const i = STAPLE_EQUIPMENT.indexOf(equipment.toLowerCase());
  return i < 0 ? -STAPLE_EQUIPMENT.length : -i;
}

function familiarity(e: BalanceExercise, d: Deficit): number {
  if (d.head === 'rear' && REAR_DELT_STAPLES.includes(e.name.toLowerCase())) return 2;
  return stapleTier(e);
}

/** Lexicographic, higher wins at the first key that differs. */
function better(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (Math.abs(x - y) > 1e-9) return x > y;
  }
  return false;
}

/** The best exercise to put into `routine` for `d`, or none that fits. */
function pickExercise(
  d: Deficit,
  routine: Pick<Routine, 'items'>,
  pool: readonly BalanceExercise[],
  usedAnywhere: ReadonlySet<string>,
  catalogue: ReadonlyMap<string, BalanceExercise>,
  taken: ReadonlySet<string>,
): BalanceExercise | undefined {
  const inRoutine = new Set(routine.items.map((i) => i.exercise_id));
  const routineKit = new Set(
    routine.items
      .map((i) => catalogue.get(i.exercise_id)?.equipment.toLowerCase())
      .filter((k): k is string => k != null),
  );
  let best: BalanceExercise | undefined;
  let bestKey: number[] = [];
  for (const e of pool) {
    if (e.primary_muscle !== d.muscle) continue;
    if (inRoutine.has(e.id) || taken.has(e.id)) continue;
    const head = e.primary_muscle === 'shoulders' ? deltHead(e.name) : undefined;
    if (d.head && head !== d.head) continue;
    // A shoulder gap that is not about a head is a gap in the shoulder as a whole; the press is
    // already everywhere, so the lateral raise is the useful addition.
    const sideBonus = d.muscle === 'shoulders' && !d.head && head === 'side' ? 1 : 0;
    const key = [
      familiarity(e, d),
      sideBonus,
      routineKit.has(e.equipment.toLowerCase()) ? 1 : 0,
      usedAnywhere.has(e.id) ? 0 : 1,
      -(DIFFICULTY[e.difficulty ?? 'intermediate'] ?? 1),
      kitRank(e.equipment),
    ];
    if (!best || better(key, bestKey) || (!better(bestKey, key) && e.id < best.id)) {
      best = e;
      bestKey = key;
    }
  }
  return best;
}

const totalSets = (r: Pick<Routine, 'items'>) =>
  r.items.reduce((n, i) => n + Math.max(0, i.sets), 0);

function newItem(e: BalanceExercise, sets: number): RoutineItem {
  const p = prescriptionFor(e);
  const timed = e.load_type === 'time' || e.load_type === 'distance_time';
  return {
    exercise_id: e.id,
    name: e.name,
    load_type: e.load_type,
    sets,
    ...(!timed && p.rep_low != null ? { rep_low: p.rep_low } : {}),
    ...(!timed && p.rep_high != null ? { rep_high: p.rep_high } : {}),
    ...(p.rest_sec != null ? { rest_sec: p.rest_sec } : {}),
  };
}

export interface SuggestOptions {
  perWeek?: Frequency;
  limit?: number;
}

type Working = Pick<Routine, 'id' | 'name' | 'items' | 'sort_order'>;

/** The short muscle's weekly sets, or the head's when the gap is a head. */
/**
 * The figure a fix is judged by: the short side of its pair when the gap is a pair — "pulling",
 * not the one muscle the pull is added to — or else the head, or else the muscle.
 */
export function deficitSets(
  report: Pick<BalanceReport, 'muscles' | 'delts' | 'pairs'>,
  d: Deficit,
): number {
  if (d.side) {
    const p = report.pairs.find((x) => x.id === d.reason);
    if (p) return d.side === 'a' ? p.a.sets : p.b.sets;
  }
  if (d.head) return report.delts[d.head];
  return report.muscles.find((m) => m.muscle === d.muscle)?.sets ?? 0;
}

const measure = deficitSets;

/**
 * Concrete fixes for the gaps, one per gap, at most `limit`.
 *
 * Each is planned against the routines as the earlier ones would leave them, so two fixes never
 * fight over the same routine's last free slot and the "after" figures are the ones you would
 * really get by applying them in order.
 *
 * For each gap: the routine whose existing work is closest to the muscle is its natural home
 * (a hamstring curl goes on leg day); within it, a swap is preferred when an exercise there is
 * pure surplus — its muscle stays inside the band without it — and the routine is full or that
 * muscle is over the band; otherwise the exercise is added. A routine is never pushed past
 * `MAX_EXERCISES_PER_DAY` exercises or `MAX_ROUTINE_SETS` sets.
 */
export function suggestFixes(
  routines: readonly Working[],
  catalogue: ReadonlyMap<string, BalanceExercise>,
  opts: SuggestOptions = {},
): BalanceFix[] {
  const limit = opts.limit ?? MAX_SUGGESTIONS;
  if (routines.length === 0 || limit <= 0) return [];

  const allowed = inferEquipment(routines, catalogue);
  const pool = [...catalogue.values()]
    .filter((e) => e.category === 'strength')
    .filter((e) => e.difficulty !== 'advanced')
    .filter((e) => !NOT_PROGRAMMED.test(e.name))
    .filter((e) => allowed.has(e.equipment.toLowerCase()))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Working copies, in the person's own order.
  let work: Working[] = [...routines]
    .sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : 1))
    .map((r) => ({ ...r, items: [...r.items] }));
  const fixes: BalanceFix[] = [];
  const taken = new Set<string>();

  let report = planBalance(work, catalogue, opts.perWeek);
  const queue = deficits(report);
  for (const d of queue) {
    if (fixes.length >= limit) break;
    // An earlier fix may already have closed this one.
    const now = deficits(report).find(
      (x) => x.muscle === d.muscle && x.head === d.head && x.reason === d.reason,
    );
    if (!now) continue;

    const usedAnywhere = new Set(work.flatMap((r) => r.items.map((i) => i.exercise_id)));
    const fix = fixFor(now, work, report, pool, usedAnywhere, catalogue, taken, opts.perWeek);
    if (!fix) continue;
    fixes.push(fix);
    taken.add(fix.item.exercise_id);
    work = work.map((r) => (r.id === fix.routine_id ? { ...r, items: applyTo(r.items, fix) } : r));
    report = planBalance(work, catalogue, opts.perWeek);
  }
  return fixes;
}

/** A routine's items with a fix applied. Pure; the service does the same to the stored row. */
export function applyTo(items: readonly RoutineItem[], fix: BalanceFix): RoutineItem[] {
  if (fix.kind === 'add') return [...items, fix.item];
  return items.map((it, i) => (i === fix.index ? fix.item : it));
}

function fixFor(
  d: Deficit,
  work: readonly Working[],
  report: BalanceReport,
  pool: readonly BalanceExercise[],
  usedAnywhere: ReadonlySet<string>,
  catalogue: ReadonlyMap<string, BalanceExercise>,
  taken: ReadonlySet<string>,
  perWeek: Frequency | undefined,
): BalanceFix | undefined {
  const region = regionOf(d.muscle, d.head);
  const regionWork = (r: Working) =>
    r.items.reduce((n, it) => {
      const e = catalogue.get(it.exercise_id);
      if (!e) return n;
      const hits = region.includes(e.primary_muscle)
        ? 1
        : (e.secondary_muscles ?? []).some((m) => region.includes(m))
          ? 0.5
          : 0;
      return n + hits * Math.max(0, it.sets);
    }, 0);

  // Natural homes first: most work already in the muscle's region, then the shortest routine.
  const homes = [...work].sort(
    (a, b) =>
      regionWork(b) - regionWork(a) || totalSets(a) - totalSets(b) || a.sort_order - b.sort_order,
  );

  const before = measure(report, d);
  for (const r of homes) {
    const e = pickExercise(d, r, pool, usedAnywhere, catalogue, taken);
    if (!e) continue;
    const times = perWeekOf(perWeek, r.id);
    const full =
      r.items.length >= MAX_EXERCISES_PER_DAY || totalSets(r) + MIN_ADDED_SETS > MAX_ROUTINE_SETS;
    const swap = surplusIn(r, d, report, catalogue, times);

    const preferSwap = swap && (full || swap.overBand);
    if (preferSwap && swap) {
      return makeSwap(d, r, swap.index, e, before, work, catalogue, perWeek);
    }
    if (!full) {
      const wanted = Math.ceil(d.need / Math.max(times, 0.25));
      const room = MAX_ROUTINE_SETS - totalSets(r);
      const sets = Math.min(Math.max(MIN_ADDED_SETS, Math.min(SETS_PER_EXERCISE, wanted)), room);
      const item = newItem(e, sets);
      const fix: AddFix = {
        kind: 'add',
        id: `add:${r.id}:${e.id}`,
        routine_id: r.id,
        routine_name: r.name,
        for: d,
        before,
        after: 0,
        item,
      };
      fix.after = afterOf(fix, d, work, catalogue, perWeek);
      return fix;
    }
    if (swap) return makeSwap(d, r, swap.index, e, before, work, catalogue, perWeek);
  }
  return undefined;
}

function afterOf(
  fix: BalanceFix,
  d: Deficit,
  work: readonly Working[],
  catalogue: ReadonlyMap<string, BalanceExercise>,
  perWeek: Frequency | undefined,
): number {
  const next = work.map((r) =>
    r.id === fix.routine_id ? { ...r, items: applyTo(r.items, fix) } : r,
  );
  return measure(planBalance(next, catalogue, perWeek), d);
}

function makeSwap(
  d: Deficit,
  r: Working,
  index: number,
  e: BalanceExercise,
  before: number,
  work: readonly Working[],
  catalogue: ReadonlyMap<string, BalanceExercise>,
  perWeek: Frequency | undefined,
): SwapFix {
  const old = r.items[index]!;
  const oldMuscle = catalogue.get(old.exercise_id)!.primary_muscle;
  const fresh = newItem(e, old.sets);
  // The slot keeps what the person chose for it: its sets, rest, superset and note.
  const item: RoutineItem = {
    ...fresh,
    sets: old.sets,
    ...(old.rest_sec != null ? { rest_sec: old.rest_sec } : {}),
    ...(old.superset ? { superset: old.superset } : {}),
    ...(old.note ? { note: old.note } : {}),
  };
  const fix: SwapFix = {
    kind: 'swap',
    id: `swap:${r.id}:${index}:${e.id}`,
    routine_id: r.id,
    routine_name: r.name,
    for: d,
    before,
    after: 0,
    item,
    index,
    out: { exercise_id: old.exercise_id, name: old.name, muscle: oldMuscle, before: 0, after: 0 },
  };
  const now = planBalance(work, catalogue, perWeek);
  const next = work.map((x) => (x.id === r.id ? { ...x, items: applyTo(x.items, fix) } : x));
  const then = planBalance(next, catalogue, perWeek);
  fix.after = measure(then, d);
  fix.out.before = now.muscles.find((m) => m.muscle === oldMuscle)?.sets ?? 0;
  fix.out.after = then.muscles.find((m) => m.muscle === oldMuscle)?.sets ?? 0;
  return fix;
}

/**
 * An exercise in `r` that is doing redundant work: its muscle stays inside the band without it,
 * and that muscle is not itself one of the gaps. The most redundant wins — the one whose muscle
 * keeps the most to spare — and, between equals, the later one, since a routine's last
 * exercises are its accessories.
 */
function surplusIn(
  r: Working,
  d: Deficit,
  report: BalanceReport,
  catalogue: ReadonlyMap<string, BalanceExercise>,
  times: number,
): { index: number; overBand: boolean } | undefined {
  const gaps = new Set(deficits(report).map((x) => x.muscle));
  let best: { index: number; spare: number; overBand: boolean } | undefined;
  r.items.forEach((it, index) => {
    const e = catalogue.get(it.exercise_id);
    if (!e || e.primary_muscle === 'cardio') return;
    const m = e.primary_muscle;
    if (m === d.muscle || gaps.has(m)) return;
    const plan = report.muscles.find((x) => x.muscle === m);
    if (!plan) return;
    // Losing this exercise costs its muscle the whole of its sets; assisting muscles lose half.
    const left = plan.sets - Math.max(0, it.sets) * times;
    if (left < MIN_SETS) return;
    // Its assisting muscles must not fall out of the band either.
    for (const s of e.secondary_muscles ?? []) {
      const sp = report.muscles.find((x) => x.muscle === s);
      if (!sp || !sp.target) continue;
      const sLeft = sp.sets - Math.max(0, it.sets) * times * SECONDARY_WEIGHT;
      if (sp.sets >= MIN_SETS && sLeft < MIN_SETS) return;
    }
    const spare = left - MIN_SETS;
    const overBand = plan.sets > MAX_SETS;
    if (
      !best ||
      spare > best.spare + 1e-9 ||
      (Math.abs(spare - best.spare) <= 1e-9 && index > best.index)
    ) {
      best = { index, spare, overBand };
    }
  });
  return best ? { index: best.index, overBand: best.overBand } : undefined;
}

// ----------------------------------------------------------------------------------- the map

/**
 * How full a region of the map is drawn: none, a little, under the band, in it.
 *
 * Over the band is drawn as full, not as something louder. The list says when a muscle is over;
 * on the body, more colour than "covered" would read as better, and it is not.
 */
export type FillLevel = 0 | 1 | 2 | 3;

/**
 * What the steps are measured against. A week is held to the band: half of it is "some", all of
 * it is "trained". A single session is drawn on its own scale — one day of a split never reaches
 * a weekly band, so on the week's scale every routine would be a faint, uniform wash, and the
 * picture is meant to say what *this* day is for. Three working sets is a muscle the session
 * means to train; six is one it is built around.
 */
export type FillScale = 'week' | 'session';

const STEPS: Record<FillScale, readonly [light: number, full: number]> = {
  week: [MIN_SETS / 2, MIN_SETS],
  session: [3, 6],
};

/** Half the band: below it a muscle is being touched rather than trained. */
export const LIGHT_SETS = STEPS.week[0];

export function fillLevel(sets: number, scale: FillScale = 'week'): FillLevel {
  if (!(sets > 0)) return 0;
  const [light, full] = STEPS[scale];
  if (sets < light) return 1;
  if (sets < full) return 2;
  return 3;
}

/**
 * Which muscle each drawn region shows. The source's slugs are anatomy, ours are training; this
 * is the bridge, and it is the reason a muscle can be on the list and not on the body.
 *
 * Front and back delts are drawn from different heads: from the front you see the front and side
 * of the shoulder, from behind the rear and side — so a week of pressing fills the front view's
 * shoulders and leaves the back view's grey, which is the truth of it.
 */
export const REGION_MUSCLE = {
  chest: 'chest',
  abs: 'abs',
  obliques: 'obliques',
  biceps: 'biceps',
  triceps: 'triceps',
  forearm: 'forearms',
  deltoids: 'shoulders',
  trapezius: 'traps',
  'upper-back': 'upper back',
  lats: 'lats',
  'lower-back': 'lower back',
  gluteal: 'glutes',
  quadriceps: 'quads',
  hamstring: 'hamstrings',
  adductors: 'adductors',
  calves: 'calves',
  neck: 'neck',
} as const satisfies Record<string, Muscle>;

export type MappedRegion = keyof typeof REGION_MUSCLE;

/** Muscles with nowhere on the figure to draw them. They are listed, never dropped. */
export const UNDRAWN: readonly Muscle[] = MAP_MUSCLES.filter(
  (m) => !(Object.values(REGION_MUSCLE) as Muscle[]).includes(m),
);

/** Weekly sets a region is drawn from, on one side of the body. */
export function regionSets(
  report: Pick<BalanceReport, 'muscles' | 'delts'>,
  region: MappedRegion,
  side: 'front' | 'back',
): number {
  if (region === 'deltoids') {
    const d = report.delts;
    return round1(side === 'front' ? d.front + d.side : d.rear + d.side);
  }
  const m = REGION_MUSCLE[region];
  return report.muscles.find((x) => x.muscle === m)?.sets ?? 0;
}

// ----------------------------------------------------------------------------------- words

const HEAD_LABEL: Record<DeltHead, string> = {
  front: 'Front delts',
  side: 'Side delts',
  rear: 'Rear delts',
};

/** One decimal only where there is one: 7.5 sets, 10 sets. */
export function formatSets(n: number): string {
  const r = round1(n);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** The short muscle as the person would say it. */
export function deficitLabel(
  d: Pick<Deficit, 'muscle' | 'head' | 'reason'> | Pick<Deficit, 'muscle'>,
): string {
  if ('head' in d && d.head) return HEAD_LABEL[d.head];
  // Push and pull are measured as a whole side, so they are named as one.
  if ('reason' in d && d.reason === 'push-pull')
    return d.muscle === 'chest' ? 'Pressing' : 'Pulling';
  return MUSCLE_LABEL[d.muscle];
}

const PAIR_REASON: Record<string, string> = {
  'push-pull:upper back': 'Less pulling than pressing.',
  'push-pull:chest': 'Less pressing than pulling.',
  'quads-hamstrings:hamstrings': 'Hamstrings under half your quad work.',
  'quads-hamstrings:quads': 'Quads under half your hamstring work.',
  'front-rear-delts:rear': 'Rear delts under half your front-delt work.',
  'front-rear-delts:front': 'Front delts well behind the rear.',
  'chest-back:upper back': 'Upper back behind your chest work.',
  'chest-back:chest': 'Chest behind your upper-back work.',
  'biceps-triceps:biceps': 'Biceps under half your triceps work.',
  'biceps-triceps:triceps': 'Triceps under half your biceps work.',
};

/** Why this gap is worth a fix, in one sentence. */
export function describeDeficit(d: Deficit, sets: number): string {
  const label = deficitLabel(d);
  if (d.reason === 'untrained') {
    return `Nothing in your routines trains your ${label.toLowerCase()}.`;
  }
  if (d.reason === 'under') {
    return `${label}: ${formatSets(sets)} sets a week. ${MIN_SETS} is where the evidence starts.`;
  }
  return PAIR_REASON[`${d.reason}:${d.head ?? d.muscle}`] ?? `${label} behind.`;
}

/**
 * The fix as a heading, where it goes, and what it does — the short muscle's sets before and
 * after, and for a swap what the outgoing exercise's muscle keeps.
 */
export function describeFix(f: BalanceFix): {
  title: string;
  where: string;
  effect: string;
  cost?: string;
} {
  const label = deficitLabel(f.for);
  const effect = `${label} ${formatSets(f.before)} → ${formatSets(f.after)} sets a week`;
  if (f.kind === 'add') {
    return { title: `Add ${f.item.name}`, where: `to ${f.routine_name}`, effect };
  }
  return {
    title: `Swap ${f.out.name} for ${f.item.name}`,
    where: `in ${f.routine_name}`,
    effect,
    cost: `${MUSCLE_LABEL[f.out.muscle]} keeps ${formatSets(f.out.after)} of ${formatSets(f.out.before)}`,
  };
}
