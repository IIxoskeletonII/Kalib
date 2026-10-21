// SPEC §21 — the circle: what a week is worth, in a form friends can compare.
//
// Everything in a training log is self-reported, so a board ranked by weight lifted rewards the
// biggest person and the least honest one. This one ranks on two things anyone can do well at
// any size or level:
//
//   **Showing up** — sessions done against the sessions you said you would do. It is most of
//   the score, because it is what most of the results come from and the one thing nobody can
//   claim to be bad at for reasons of build.
//
//   **Getting stronger than you were** — your own lifts now against your own lifts a month
//   before, through DOTS (core/dots.ts) so that a cut which holds strength counts as the gain it
//   is. Never against anyone else's lifts.
//
// Jumps that do not look like training are left out of the score rather than called out: a
// typo and a lie look the same from here, and only one of them deserves an accusation. A real
// jump confirms itself by happening again.
//
// What leaves the phone is the output of this file — a handful of small integers a week — and
// nothing it was computed from (§21.2).
import { withoutEasy, type EasyWeek } from './block';
import { addDays, diffDays, toDateKey } from './dates';
import { dotsCoefficient } from './dots';
import { bestE1rm } from './sets';
import { bodyweightOn } from './strength';
import {
  mondayOf,
  SKIPS_PER_MONTH,
  skipsCovered,
  trainingStreak,
  type StreakWeek,
  type WeeklyAim,
} from './streak';
import type { Sex, WorkoutSession } from './types';

/** Weeks the board looks back over, the week in progress not among them. */
export const BOARD_WEEKS = 4;
/** Showing up is most of the score; progress is the rest. */
export const CONSISTENCY_WEIGHT = 0.6;
/** Days in each of the two windows progress compares: the last four weeks and the four before. */
export const PROGRESS_WINDOW_DAYS = 28;
/**
 * Relative-strength change over a window that earns full marks. Holding steady scores 50, and
 * 2.5% a month is a good month for anyone past their first year; a beginner gets there easily,
 * which is fine, because a beginner improving fast is the truth.
 */
export const PROGRESS_FULL_MARKS = 0.025;
/** A session best may beat the best before it by this share, plus the slack below… */
export const JUMP_SHARE = 0.15;
/** …which is what lets light lifts move in whole plates without tripping anything. */
export const JUMP_SLACK_KG = 7.5;
/** A second session within this share of a flagged one confirms both. */
export const CONFIRM_SHARE = 0.05;
/**
 * No estimated one-rep max above this is believed, ever. The heaviest lifts in history sit just
 * above 500 kg; anything past it here is a slipped digit.
 */
export const E1RM_CEILING_KG = 500;
/** Hard mode: days short forgiven per calendar month — the streak's allowance, shared. */
export { SKIPS_PER_MONTH };
/** Hard mode: the rating everyone starts at, and the bar each week is measured against. */
export const RATING_START = 1000;
/** Hard mode: the most one week can move the rating. */
export const RATING_K = 32;

// ---- weeks ----------------------------------------------------------------------------------
//
// A week is the streak's week (core/streak.ts, §20.15): Monday to Sunday, charged to the month
// of its Thursday, with the aim it had then. There is one aim in the app and one way of counting
// against it; the circle reads them rather than keeping a second of each.

/** The last `n` whole weeks before `today`'s week, oldest first, as Mondays. */
export function pastWeeks(today: string, n: number): string[] {
  const current = mondayOf(today);
  return Array.from({ length: n }, (_, i) => addDays(current, -7 * (n - i)));
}

// ---- showing up -----------------------------------------------------------------------------

/**
 * 0–100: training days against the aim. Days beyond the aim are welcome and score nothing
 * extra: the aim is the bar.
 */
export function consistencyScore(t: { planned: number; done: number }): number {
  if (t.planned <= 0) return 0;
  return Math.round((100 * Math.min(t.done, t.planned)) / t.planned);
}

/**
 * A week's consistency as the circle scores it. An easier week (§20.12) short of the aim scores
 * as kept: taking one is following the plan, and the streak says the same by never letting one
 * break a run. The week in progress is scored as it stands, against the whole week's aim.
 */
export function weekConsistency(w: Pick<StreakWeek, 'aim' | 'days' | 'status'>): number {
  if (w.status === 'easy') return 100;
  return consistencyScore({ planned: w.aim, done: w.days });
}

// ---- getting stronger -----------------------------------------------------------------------

export interface LiftReading {
  date: string;
  /** Estimated one-rep max, kg. */
  value: number;
}

export interface ScreenedLift {
  accepted: LiftReading[];
  /** Left out of the score. Not wrong, necessarily: unconfirmed. */
  flagged: LiftReading[];
}

/** The most a session best may be, given the best accepted before it. */
export function plausibleCeiling(best: number): number {
  return best * (1 + JUMP_SHARE) + JUMP_SLACK_KG;
}

/**
 * Sorts one lift's session bests into those the score uses and those it waits on.
 *
 * A best is accepted when it is within reach of the best accepted before it. One that is not is
 * held back; if a later session lands within 5% of it, both are accepted, because two sessions
 * agreeing is what a real step up looks like and a typo almost never repeats itself. Only
 * upward jumps are screened: a number that is too low hurts nobody's ranking but its owner's.
 */
export function screenLift(readings: readonly LiftReading[]): ScreenedLift {
  const sorted = [...readings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const accepted: LiftReading[] = [];
  const flagged: LiftReading[] = [];
  let best: number | undefined;
  let pending: LiftReading | undefined;

  for (const r of sorted) {
    if (!(r.value > 0) || r.value > E1RM_CEILING_KG) {
      flagged.push(r);
      continue;
    }
    // The epsilon keeps 122.5 on a best of 100 inside the line it is drawn on: 1.15 is not
    // exact in binary, and a boundary that moves with rounding is not a boundary.
    if (best == null || r.value <= plausibleCeiling(best) + 1e-9) {
      accepted.push(r);
      best = Math.max(best ?? 0, r.value);
      continue;
    }
    if (pending && Math.abs(r.value - pending.value) <= CONFIRM_SHARE * pending.value) {
      const confirmed = pending;
      flagged.splice(flagged.indexOf(confirmed), 1);
      accepted.push(confirmed, r);
      best = Math.max(best, confirmed.value, r.value);
      pending = undefined;
      continue;
    }
    pending = r;
    flagged.push(r);
  }
  accepted.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { accepted, flagged };
}

export interface StrengthInputs {
  sessions: readonly WorkoutSession[];
  weighIns: readonly { date: string; weight_kg: number }[];
  /** Absent when no profile: the comparison falls back to raw kilograms. */
  sex?: Sex;
  /** Easier-week sessions are lighter by design and say nothing about strength (§20.12). */
  easyWeeks?: readonly EasyWeek[];
}

export interface StrengthChange {
  /** Relative change, current over baseline, minus one. 0.02 is two percent stronger. */
  change: number;
  /** Lifts present in both windows, which is what the comparison is made over. */
  lifts: number;
  /** Session bests in the current window left out by `screenLift`. */
  flagged: number;
  /** True when both windows had a bodyweight and a sex to normalise by. */
  normalised: boolean;
}

/** Session bests per lift, each with the bodyweight on its day. Loaded lifts only. */
function readingsByLift(i: StrengthInputs): Map<string, LiftReading[]> {
  const out = new Map<string, LiftReading[]>();
  for (const s of withoutEasy(i.sessions, i.easyWeeks ?? [])) {
    if (!s.ended_at || s.deleted_at) continue;
    const date = toDateKey(new Date(s.started_at));
    const bw = bodyweightOn(i.weighIns, date);
    const bestToday = new Map<string, number>();
    for (const e of s.entries) {
      // Reps and holds have no common scale with a barbell; distance has none at all.
      if (e.load_type !== 'weight_reps' && e.load_type !== 'weighted_bodyweight') continue;
      const v = bestE1rm(e, bw);
      if (v == null) continue;
      bestToday.set(e.exercise_id, Math.max(bestToday.get(e.exercise_id) ?? 0, v));
    }
    for (const [id, value] of bestToday) {
      const list = out.get(id) ?? [];
      list.push({ date, value });
      out.set(id, list);
    }
  }
  return out;
}

/** Session bests in the four weeks ending `asOf` that the score is waiting on. */
export function flaggedBests(i: StrengthInputs, asOf: string): number {
  const from = addDays(asOf, -(PROGRESS_WINDOW_DAYS - 1));
  let n = 0;
  for (const readings of readingsByLift(i).values()) {
    n += screenLift(readings.filter((r) => r.date <= asOf)).flagged.filter(
      (r) => r.date >= from,
    ).length;
  }
  return n;
}

/**
 * Relative strength over the four weeks ending `asOf`, against the four weeks before them.
 *
 * Per lift, the best accepted session in each window; summed over the lifts trained in both, so
 * a lift taken up or dropped this month neither adds nor costs anything. Each sum is weighted
 * by the DOTS coefficient for the bodyweight at the end of its window.
 */
export function strengthChange(i: StrengthInputs, asOf: string): StrengthChange | undefined {
  const currentFrom = addDays(asOf, -(PROGRESS_WINDOW_DAYS - 1));
  const baselineFrom = addDays(currentFrom, -PROGRESS_WINDOW_DAYS);
  const baselineTo = addDays(currentFrom, -1);

  let current = 0;
  let baseline = 0;
  let lifts = 0;
  let flagged = 0;
  for (const readings of readingsByLift(i).values()) {
    // Screened over everything up to `asOf`, so the bar a jump is judged against is the same
    // whichever week is being scored.
    const screened = screenLift(readings.filter((r) => r.date <= asOf));
    flagged += screened.flagged.filter((r) => r.date >= currentFrom).length;
    const bestIn = (from: string, to: string) =>
      screened.accepted
        .filter((r) => r.date >= from && r.date <= to)
        .reduce<number | undefined>((m, r) => (m == null || r.value > m ? r.value : m), undefined);
    const now = bestIn(currentFrom, asOf);
    const then = bestIn(baselineFrom, baselineTo);
    if (now == null || then == null) continue;
    current += now;
    baseline += then;
    lifts++;
  }
  if (lifts === 0 || baseline <= 0) return undefined;

  const bwNow = bodyweightOn(i.weighIns, asOf);
  const bwThen = bodyweightOn(i.weighIns, baselineTo);
  const kNow = i.sex && bwNow != null ? dotsCoefficient(i.sex, bwNow) : undefined;
  const kThen = i.sex && bwThen != null ? dotsCoefficient(i.sex, bwThen) : undefined;
  const normalised = kNow != null && kThen != null;
  const change = normalised ? (kNow * current) / (kThen * baseline) - 1 : current / baseline - 1;
  return { change, lifts, flagged, normalised };
}

/** 0–100: 50 for holding steady, 100 at `PROGRESS_FULL_MARKS` and above, 0 at its mirror. */
export function progressScore(change: number): number {
  if (!Number.isFinite(change)) return 50;
  return Math.round(Math.min(100, Math.max(0, 50 + (change / PROGRESS_FULL_MARKS) * 50)));
}

/** A week's score. Without a progress figure it is consistency alone, not consistency halved. */
export function weekScore(consistency: number, progress?: number): number {
  if (progress == null) return Math.round(consistency);
  return Math.round(CONSISTENCY_WEIGHT * consistency + (1 - CONSISTENCY_WEIGHT) * progress);
}

// ---- hard mode ------------------------------------------------------------------------------

export interface JudgedWeek {
  /** The Monday. */
  week: string;
  planned: number;
  done: number;
  /** Days short of the aim. */
  missed: number;
  /** Of those, the days the month's skips covered — the same skips the streak spends. */
  skipped: number;
  /** 0–1: the share of the aim met once skips are counted. */
  outcome: number;
}

/**
 * The first week hard mode judges: the one starting on or after the day it was switched on. A
 * week already under way when someone opts in is not held against them.
 */
export function firstJudgedWeek(since: string): string {
  const monday = mondayOf(since);
  return monday === since ? since : addDays(monday, 7);
}

/**
 * The whole weeks hard mode judges, from `from` (a Monday) up to the week of `today`, which is
 * not over and is never judged.
 *
 * The skips are the streak's: one allowance a month, charged in date order to every short week
 * of the month whether hard mode was on for it or not — so the "2 of 3 skips left" on Train is
 * the number hard mode is working from too. An easier week short of the aim is not judged at
 * all: it can cost nothing, and since it was not a test of keeping the aim, it earns nothing
 * either. One that met the aim anyway counts like any met week.
 */
export function judgeWeeks(
  history: readonly StreakWeek[],
  from: string,
  today: string,
  allowed: number = SKIPS_PER_MONTH,
): JudgedWeek[] {
  const current = mondayOf(today);
  const covered = skipsCovered(history, allowed);
  const out: JudgedWeek[] = [];
  for (const w of history) {
    if (w.monday < from || w.monday >= current) continue;
    if (w.status === 'easy' || w.status === 'open') continue;
    const skipped = covered.get(w.monday) ?? 0;
    const outcome = w.aim > 0 ? Math.min(1, (w.days + skipped) / w.aim) : 1;
    out.push({ week: w.monday, planned: w.aim, done: w.days, missed: w.short, skipped, outcome });
  }
  return out;
}

/** The chance the rating "expects" a full week, as Elo would against a 1000-rated opponent. */
export function expectedOutcome(rating: number): number {
  return 1 / (1 + 10 ** ((RATING_START - rating) / 400));
}

/**
 * One week of hard mode. Each week is a match against your own aim, scored by the share
 * of it you met. The higher the rating, the more a full week is expected and the less it adds,
 * and the more a miss costs — which is the whole of hard mode: the better your record, the more
 * there is to lose. One week never moves the rating by more than K.
 */
export function rateWeek(rating: number, outcome: number): number {
  const o = Math.min(1, Math.max(0, outcome));
  return rating + RATING_K * (o - expectedOutcome(rating));
}

/** The hard-mode rating after every judged week, from `RATING_START`. */
export function hardRating(weeks: readonly JudgedWeek[]): number {
  return weeks.reduce((r, w) => rateWeek(r, w.outcome), RATING_START);
}

// ---- what is published ----------------------------------------------------------------------

/**
 * One week as it leaves the phone. Integers only, all of them derived; nothing here can be
 * turned back into a set, a food, a weight or a date of a session.
 */
export interface CircleWeek {
  week: string;
  planned: number;
  done: number;
  consistency: number;
  /** Absent until there are two windows of history to compare. */
  progress?: number;
  score: number;
  flagged: number;
  hard: boolean;
  /** Present only in hard mode. */
  rating?: number;
}

export interface CircleInputs extends StrengthInputs {
  /** The weekly aims you set (§20.15); absent or empty, the aim is the streak's own reading. */
  aims?: readonly WeeklyAim[];
  /** Day hard mode was switched on; absent when it is off. */
  hardSince?: string;
  today: string;
}

/**
 * The weeks to publish: the last `BOARD_WEEKS` whole weeks and the week in progress, from the
 * first week you trained. Weeks before that are not yours to be scored on — publishing them as
 * empty would rank a newcomer on the month before they started. A whole week's progress is
 * taken at its Sunday; the week in progress, at today.
 *
 * `sessions` should be every finished session there is, not a window: the aim is read from
 * them and the month's skips charged across them, exactly as the streak does.
 */
export function circleWeeks(i: CircleInputs): CircleWeek[] {
  const { history } = trainingStreak(i.sessions, i.today, {
    ...(i.aims ? { aims: i.aims } : {}),
    ...(i.easyWeeks ? { easyWeeks: i.easyWeeks } : {}),
  });
  const current = mondayOf(i.today);
  const shown = new Set([...pastWeeks(i.today, BOARD_WEEKS), current]);

  // Hard mode is judged over every whole week since it was switched on, not only those shown,
  // so the rating is a record rather than a rolling window.
  const ratings = new Map<string, number>();
  if (i.hardSince) {
    let r = RATING_START;
    for (const j of judgeWeeks(history, firstJudgedWeek(i.hardSince), i.today)) {
      r = rateWeek(r, j.outcome);
      ratings.set(j.week, r);
    }
  }

  return history
    .filter((w) => shown.has(w.monday))
    .map((w) => {
      const asOf = w.monday === current ? i.today : addDays(w.monday, 6);
      const strength = strengthChange(i, asOf);
      const consistency = weekConsistency(w);
      const progress = strength ? progressScore(strength.change) : undefined;
      // A week counts as hard once it is judged; the week it was switched on in shows as hard
      // too while it is the current one, so the toggle visibly takes effect.
      const hard =
        i.hardSince != null &&
        (w.monday >= firstJudgedWeek(i.hardSince) ||
          (w.monday === current && i.hardSince <= i.today));
      // The week in progress shows the rating as it stands, which is the last whole week's.
      const rating = hard ? latestRating(ratings, w.monday) : undefined;
      return {
        week: w.monday,
        planned: w.aim,
        done: w.days,
        consistency,
        ...(progress != null ? { progress } : {}),
        score: weekScore(consistency, progress),
        flagged: strength?.flagged ?? flaggedBests(i, asOf),
        hard,
        ...(rating != null ? { rating } : {}),
      };
    });
}

function latestRating(ratings: ReadonlyMap<string, number>, upTo: string): number {
  let best: string | undefined;
  for (const w of ratings.keys()) if (w <= upTo && (best == null || w > best)) best = w;
  return Math.round(best == null ? RATING_START : ratings.get(best)!);
}

// ---- the board ------------------------------------------------------------------------------

export interface BoardWeek {
  member_id: string;
  display_name: string;
  is_me: boolean;
  is_owner: boolean;
  week: string;
  planned: number;
  done: number;
  consistency: number;
  progress: number | null;
  score: number;
  flagged: number;
  hard: boolean;
  rating: number | null;
}

export interface BoardRow {
  member_id: string;
  display_name: string;
  is_me: boolean;
  is_owner: boolean;
  /** Mean score over the whole weeks shown; a member with none is unranked, not zero. */
  score?: number;
  rank?: number;
  /** This week so far. */
  done: number;
  planned: number;
  hard: boolean;
  rating?: number;
  /** Whole weeks the mean was taken over. */
  weeks: number;
}

/**
 * Ranks a circle from the weeks its members published. The week in progress is shown but not
 * ranked: on a Tuesday it would rank whoever trains on Mondays. A whole week with nothing
 * published counts as nothing done — the phone publishes every past week each time it opens,
 * so a gap means no training rather than no signal.
 */
export function rankBoard(rows: readonly BoardWeek[], today: string): BoardRow[] {
  const current = mondayOf(today);
  const whole = new Set(pastWeeks(today, BOARD_WEEKS));
  const byMember = new Map<string, BoardWeek[]>();
  for (const r of rows) {
    const list = byMember.get(r.member_id) ?? [];
    list.push(r);
    byMember.set(r.member_id, list);
  }

  const out: BoardRow[] = [];
  for (const [member_id, weeks] of byMember) {
    const first = weeks[0]!;
    const counted = weeks.filter((w) => whole.has(w.week));
    const now = weeks.find((w) => w.week === current);
    const latest = [...weeks].sort((a, b) => (a.week < b.week ? 1 : -1))[0]!;
    // Every whole week since the member's first published one, so a skipped week is a zero.
    const firstWeek = counted.reduce<string | undefined>(
      (m, w) => (m == null || w.week < m ? w.week : m),
      undefined,
    );
    const span = firstWeek ? [...whole].filter((w) => w >= firstWeek).length : 0;
    const total = counted.reduce((s, w) => s + w.score, 0);
    out.push({
      member_id,
      display_name: first.display_name,
      is_me: first.is_me,
      is_owner: first.is_owner,
      ...(span > 0 ? { score: Math.round(total / span) } : {}),
      done: now?.done ?? 0,
      planned: now?.planned ?? latest.planned,
      hard: latest.hard,
      ...(latest.hard && latest.rating != null ? { rating: latest.rating } : {}),
      weeks: span,
    });
  }

  out.sort(
    (a, b) =>
      (b.score ?? -1) - (a.score ?? -1) ||
      a.display_name.localeCompare(b.display_name) ||
      a.member_id.localeCompare(b.member_id),
  );
  // Ties share a rank, and the next rank skips past them, as a results table does.
  let rank = 0;
  out.forEach((r, i) => {
    if (r.score == null) return;
    if (i === 0 || r.score !== out[i - 1]!.score) rank = i + 1;
    r.rank = rank;
  });
  return out;
}

/** Days until the week in progress is judged, for "3 days left this week". */
export function daysLeftInWeek(today: string): number {
  return 6 - diffDays(mondayOf(today), today);
}
