// SPEC §20.17 — the week: which days you train, and what each of them is.
//
// Two things are chosen, and only two: **the days** (Monday, Wednesday, Friday — or just "three
// a week, any days") and **the cycle** (the routines in the order they come round, a routine
// allowed more than once). Everything else is derived: the routine on each upcoming day, what a
// missed day does, the streak's aim (§20.15), the circle's planned days (§21) and the training
// days the energy bridge leans toward (§20.7). One plan, read everywhere.
//
// **The cycle is laid onto the days; the days do not own routines.** Monday is not "chest
// day". Monday is the next training day, and it gets whatever is next in the cycle. So a missed
// Monday moves Chest & Tri to Wednesday rather than skipping it — the rotation rule of §20.10,
// which is the right one for training — and the calendar ahead simply follows. The user's own
// example is the test of this: Chest & Tri, Back & Bi, Legs, Shoulders & Tri, Back & Bi, Legs
// over Monday, Wednesday and Friday gives Mon C&T, Wed B&B, Fri Legs, Mon S&T, Wed B&B, Fri Legs.
import { addDays, fromDateKey, toDateKey } from './dates';
import { cyclePosition } from './rotation';
import type { Routine, WorkoutSession } from './types';

export const MIN_DAYS_A_WEEK = 1;
export const MAX_DAYS_A_WEEK = 7;

/** 0 is Sunday, as `Date.getDay()`; listed Monday first, as every week in the app is. */
export const WEEKDAYS_MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;

export interface TrainingPlan {
  /**
   * Weekdays trained on, 0 = Sunday … 6 = Saturday, unique, Monday first. Empty means no fixed
   * days.
   */
  weekdays: number[];
  /**
   * Days a week. With fixed days it is their number; without, the count alone ("three a week,
   * any days"), or null when nothing is chosen and the app reads it from what you do (Auto).
   */
  per_week: number | null;
}

export const EMPTY_PLAN: TrainingPlan = { weekdays: [], per_week: null };

const mondayFirst = (d: number) => (d + 6) % 7;

function sortWeekdays(days: Iterable<number>): number[] {
  return [...new Set(days)]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => mondayFirst(a) - mondayFirst(b));
}

function clampPerWeek(n: number): number {
  return Math.max(MIN_DAYS_A_WEEK, Math.min(MAX_DAYS_A_WEEK, Math.round(n)));
}

/**
 * A stored plan made safe to use. Settings sync between phones and outlive app versions, so
 * anything malformed reads as the nearest sensible plan rather than crashing a screen.
 */
export function cleanPlan(raw: unknown): TrainingPlan {
  if (!raw || typeof raw !== 'object') return EMPTY_PLAN;
  const r = raw as { weekdays?: unknown; per_week?: unknown };
  const weekdays = Array.isArray(r.weekdays)
    ? sortWeekdays(r.weekdays.filter((d): d is number => typeof d === 'number'))
    : [];
  if (weekdays.length > 0) return { weekdays, per_week: weekdays.length };
  const n = typeof r.per_week === 'number' && Number.isFinite(r.per_week) ? r.per_week : null;
  return { weekdays: [], per_week: n == null ? null : clampPerWeek(n) };
}

/** Turns one weekday on or off. Fixed days set the count; clearing the last one leaves Auto. */
export function toggleWeekday(plan: TrainingPlan, weekday: number): TrainingPlan {
  const has = plan.weekdays.includes(weekday);
  const weekdays = sortWeekdays(
    has ? plan.weekdays.filter((d) => d !== weekday) : [...plan.weekdays, weekday],
  );
  return weekdays.length > 0 ? { weekdays, per_week: weekdays.length } : EMPTY_PLAN;
}

/** A count with no fixed days ("three a week, any days"), or Auto with null. */
export function flexiblePlan(per_week: number | null): TrainingPlan {
  return { weekdays: [], per_week: per_week == null ? null : clampPerWeek(per_week) };
}

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayName(d: number, style: 'short' | 'long' = 'short'): string {
  return (style === 'long' ? LONG : SHORT)[d] ?? '';
}

/** "Mon, Wed and Fri"; "Every day" for all seven. */
export function describeWeekdays(weekdays: readonly number[]): string {
  const days = sortWeekdays(weekdays);
  if (days.length === 7) return 'Every day';
  const names = days.map((d) => weekdayName(d));
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** One line for a settings row: "Mon, Wed and Fri", "3 a week, any days", "Auto". */
export function describePlan(plan: TrainingPlan): string {
  if (plan.weekdays.length > 0) return describeWeekdays(plan.weekdays);
  if (plan.per_week != null) return `${plan.per_week} a week, any days`;
  return 'Auto';
}

// ------------------------------------------------------------------------------------- cycle

/**
 * The cycle as stored. `known` is every routine that existed when it was last edited, which is
 * what tells a routine left out on purpose (known, not in a slot) from one created since (not
 * known): the first stays out, the second joins the end.
 */
export interface StoredCycle {
  slots: string[];
  known: string[];
}

export function cleanCycle(raw: unknown): StoredCycle | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { slots?: unknown; known?: unknown };
  if (!Array.isArray(r.slots)) return undefined;
  const strings = (a: unknown[]) => a.filter((x): x is string => typeof x === 'string' && !!x);
  return {
    slots: strings(r.slots),
    known: Array.isArray(r.known) ? [...new Set(strings(r.known))] : [],
  };
}

/**
 * The cycle in force: routine ids in the order they come round.
 *
 * Never edited, it is the routines in their list order, each once — what §20.10 always did.
 * Edited, it is the stored slots minus any routine since deleted, plus any routine created since
 * at the end. A cycle left with nothing in it is no plan at all, so it falls back to the list.
 */
export function effectiveCycle(
  stored: StoredCycle | undefined,
  routines: readonly Pick<Routine, 'id'>[],
): string[] {
  const ids = routines.map((r) => r.id);
  if (!stored || stored.slots.length === 0) return ids;
  const live = new Set(ids);
  const known = new Set(stored.known);
  const slots = stored.slots.filter((id) => live.has(id));
  const added = ids.filter((id) => !known.has(id) && !stored.slots.includes(id));
  const out = [...slots, ...added];
  return out.length > 0 ? out : ids;
}

/** What to store after an edit: the slots, and every routine there is now. */
export function storeCycle(
  slots: readonly string[],
  routines: readonly Pick<Routine, 'id'>[],
): StoredCycle {
  const live = new Set(routines.map((r) => r.id));
  return { slots: slots.filter((id) => live.has(id)), known: [...live] };
}

/** Whether a cycle is just the list in order, each once: the default, worth saying so. */
export function isDefaultCycle(
  cycle: readonly string[],
  routines: readonly Pick<Routine, 'id'>[],
): boolean {
  return cycle.length === routines.length && cycle.every((id, i) => routines[i]?.id === id);
}

// Editing helpers. Pure, so the editor's undo is a value rather than a reversal.

export function moveSlot(slots: readonly string[], from: number, to: number): string[] {
  if (from < 0 || from >= slots.length || to < 0 || to >= slots.length || from === to) {
    return [...slots];
  }
  const out = [...slots];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved!);
  return out;
}

export function removeSlot(slots: readonly string[], index: number): string[] {
  // The last slot stays: a cycle of nothing would silently fall back to the list, which is a
  // surprise in an editor. Remove a routine from the list itself to have none.
  if (slots.length <= 1 || index < 0 || index >= slots.length) return [...slots];
  return slots.filter((_, i) => i !== index);
}

export function addSlot(slots: readonly string[], id: string): string[] {
  return [...slots, id];
}

// ------------------------------------------------------------------- push / pull / legs hint

export type SplitKind = 'push' | 'pull' | 'legs' | 'upper' | 'full' | 'core' | 'other';

const PUSH = new Set(['chest', 'shoulders', 'triceps']);
const PULL = new Set(['lats', 'upper back', 'traps', 'biceps', 'forearms', 'lower back']);
const LEGS = new Set(['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors']);
const CORE = new Set(['abs', 'obliques']);

/**
 * What kind of day a routine is, by where its sets go (primary muscles, weighted by sets). A
 * kind needs a clear majority: 60% of the sets for push, pull or legs; push and pull together
 * for an upper day; and legs alongside an upper body for full body.
 */
export function splitKind(
  items: readonly { exercise_id: string; sets: number }[],
  primaryOf: (exercise_id: string) => string | undefined,
): SplitKind {
  let push = 0;
  let pull = 0;
  let legs = 0;
  let core = 0;
  let total = 0;
  for (const it of items) {
    const m = primaryOf(it.exercise_id);
    const n = Math.max(0, it.sets);
    if (!m || n === 0) continue;
    total += n;
    if (PUSH.has(m)) push += n;
    else if (PULL.has(m)) pull += n;
    else if (LEGS.has(m)) legs += n;
    else if (CORE.has(m)) core += n;
  }
  if (total === 0) return 'other';
  const share = (x: number) => x / total;
  if (share(push) >= 0.6) return 'push';
  if (share(pull) >= 0.6) return 'pull';
  if (share(legs) >= 0.6) return 'legs';
  if (share(core) >= 0.6) return 'core';
  if (share(push + pull) >= 0.75) return 'upper';
  if (share(legs) >= 0.25 && share(push + pull) >= 0.25) return 'full';
  return 'other';
}

/**
 * A cycle that alternates variants of the same kind of day, when the list has them.
 *
 * Push, pull, legs with two push routines listed as four (Chest & Tri, Back & Bi, Legs,
 * Shoulders & Tri) runs, in list order, as push-pull-legs-push — the second push straight
 * after the first's legs, and pull once for every two pushes. What is almost always meant is
 * the six-day lap: Chest & Tri, Back & Bi, Legs, Shoulders & Tri, Back & Bi, Legs. So when one
 * kind has more variants than the others, the lap is repeated once per variant, each kind in its
 * first-listed order, each variant taking its turn. Undefined when there is nothing to
 * alternate, or when the kinds cannot be told apart.
 */
export function alternatingCycle(
  routines: readonly Pick<Routine, 'id'>[],
  kindOf: (id: string) => SplitKind,
): string[] | undefined {
  if (routines.length < 3) return undefined;
  const order: SplitKind[] = [];
  const variants = new Map<SplitKind, string[]>();
  for (const r of routines) {
    const k = kindOf(r.id);
    if (k === 'other' || k === 'core') return undefined;
    if (!variants.has(k)) {
      variants.set(k, []);
      order.push(k);
    }
    variants.get(k)!.push(r.id);
  }
  if (order.length < 2) return undefined;
  const counts = order.map((k) => variants.get(k)!.length);
  const laps = Math.max(...counts);
  // Nothing to alternate, or variants that would not line up into whole laps (three pushes
  // against two pulls) — guessing there is worse than the plain list.
  if (laps < 2 || counts.some((c) => c !== 1 && c !== laps)) return undefined;
  const out: string[] = [];
  for (let lap = 0; lap < laps; lap++) {
    for (const k of order) {
      const v = variants.get(k)!;
      out.push(v[lap % v.length]!);
    }
  }
  return out;
}

// --------------------------------------------------------------------------------- projection

export type DayState =
  /** A finished session that day. */
  | 'done'
  /** A training day gone by with nothing done. */
  | 'missed'
  /** Today, a training day, not yet trained. */
  | 'today'
  /** A training day still ahead. */
  | 'planned'
  /** Not a training day, and nothing done. */
  | 'rest';

export interface ScheduleDay {
  date: string;
  weekday: number;
  /** One of the chosen weekdays. */
  planned: boolean;
  state: DayState;
  /** Sessions finished that day, oldest first. */
  done: { session_id: string; routine_id?: string; name: string }[];
  /** For today and days ahead: the cycle slot this day carries. */
  slot?: { index: number; routine_id: string };
}

export interface ProjectInput {
  /** Routine ids in the order they come round. */
  cycle: readonly string[];
  /** Chosen weekdays; empty means no fixed days and nothing is laid onto a date. */
  weekdays: readonly number[];
  /** Finished sessions of any age; unfinished and deleted ones are ignored. */
  sessions: readonly WorkoutSession[];
  /** First day shown, usually this week's Monday. */
  from: string;
  /** How many days to show. */
  days: number;
  today: string;
}

/**
 * The days from `from`, each with what happened or what is expected.
 *
 * Behind today, a day shows what was done — on a training day or not — and a training day with
 * nothing is missed. Today shows what was done if anything was, else the next slot if it is a
 * training day. Ahead, the training days take the following slots in turn. Because the next slot
 * is wherever the cycle has got to (§20.10), a missed day's routine is simply the next one laid
 * down, which is the rule a person running a rotation already follows.
 */
export function projectSchedule(i: ProjectInput): ScheduleDay[] {
  const planned = new Set(i.weekdays);
  const byDay = new Map<string, ScheduleDay['done']>();
  const finished = i.sessions
    .filter((s) => s.ended_at != null && !s.deleted_at)
    .sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
  for (const s of finished) {
    const key = toDateKey(new Date(s.started_at));
    const list = byDay.get(key) ?? [];
    list.push({
      session_id: s.id,
      name: s.name,
      ...(s.routine_id ? { routine_id: s.routine_id } : {}),
    });
    byDay.set(key, list);
  }
  // Only what has happened by now places the cycle; a session dated ahead of today is a clock
  // error, not progress.
  const pos = cyclePosition(
    i.cycle,
    finished.filter((s) => toDateKey(new Date(s.started_at)) <= i.today),
  );
  let next = pos?.next ?? 0;

  const out: ScheduleDay[] = [];
  for (let k = 0; k < Math.max(0, i.days); k++) {
    const date = addDays(i.from, k);
    const weekday = fromDateKey(date).getDay();
    const isPlanned = planned.has(weekday);
    const done = date <= i.today ? (byDay.get(date) ?? []) : [];
    const base = { date, weekday, planned: isPlanned, done };

    if (done.length > 0) {
      out.push({ ...base, state: 'done' });
    } else if (date < i.today) {
      out.push({ ...base, state: isPlanned ? 'missed' : 'rest' });
    } else if (isPlanned && pos) {
      const index = next;
      next = (next + 1) % i.cycle.length;
      out.push({
        ...base,
        state: date === i.today ? 'today' : 'planned',
        slot: { index, routine_id: i.cycle[index]! },
      });
    } else {
      out.push({ ...base, state: isPlanned ? (date === i.today ? 'today' : 'planned') : 'rest' });
    }
  }
  return out;
}

/** The next `n` routines in the cycle from where it has got to: for a plan with no fixed days. */
export function upcomingSlots(
  cycle: readonly string[],
  sessions: readonly WorkoutSession[],
  n: number,
): { index: number; routine_id: string }[] {
  const pos = cyclePosition(cycle, sessions);
  if (!pos) return [];
  return Array.from({ length: Math.max(0, n) }, (_, k) => {
    const index = (pos.next + k) % cycle.length;
    return { index, routine_id: cycle[index]! };
  });
}

/**
 * "Missed Monday? Chest & Tri moves to Wednesday": the latest training day gone by with
 * nothing done and nothing done since, and where its routine went. Undefined when nothing was
 * missed, or when something has been done since (the cycle has moved on, and the sentence
 * would be about the past).
 */
export function missedMove(
  days: readonly ScheduleDay[],
  today: string,
): { missed: string; moved_to: string; routine_id: string } | undefined {
  let missed: ScheduleDay | undefined;
  for (const d of days) {
    if (d.date >= today) break;
    if (d.state === 'missed') missed = d;
    else if (d.state === 'done') missed = undefined;
  }
  if (!missed) return undefined;
  const to = days.find((d) => d.date >= today && d.slot);
  if (!to?.slot) return undefined;
  // Today already trained means the move has already played out.
  if (days.some((d) => d.date === today && d.state === 'done')) return undefined;
  return { missed: missed.date, moved_to: to.date, routine_id: to.slot.routine_id };
}

/**
 * How often each routine comes round in a week (§20.18 counts the plan by it): its share of the
 * cycle's slots times the days trained. A four-slot cycle on three days is 0.75 a week each; the
 * user's push/pull/legs with alternating push days puts pull and legs at 1, each push at 0.5.
 * Undefined without a number of days, since a cycle alone says nothing about a week.
 */
export function cycleFrequency(
  cycle: readonly string[],
  per_week: number | null,
): Map<string, number> | undefined {
  if (per_week == null || per_week <= 0 || cycle.length === 0) return undefined;
  const out = new Map<string, number>();
  for (const id of cycle) out.set(id, (out.get(id) ?? 0) + per_week / cycle.length);
  return out;
}

/** Monday of the week a day belongs to. */
export function mondayOfKey(date: string): string {
  return addDays(date, -mondayFirst(fromDateKey(date).getDay()));
}
