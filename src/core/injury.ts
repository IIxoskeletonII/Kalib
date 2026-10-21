// SPEC §20.16 — injury help: what is sent, what may come back, and what of it is believed.
//
// The model is asked one narrow question: given what hurts and the exercises in a routine, which
// can stay as they are, which need a change, which should be swapped, and which left out for
// now. Everything it says is treated as untrusted input:
//
//   - The request carries the description and, per exercise, a name, its muscles, its
//     equipment, and alternatives from the person's own library. No id, no history, no body
//     data: a short reference ("1", "2") stands in for each exercise.
//   - The answer is copied field by field into typed objects; anything unknown is dropped.
//   - A swap is believed only when it names an exercise that exists in the library, the same
//     grounding meal estimates get (§9.4). One that does not is kept as "leave it out", because
//     the rest of what the model said about that exercise is still the useful part.
//   - The answer is screened for red flags too (core/redFlags.ts), and any hit replaces the
//     advice with "see a doctor".
import type { ExerciseDoc } from './exerciseSearch';
import { MUSCLE_LABEL } from './muscles';
import { screenRedFlags, type RedFlag } from './redFlags';
import { singular, tokenize } from './text';
import type { Muscle } from './types';

/** Long enough for "where, when, since when"; short enough to stay a description. */
export const MAX_DESCRIPTION = 400;
/** A routine longer than this is several routines. */
export const MAX_EXERCISES = 16;
/** Alternatives offered per exercise: enough choice, few enough tokens. */
export const MAX_ALTERNATIVES = 8;
const MAX_TEXT = 220;

export type InjuryAction = 'keep' | 'modify' | 'swap' | 'skip';
const ACTIONS: readonly InjuryAction[] = ['keep', 'modify', 'swap', 'skip'];

export interface InjuryExercise {
  ref: string;
  name: string;
  muscles: string[];
  equipment: string;
  alternatives: string[];
}

export interface InjuryRequest {
  description: string;
  exercises: InjuryExercise[];
}

/** One exercise in the routine being asked about, with where it sits. */
export interface InjuryTarget {
  ref: string;
  /** Position in the routine's items, for applying a swap; absent outside a routine. */
  index?: number;
  doc: ExerciseDoc;
  alternatives: ExerciseDoc[];
}

export function cleanDescription(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION);
}

function muscleWords(doc: Pick<ExerciseDoc, 'primary_muscle' | 'secondary_muscles'>): string[] {
  const all: Muscle[] = [doc.primary_muscle, ...doc.secondary_muscles];
  return [...new Set(all)].slice(0, 6).map((m) => MUSCLE_LABEL[m]);
}

/**
 * Exercises that could stand in for `doc`: strength movements with the same main muscle, not
 * already in the routine. Ranked for overlap with what it trains, then spread across equipment,
 * because the useful swap around a sore joint is usually the same movement with a different
 * implement — a dumbbell press for a barbell one, a machine for a free weight.
 */
export function alternativesFor(
  doc: ExerciseDoc,
  catalogue: readonly ExerciseDoc[],
  exclude: ReadonlySet<string>,
  limit = MAX_ALTERNATIVES,
): ExerciseDoc[] {
  const secondary = new Set(doc.secondary_muscles);
  const scored = catalogue
    .filter(
      (c) =>
        c.id !== doc.id &&
        !exclude.has(c.id) &&
        c.category === 'strength' &&
        c.primary_muscle === doc.primary_muscle &&
        c.nameKey !== doc.nameKey,
    )
    .map((c) => ({
      c,
      score:
        c.secondary_muscles.filter((m) => secondary.has(m)).length +
        (c.custom ? 1 : 0) -
        Math.min(1.5, 0.2 * Math.max(0, c.nameLength - 3)),
    }))
    .sort((a, b) => b.score - a.score || (a.c.name < b.c.name ? -1 : a.c.name > b.c.name ? 1 : 0));

  // Round-robin over equipment, so eight alternatives are not eight barbell variations.
  const byEquipment = new Map<string, ExerciseDoc[]>();
  for (const { c } of scored) {
    const key = c.equipment.toLowerCase();
    const list = byEquipment.get(key) ?? [];
    list.push(c);
    byEquipment.set(key, list);
  }
  const queues = [...byEquipment.values()];
  const out: ExerciseDoc[] = [];
  for (let round = 0; out.length < limit && queues.some((q) => q.length > round); round++) {
    for (const q of queues) {
      const next = q[round];
      if (next && out.length < limit) out.push(next);
    }
  }
  return out;
}

/** The exercises of a routine (or one exercise), each with a reference and its alternatives. */
export function buildTargets(
  items: readonly { exercise_id: string; index?: number }[],
  catalogue: readonly ExerciseDoc[],
): InjuryTarget[] {
  const byId = new Map(catalogue.map((d) => [d.id, d]));
  const inRoutine = new Set(items.map((i) => i.exercise_id));
  const out: InjuryTarget[] = [];
  for (const item of items) {
    if (out.length >= MAX_EXERCISES) break;
    const doc = byId.get(item.exercise_id);
    if (!doc) continue;
    out.push({
      ref: String(out.length + 1),
      ...(item.index != null ? { index: item.index } : {}),
      doc,
      alternatives: alternativesFor(doc, catalogue, inRoutine),
    });
  }
  return out;
}

export function buildInjuryRequest(
  description: string,
  targets: readonly InjuryTarget[],
): InjuryRequest {
  return {
    description: cleanDescription(description),
    exercises: targets.map((t) => ({
      ref: t.ref,
      name: t.doc.name,
      muscles: muscleWords(t.doc),
      equipment: t.doc.equipment,
      alternatives: t.alternatives.map((a) => a.name),
    })),
  };
}

// ---- the answer ----

export interface ParsedAdvice {
  ref: string;
  action: InjuryAction;
  reason: string;
  change: string;
  swap_to: string;
}

export interface ParsedInjury {
  needs_doctor: boolean;
  summary: string;
  advice: ParsedAdvice[];
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '';
}

/**
 * The model's answer, copied into known fields. Throws when it is not the expected shape at
 * all; drops entries that refer to nothing, repeat an exercise, or name an unknown action.
 */
export function parseInjuryResponse(raw: unknown, refs: ReadonlySet<string>): ParsedInjury {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('The answer came back in a shape Kalib does not understand.');
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.advice)) {
    throw new Error('The answer came back in a shape Kalib does not understand.');
  }
  const seen = new Set<string>();
  const advice: ParsedAdvice[] = [];
  for (const a of r.advice) {
    if (advice.length >= refs.size) break;
    if (!a || typeof a !== 'object') continue;
    const e = a as Record<string, unknown>;
    const ref =
      typeof e.ref === 'string' ? e.ref.trim() : typeof e.ref === 'number' ? String(e.ref) : '';
    if (!refs.has(ref) || seen.has(ref)) continue;
    const action =
      typeof e.action === 'string' ? (e.action.trim().toLowerCase() as InjuryAction) : undefined;
    if (!action || !ACTIONS.includes(action)) continue;
    seen.add(ref);
    advice.push({
      ref,
      action,
      reason: text(e.reason),
      change: action === 'modify' ? text(e.change) : '',
      swap_to: action === 'swap' ? text(e.swap_to) : '',
    });
  }
  return { needs_doctor: r.needs_doctor === true, summary: text(r.summary), advice };
}

// ---- grounding ----

export interface GroundedAdvice {
  ref: string;
  index?: number;
  exercise: ExerciseDoc;
  action: InjuryAction;
  reason: string;
  change: string;
  /** The library exercise to swap in, when the model named one that exists. */
  swap?: ExerciseDoc;
  /** A swap the model suggested that is not in the library, so cannot be applied. */
  unmatched?: string;
}

function key(name: string): string {
  return tokenize(name).join(' ');
}

/**
 * The library exercise a model's name refers to, or undefined. Exact names win, the offered
 * alternatives first; otherwise only a near-exact match among the alternatives — every word
 * landing and no more than one word of difference — because a loose match would swap in an
 * exercise nobody suggested.
 */
export function groundSwap(
  name: string,
  target: InjuryTarget,
  catalogue: readonly ExerciseDoc[],
  inRoutine: ReadonlySet<string>,
): ExerciseDoc | undefined {
  const k = key(name);
  if (!k) return undefined;
  const allowed = (d: ExerciseDoc) =>
    d.id !== target.doc.id && !inRoutine.has(d.id) && d.category === 'strength';

  const exactAlt = target.alternatives.find((d) => d.nameKey === k && allowed(d));
  if (exactAlt) return exactAlt;
  const exact = catalogue.filter((d) => d.nameKey === k);
  // A name that is exactly an exercise is that exercise. If it is one that may not be swapped
  // in — the same lift, or one already in the routine — the answer is no, not its nearest
  // neighbour: "Barbell Bench Press" must not quietly become the incline version.
  if (exact.length > 0) return exact.find(allowed);

  const q = k.split(' ');
  const same = (t: string, words: ReadonlySet<string>) =>
    words.has(t) || words.has(`${t}s`) || words.has(singular(t) ?? t);
  let best: { d: ExerciseDoc; s: number } | undefined;
  for (const d of target.alternatives) {
    if (!allowed(d)) continue;
    const words = new Set(d.nameKey.split(' '));
    const landed = q.filter((t) => same(t, words));
    if (landed.length !== q.length) continue;
    if (Math.abs(d.nameLength - q.length) > 1) continue;
    const s = landed.length - Math.abs(d.nameLength - q.length) * 0.5;
    if (!best || s > best.s) best = { d, s };
  }
  return best?.d;
}

export function groundAdvice(
  parsed: ParsedInjury,
  targets: readonly InjuryTarget[],
  catalogue: readonly ExerciseDoc[],
): GroundedAdvice[] {
  const byRef = new Map(targets.map((t) => [t.ref, t]));
  const inRoutine = new Set(targets.map((t) => t.doc.id));
  const out: GroundedAdvice[] = [];
  for (const a of parsed.advice) {
    const target = byRef.get(a.ref);
    if (!target) continue;
    const base = {
      ref: a.ref,
      ...(target.index != null ? { index: target.index } : {}),
      exercise: target.doc,
      reason: a.reason,
      change: a.change,
    };
    if (a.action !== 'swap') {
      out.push({ ...base, action: a.action });
      continue;
    }
    const swap = a.swap_to ? groundSwap(a.swap_to, target, catalogue, inRoutine) : undefined;
    if (swap) out.push({ ...base, action: 'swap', swap });
    else out.push({ ...base, action: 'skip', ...(a.swap_to ? { unmatched: a.swap_to } : {}) });
  }
  // In routine order, whatever order the model answered in.
  const order = new Map(targets.map((t, i) => [t.ref, i]));
  return out.sort((x, y) => order.get(x.ref)! - order.get(y.ref)!);
}

export type InjuryAnswer =
  | { kind: 'doctor'; flags: RedFlag[]; source: 'description' | 'answer' }
  | { kind: 'advice'; summary: string; advice: GroundedAdvice[] };

/** A model answer that admits to a red flag, or uses the language of one, is not advice. */
export function readAnswer(
  parsed: ParsedInjury,
  targets: readonly InjuryTarget[],
  catalogue: readonly ExerciseDoc[],
): InjuryAnswer {
  const said = [parsed.summary, ...parsed.advice.flatMap((a) => [a.reason, a.change])].join('. ');
  const flags = screenRedFlags(said, 'model');
  if (parsed.needs_doctor || flags.length > 0) {
    return {
      kind: 'doctor',
      source: 'answer',
      flags:
        flags.length > 0
          ? flags
          : [{ id: 'model', level: 'urgent', label: 'something only a doctor can judge' }],
    };
  }
  return {
    kind: 'advice',
    summary: parsed.summary,
    advice: groundAdvice(parsed, targets, catalogue),
  };
}
