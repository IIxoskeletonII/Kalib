// SPEC §20.15 — the training streak.
//
// Three findings decide the shape, and they all point the same way:
//
//   A broken streak costs more than an intact one earns. Breaking one makes people less likely
//   to do the thing again at all, not just less likely to rebuild the run (Silverman & Barasch,
//   J. Consumer Research, 2023), and missing a single occasion does not measurably slow habit
//   formation (Lally et al., 2010). `core/adherence.ts` already forgives a missed day of logging
//   for this reason; training gets the same courtesy.
//
//   Training is weekly, not daily. A rest day is part of the program, so a daily streak would
//   either punish recovery or count it as success and mean nothing. Counting in weeks is what
//   Hevy does and what the streak research suggests when the behaviour is not daily.
//
//   Kalib's week is a rotation, not a calendar (§20.10). Missing Wednesday leaves Wednesday's
//   routine next; it does not skip it. So the streak cannot be "did you train on Wednesday",
//   only "did you train as often as you mean to this week".
//
// So: **a week counts when it has as many training days as your aim**, and each month carries
// three skips — sessions short of the aim that do not break the run. An easier week (§20.12)
// can never break it, since taking one is following the plan. A week or more off with no
// easier week declared is still a miss: it spends skips like any other shortfall.
//
// Nothing is stored except the aim, when you set one. The run is derived from sessions.
import { addDays, fromDateKey, toDateKey } from './dates';
import { isEasyDay, type EasyWeek } from './block';
import { isWorkingSet } from './sets';
import type { WorkoutSession } from './types';

/** Sessions short of the aim that a month forgives before a run breaks. */
export const SKIPS_PER_MONTH = 3;

/** Weeks of your own history the aim is read from when you have not set one. */
export const AIM_LOOKBACK_WEEKS = 4;

/** Fewer closed weeks than this and there is no pattern yet: the aim is one a week. */
export const AIM_MIN_WEEKS = 2;

export const MIN_AIM = 1;
export const MAX_AIM = 7;

/**
 * An aim you set, from the week starting `from` (a Monday) onward. `sessions: null` hands the
 * choice back to the app from that week. Kept as a list so changing the aim never rewrites
 * weeks that are already over.
 */
export interface WeeklyAim {
  from: string;
  sessions: number | null;
}

export type WeekStatus =
  /** As many training days as the aim, or more. */
  | 'met'
  /** Short, and the month's skips covered it. */
  | 'forgiven'
  /** Touched an easier week: never a miss. */
  | 'easy'
  /** Short with no skips left: the run ends here. */
  | 'missed'
  /** The current week, not yet met. Not over, so not judged. */
  | 'open';

export interface StreakWeek {
  /** Monday, `YYYY-MM-DD`. */
  monday: string;
  /** Distinct local days with a finished session. Two sessions on one day are one day. */
  days: number;
  /** The last of those days, when there is one. */
  last_day?: string;
  aim: number;
  /** Where the aim came from: what you set, or what your recent weeks show. */
  aim_source: 'set' | 'inferred' | 'default';
  /** Training days short of the aim; 0 for met, easy and open weeks. */
  short: number;
  status: WeekStatus;
  /** `YYYY-MM` the week's skips are charged to: the month holding its Thursday, as ISO does. */
  month: string;
}

export interface StreakRun {
  /** Weeks in the run, forgiven and easier weeks included. */
  weeks: number;
  /** Monday of its first week. */
  from?: string;
  /** Training days within it. */
  days: number;
}

export interface TrainingStreak {
  current: StreakRun;
  best: StreakRun;
  /** The week containing `today`. */
  this_week: StreakWeek;
  /** Skips charged to the month this week belongs to, capped at the allowance. */
  skips: { month: string; used: number; left: number; allowed: number };
  /** Every week from the first trained one to this one, oldest first. */
  history: StreakWeek[];
}

export interface StreakOptions {
  aims?: readonly WeeklyAim[];
  easyWeeks?: readonly EasyWeek[];
  skipsPerMonth?: number;
}

/** Monday of the week a local day belongs to. Weeks start on Monday, as §5 and §20.5 do. */
export function mondayOf(date: string): string {
  // getDay: 0 is Sunday, which belongs to the week that began six days earlier.
  return addDays(date, -((fromDateKey(date).getDay() + 6) % 7));
}

/**
 * The month a week is charged to: the one holding its Thursday. A week straddling two months
 * belongs to the one with four of its days, which is the ISO 8601 rule for which year a week
 * is in, applied to months.
 */
export function monthOfWeek(monday: string): string {
  return addDays(monday, 3).slice(0, 7);
}

/**
 * Distinct local days with a finished, live session that did some work. An empty workout
 * started and finished by accident is not a training day, and a streak that counted it would be
 * one tap from meaningless.
 */
export function trainedDays(sessions: readonly WorkoutSession[]): Set<string> {
  const out = new Set<string>();
  for (const s of sessions) {
    if (s.ended_at == null || s.deleted_at != null) continue;
    if (!s.entries.some((e) => e.sets.some(isWorkingSet))) continue;
    const at = new Date(s.started_at);
    if (Number.isNaN(at.getTime())) continue;
    out.add(toDateKey(at));
  }
  return out;
}

function clampAim(n: number): number {
  return Math.max(MIN_AIM, Math.min(MAX_AIM, Math.round(n)));
}

/**
 * The aim you set that governs a week: a number, null for "work it out", or undefined when you
 * have never set one.
 */
export function aimSetFor(monday: string, aims: readonly WeeklyAim[]): number | null | undefined {
  let found: WeeklyAim | undefined;
  for (const a of aims) {
    if (a.from <= monday && (!found || a.from >= found.from)) found = a;
  }
  return found ? found.sessions : undefined;
}

/**
 * What your recent weeks show: the lower median of training days over the closed weeks before
 * this one, since you started. A median rather than a mean, so one holiday week does not lower
 * the bar and one double week does not raise it; the lower of the two middles, so the bar
 * follows you down a little sooner than it follows you up, which is the kinder error.
 */
export function inferAim(
  monday: string,
  days: ReadonlySet<string>,
  firstMonday: string,
  lookback = AIM_LOOKBACK_WEEKS,
): number | undefined {
  const counts: number[] = [];
  for (let k = 1; k <= lookback; k++) {
    const m = addDays(monday, -7 * k);
    if (m < firstMonday) break;
    counts.push(daysInWeek(m, days));
  }
  if (counts.length < AIM_MIN_WEEKS) return undefined;
  counts.sort((a, b) => a - b);
  return clampAim(counts[Math.floor((counts.length - 1) / 2)]!);
}

function daysInWeek(monday: string, days: ReadonlySet<string>): number {
  let n = 0;
  for (let i = 0; i < 7; i++) if (days.has(addDays(monday, i))) n++;
  return n;
}

function touchesEasyWeek(monday: string, easyWeeks: readonly EasyWeek[]): boolean {
  if (easyWeeks.length === 0) return false;
  for (let i = 0; i < 7; i++) if (isEasyDay(addDays(monday, i), easyWeeks)) return true;
  return false;
}

const KEEPS: ReadonlySet<WeekStatus> = new Set(['met', 'forgiven', 'easy']);

/**
 * The run as it stood at the end of each week, oldest first. A run counts every week it
 * survived, forgiven and easier ones included, but never begins with a week you did not train
 * in, as `adherence.currentRun` never begins with a gap. The open week, until met, is not over
 * and carries the run unchanged.
 */
export function runsByWeek(history: readonly StreakWeek[]): StreakRun[] {
  const out: StreakRun[] = [];
  let run: StreakRun = { weeks: 0, days: 0 };
  for (const w of history) {
    if (w.status === 'open') {
      out.push(run);
      continue;
    }
    if (!KEEPS.has(w.status)) run = { weeks: 0, days: 0 };
    else if (run.weeks > 0 || w.days > 0) {
      run = { weeks: run.weeks + 1, from: run.from ?? w.monday, days: run.days + w.days };
    }
    out.push(run);
  }
  return out;
}

/**
 * The streak as of `today`, from finished sessions of any age.
 *
 * The current week is never a miss — it is not over — so the run is measured to the end of
 * last week, plus this week once it is met.
 */
export function trainingStreak(
  sessions: readonly WorkoutSession[],
  today: string,
  opts: StreakOptions = {},
): TrainingStreak {
  const aims = opts.aims ?? [];
  const easyWeeks = opts.easyWeeks ?? [];
  const allowed = Math.max(0, Math.floor(opts.skipsPerMonth ?? SKIPS_PER_MONTH));
  const thisMonday = mondayOf(today);

  // A session dated after today (a clock that was wrong, a synced phone in another zone) says
  // nothing about the run so far.
  const days = new Set([...trainedDays(sessions)].filter((d) => d <= today));
  const first = [...days].sort()[0];
  const firstMonday = first ? mondayOf(first) : thisMonday;

  const charged = new Map<string, number>();
  const history: StreakWeek[] = [];
  for (let monday = firstMonday; monday <= thisMonday; monday = addDays(monday, 7)) {
    const n = daysInWeek(monday, days);
    const set = aimSetFor(monday, aims);
    const inferred = set == null ? inferAim(monday, days, firstMonday) : undefined;
    const aim = set != null ? clampAim(set) : (inferred ?? MIN_AIM);
    const aim_source: StreakWeek['aim_source'] =
      set != null ? 'set' : inferred != null ? 'inferred' : 'default';
    const month = monthOfWeek(monday);
    let last_day: string | undefined;
    for (let i = 6; i >= 0 && !last_day; i--) {
      if (days.has(addDays(monday, i))) last_day = addDays(monday, i);
    }
    const base = { monday, days: n, aim, aim_source, month, ...(last_day ? { last_day } : {}) };

    let status: WeekStatus;
    let short = 0;
    if (n >= aim) status = 'met';
    else if (monday === thisMonday) status = 'open';
    else if (touchesEasyWeek(monday, easyWeeks)) status = 'easy';
    else {
      short = aim - n;
      const used = (charged.get(month) ?? 0) + short;
      charged.set(month, used);
      status = used <= allowed ? 'forgiven' : 'missed';
    }
    history.push({ ...base, short, status });
  }

  const thisWeek = history[history.length - 1]!;
  const runs = runsByWeek(history);
  const current = runs[runs.length - 1]!;
  // A past week's status never changes once the week is over, so the best never shrinks.
  let best = current;
  for (const r of runs) if (r.weeks > best.weeks) best = r;

  const used = Math.min(allowed, charged.get(thisWeek.month) ?? 0);
  return {
    current,
    best,
    this_week: thisWeek,
    skips: { month: thisWeek.month, used, left: allowed - used, allowed },
    history,
  };
}

/**
 * How many of each week's days short the month's skips covered, by Monday. The same charging as
 * `trainingStreak`, in the order it ran: a week the allowance covers whole is `forgiven`; a
 * `missed` week may still have had part of it covered, and how much is what a hard mode (§21.4)
 * needs, since it charges by the day rather than by the week. Weeks with nothing short — met,
 * easier, or still open — are absent.
 */
export function skipsCovered(
  history: readonly StreakWeek[],
  allowed: number = SKIPS_PER_MONTH,
): Map<string, number> {
  const cap = Math.max(0, Math.floor(allowed));
  const used = new Map<string, number>();
  const out = new Map<string, number>();
  for (const w of history) {
    if (w.short <= 0) continue;
    const before = used.get(w.month) ?? 0;
    out.set(w.monday, Math.max(0, Math.min(w.short, cap - before)));
    used.set(w.month, before + w.short);
  }
  return out;
}

/**
 * Training days short of the aim in the weeks touching two dates, inclusive: what a hard mode
 * would charge for. Easier weeks, met weeks and the open week owe nothing.
 */
export function missedDays(history: readonly StreakWeek[], from: string, to: string): number {
  let n = 0;
  for (const w of history) {
    if (w.monday < mondayOf(from) || w.monday > mondayOf(to)) continue;
    n += w.short;
  }
  return n;
}

/** "3 weeks", "1 week". */
export function describeRun(weeks: number): string {
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
}

/**
 * What this week still needs, for the Train screen. Never a verdict: a week short says how
 * far, not that it was failed, and nothing here mentions a run that ended.
 */
export function weekLine(w: Pick<StreakWeek, 'days' | 'aim'>): string {
  const left = Math.max(0, w.aim - w.days);
  if (left === 0) return 'This week counts';
  return `${left} more ${left === 1 ? 'day' : 'days'} this week to make it count`;
}

/** The first day of the month after a `YYYY-MM`, when the skips come back. */
export function skipsReturn(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return toDateKey(new Date(y ?? 1970, m ?? 1, 1));
}

/**
 * "2 of 3 skips left in October", or the day they come back once spent. `locale` is for tests;
 * screens leave it to the device.
 */
export function skipsLine(s: TrainingStreak['skips'], locale?: string): string {
  if (s.allowed === 0) return 'No skips';
  if (s.left === 0) {
    const back = fromDateKey(skipsReturn(s.month)).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
    });
    return `Skips back on ${back}`;
  }
  const month = fromDateKey(`${s.month}-01`).toLocaleDateString(locale, { month: 'long' });
  return `${s.left} of ${s.allowed} ${s.allowed === 1 ? 'skip' : 'skips'} left in ${month}`;
}
