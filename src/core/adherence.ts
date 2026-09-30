// SPEC §5.2 / §16.3 — how the app talks about keeping at it.
//
// The retention evidence is lopsided and worth stating plainly, because it decides the design:
//
//   Consistency beats completeness. Logging on most days predicts outcomes; logging every gram
//   on the days you do log does not. So the number worth showing is days-logged, never
//   grams-accounted-for.
//
//   A hard streak is a liability. Streaks motivate while intact, but breaking one raises the
//   odds of abandoning the app altogether, and habit-formation work finds that missing a single
//   occasion does not measurably slow automaticity. A run that survives one missed day is
//   therefore both kinder and truer to the evidence than one that resets to zero.
//
//   Landmarks restart people. Goal-directed behaviour spikes right after Mondays, month starts
//   and birthdays, because a landmark separates you from a past imperfect self. That is when a
//   lapsed user is worth nudging, and the nudge should offer a beginning, not a reckoning.
//
// Nothing here counts calories or judges a day's contents. It counts days.
import { addDays, diffDays, fromDateKey } from './dates';

export interface LoggedDay {
  date: string;
  /** The §16 completeness rule: intake reached 60% of the day's target. */
  logged: boolean;
}

/** Days a week that the evidence associates with better outcomes. */
export const CONSISTENT_DAYS_PER_WEEK = 3;
/** Share of days over the longer window that marks a consistent logger. */
export const CONSISTENT_SHARE = 0.5;
export const WEEK_WINDOW = 7;
export const MONTH_WINDOW = 28;

export interface Run {
  /** Calendar days the run spans. */
  days: number;
  /** Of those, the days actually logged. */
  logged: number;
  /** Of those, the single days missed that did not break it. */
  missed: number;
  /** First day of the run; undefined when there is no run. */
  from?: string | undefined;
}

export interface Consistency {
  /** Days logged in the trailing week, today included. */
  week: number;
  /** Days logged in the trailing four weeks. */
  month: number;
  /** month / 28. */
  share: number;
  /** Meets both thresholds the evidence names. */
  consistent: boolean;
  run: Run;
  /** Days since the last logged day; 0 when today is logged. */
  quiet_days: number;
}

function loggedMap(days: readonly LoggedDay[]): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const d of days) m.set(d.date, d.logged);
  return m;
}

/** Days logged in the `window` days ending on `today`. */
export function loggedInWindow(days: readonly LoggedDay[], today: string, window: number): number {
  const m = loggedMap(days);
  let n = 0;
  for (let i = 0; i < window; i++) if (m.get(addDays(today, -i)) === true) n++;
  return n;
}

/**
 * The current run, where one missed day is forgiven and two in a row end it. An unlogged *today*
 * is not a miss — the day is not over — so the run is measured from yesterday in that case.
 */
export function currentRun(days: readonly LoggedDay[], today: string): Run {
  const m = loggedMap(days);
  if (m.size === 0) return { days: 0, logged: 0, missed: 0 };
  const earliest = [...m.keys()].sort()[0]!;
  const start = m.get(today) === true ? today : addDays(today, -1);
  if (diffDays(earliest, start) < 0) return { days: 0, logged: 0, missed: 0 };

  let length = 0;
  let logged = 0;
  let missed = 0;
  let lastWasMiss = false;
  let from = start;

  for (let i = 0; ; i++) {
    const date = addDays(start, -i);
    if (diffDays(earliest, date) < 0) break;
    if (m.get(date) === true) {
      length++;
      logged++;
      from = date;
      lastWasMiss = false;
      continue;
    }
    if (lastWasMiss) break;
    length++;
    missed++;
    lastWasMiss = true;
  }
  // A run never begins with a gap: if the walk stopped on a forgiven miss, drop it.
  if (lastWasMiss && length > 0) {
    length--;
    missed--;
  }
  if (logged === 0) return { days: 0, logged: 0, missed: 0 };
  return { days: length, logged, missed, from };
}

/** Days since the last logged day. 0 when today is logged, undefined when nothing ever was. */
export function quietDays(days: readonly LoggedDay[], today: string): number | undefined {
  const logged = days
    .filter((d) => d.logged)
    .map((d) => d.date)
    .sort();
  const last = logged[logged.length - 1];
  if (last == null) return undefined;
  return Math.max(0, diffDays(last, today));
}

export function consistency(days: readonly LoggedDay[], today: string): Consistency {
  const week = loggedInWindow(days, today, WEEK_WINDOW);
  const month = loggedInWindow(days, today, MONTH_WINDOW);
  const share = month / MONTH_WINDOW;
  return {
    week,
    month,
    share,
    consistent: week >= CONSISTENT_DAYS_PER_WEEK && share >= CONSISTENT_SHARE,
    run: currentRun(days, today),
    quiet_days: quietDays(days, today) ?? 0,
  };
}

/** One line for the review screen. Never a verdict, per §5.2. */
export function consistencyLine(c: Consistency): string {
  if (c.month === 0) return 'Nothing logged yet this month.';
  const run = c.run;
  if (run.days >= 3) {
    const forgiven = run.missed > 0 ? ` (${run.missed} day off, which is fine)` : '';
    return `${run.logged} of the last ${run.days} days${forgiven}.`;
  }
  return `${c.week} of the last 7 days.`;
}

export type Landmark = 'year' | 'month' | 'week';

/**
 * Whether `date` is one of the temporal landmarks people restart on. Checked in descending
 * order of significance so 1 January reads as a new year rather than a new month.
 */
export function freshStartLandmark(date: string): Landmark | undefined {
  const [, mm, dd] = date.split('-');
  if (mm === '01' && dd === '01') return 'year';
  if (dd === '01') return 'month';
  if (fromDateKey(date).getDay() === 1) return 'week';
  return undefined;
}

/** How long a person can be quiet before a landmark nudge is worth sending. */
export const LAPSED_DAYS = 3;

/**
 * The fresh-start nudge, or nothing. Only fires on a landmark, only after a real gap, and never
 * mentions the gap's length — the point is the beginning, not the lapse.
 */
export function freshStartNudge(date: string, quiet: number): string | undefined {
  const landmark = freshStartLandmark(date);
  if (landmark == null || quiet < LAPSED_DAYS) return undefined;
  if (landmark === 'year') return 'New year. Today is a clean first day — log one thing.';
  if (landmark === 'month') return 'New month. Today is a clean first day — log one thing.';
  return 'New week. Today is a clean first day — log one thing.';
}
