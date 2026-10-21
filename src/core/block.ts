// SPEC §20.12 — blocks, and the easier week at the end of one.
//
// The evidence here is thin, and the design is sized to it. Two small trials and a consensus of
// coaches support an occasional lighter week for fatigue and adherence, not for faster gains:
// the one trial that stopped training outright for a week cost strength. So the easier week is
// *offered*, never imposed; it is lighter training, never none; and nothing here ramps effort or
// volume across a block, which trials found added nothing.
//
// No block is stored. Where you are in one is derived from your sessions and from the easier
// weeks you have taken, which are the only things kept: date ranges, in settings.
import { addDays, diffDays, toDateKey } from './dates';
import { nextPrescription, performances, workingLoad, type Performance } from './progression';
import { isWorkingSet } from './sets';
import type { LoadType, WorkoutSession } from './types';

/** Five ordinary weeks and an easier one: the middle of the 4–8 coaches use. */
export const BLOCK_WEEKS = 6;

export const EASY_WEEK_DAYS = 7;

/**
 * Someone this new to logging gets no scheduled easier week. Beginners recover between sessions
 * faster than they accumulate fatigue; a first stall, which ends this early, is the sign that
 * has changed.
 */
export const BEGINNER_WEEKS = 12;

/** Signals can bring the offer forward, but not into the first fortnight of a block. */
export const EARLY_FROM_WEEK = 3;

/** One lift stalling is that lift's problem, and it has its own back-off. Two is the week's. */
export const SIGNAL_LIFTS = 2;

/** Fewer reps at the same weight, session to session, by at least this many. */
export const REP_DROP = 2;

/** A lift not trained this recently says nothing about how the body is coping now. */
export const SIGNAL_RECENT_DAYS = 21;

/** Inclusive local date keys. */
export interface EasyWeek {
  from: string;
  to: string;
}

export function isEasyDay(date: string, weeks: readonly EasyWeek[]): boolean {
  return weeks.some((w) => w.from <= date && date <= w.to);
}

/**
 * Sessions minus those done in an easier week. Progression must not see them: a week of
 * deliberately short sets would otherwise read as three stalls, and the load would drop for
 * having done exactly what was asked.
 */
export function withoutEasy<T extends Pick<WorkoutSession, 'started_at'>>(
  sessions: readonly T[],
  weeks: readonly EasyWeek[],
): T[] {
  if (weeks.length === 0) return [...sessions];
  return sessions.filter((s) => !isEasyDay(toDateKey(new Date(s.started_at)), weeks));
}

/** Half the sets, rounded up, never none. */
export function easySets(sets: number): number {
  return Math.max(1, Math.ceil(sets / 2));
}

export interface LiftSignals {
  /** Names of lifts whose own rule says back off (§20.8). */
  stalled: string[];
  /** Names of lifts that lost reps at an unchanged weight last time. */
  slipping: string[];
}

function topRepsAt(perf: Performance, load: number): number {
  let top = 0;
  for (const s of perf) {
    if (isWorkingSet(s) && s.weight_kg === load && (s.reps ?? 0) > top) top = s.reps ?? 0;
  }
  return top;
}

/**
 * What the lifts themselves say. Only lifts trained in the last three weeks count, and each by
 * the rep range its routine gives it, since a stall means nothing without a range to clear.
 */
export function liftSignals(
  sessions: readonly WorkoutSession[],
  ranges: ReadonlyMap<string, { rep_low?: number; rep_high?: number }>,
  today: string,
): LiftSignals {
  const latest = new Map<string, { name: string; load_type: LoadType; date: string }>();
  for (const s of sessions) {
    if (!s.ended_at) continue;
    const date = toDateKey(new Date(s.started_at));
    for (const e of s.entries) {
      const seen = latest.get(e.exercise_id);
      if (!seen || date > seen.date) {
        latest.set(e.exercise_id, { name: e.name, load_type: e.load_type, date });
      }
    }
  }

  const out: LiftSignals = { stalled: [], slipping: [] };
  for (const [id, { name, load_type, date }] of latest) {
    if (diffDays(date, today) > SIGNAL_RECENT_DAYS) continue;
    const perfs = performances(sessions, id);
    const range = ranges.get(id) ?? {};
    if (nextPrescription(perfs, { load_type, ...range }).kind === 'deload') {
      out.stalled.push(name);
      continue;
    }
    const [last, before] = perfs;
    if (!last || !before || load_type === 'time' || load_type === 'distance_time') continue;
    const load = workingLoad(last);
    if (load == null || workingLoad(before) !== load) continue;
    if (topRepsAt(before, load) - topRepsAt(last, load) >= REP_DROP) out.slipping.push(name);
  }
  out.stalled.sort();
  out.slipping.sort();
  return out;
}

export type OfferReason = 'scheduled' | 'stalled' | 'slipping';

export type BlockState =
  | { kind: 'none' }
  | { kind: 'easy'; week: EasyWeek }
  | {
      kind: 'block';
      /** 1-based week of the current block. */
      week: number;
      /** New enough that no easier week is scheduled; signals still count. */
      beginner: boolean;
      offer?: { reason: OfferReason; lifts: string[] };
    };

export interface BlockInputs {
  /** Finished sessions, any age; easier-week ones included. */
  sessions: readonly WorkoutSession[];
  easyWeeks: readonly EasyWeek[];
  /** When "not now" was last said to an offer: a fresh block counts from that day. */
  resetOn?: string;
  signals: LiftSignals;
  today: string;
}

/**
 * Where you are. A block starts at the first session, the first session after a week or more
 * off, the day after an easier week ends, or the day an offer was turned down — whichever is
 * latest — so declining is never a nag that comes back tomorrow: it is a new block, and the
 * offer returns when that one is due.
 */
export function blockState(i: BlockInputs): BlockState {
  const active = i.easyWeeks.find((w) => w.from <= i.today && i.today <= w.to);
  if (active) return { kind: 'easy', week: active };

  const days = i.sessions
    .filter((s) => s.ended_at)
    .map((s) => toDateKey(new Date(s.started_at)))
    .sort();
  const first = days[0];
  if (!first) return { kind: 'none' };

  // A week or more off is a break already, whatever it was called, so the block restarts at
  // the first session after one. Without this, a summer away would come back as "week 14".
  let start = first;
  for (let k = 1; k < days.length; k++) {
    if (diffDays(days[k - 1]!, days[k]!) > EASY_WEEK_DAYS) start = days[k]!;
  }
  for (const w of i.easyWeeks) {
    const after = addDays(w.to, 1);
    if (after <= i.today && after > start) start = after;
  }
  if (i.resetOn && i.resetOn <= i.today && i.resetOn > start) start = i.resetOn;

  const week = Math.floor(diffDays(start, i.today) / 7) + 1;
  const beginner =
    diffDays(first, i.today) < BEGINNER_WEEKS * 7 &&
    i.signals.stalled.length === 0 &&
    i.easyWeeks.length === 0;

  let offer: { reason: OfferReason; lifts: string[] } | undefined;
  if (week >= EARLY_FROM_WEEK && i.signals.stalled.length >= SIGNAL_LIFTS) {
    offer = { reason: 'stalled', lifts: i.signals.stalled };
  } else if (week >= EARLY_FROM_WEEK && i.signals.slipping.length >= SIGNAL_LIFTS) {
    offer = { reason: 'slipping', lifts: i.signals.slipping };
  } else if (!beginner && week >= BLOCK_WEEKS) {
    offer = { reason: 'scheduled', lifts: [] };
  }
  return { kind: 'block', week, beginner, ...(offer ? { offer } : {}) };
}

/** An easier week starting today. */
export function easyWeekFrom(today: string): EasyWeek {
  return { from: today, to: addDays(today, EASY_WEEK_DAYS - 1) };
}

/**
 * The list with the running easier week ended as of yesterday. A week begun and ended on the
 * same day leaves nothing behind, since no session can have been done in it yet.
 */
export function endEasyWeek(weeks: readonly EasyWeek[], today: string): EasyWeek[] {
  return weeks.flatMap((w) => {
    if (!(w.from <= today && today <= w.to)) return [w];
    return w.from === today ? [] : [{ from: w.from, to: addDays(today, -1) }];
  });
}
