// SPEC §3.5 / §4.3 — proposing a diet break, and scheduling it with the machinery §3.5 already
// has.
//
// The MATADOR trial (Byrne et al., Int J Obesity 2018) ran two weeks of deficit against two
// weeks at maintenance, repeatedly, and compared it with continuous restriction of the same
// total dose. The intermittent group lost substantially more fat over the same intervention
// time, with no extra fat-free mass lost — read as adaptive thermogenesis having less chance to
// accumulate. A follow-up trial is still running, so this is presented as a suggestion with its
// reasoning, never as an instruction.
//
// A break needs no new concept in this app: it is two entries in the §3.5 mode schedule, a
// MAINTAIN at the start and a return to the old mode at the end. Everything downstream — daily
// targets, banking, the planner — already follows that schedule.
import { addDays, diffDays } from './dates';
import type { ModeSwitch } from './targets';
import type { Mode } from './types';

/** Weeks of continuous deficit after which a break is worth offering. */
export const BREAK_AFTER_WEEKS = 8;
/** Length of the break, matching the trial's two-week blocks. */
export const BREAK_WEEKS = 2;
/** A stall is only meaningful once there has been enough deficit to expect movement. */
export const STALL_AFTER_WEEKS = 4;
/** Below this share of the expected loss, the cut has stopped paying for itself. */
export const STALL_RATIO = 0.25;
/** Never propose a break when one is already coming up inside this many days. */
export const PROPOSAL_QUIET_DAYS = 21;

export type DietBreakReason = 'duration' | 'stalled';

export interface DietBreakInput {
  /** The mode in force today, after the schedule is resolved. */
  mode: Mode;
  /** First day of the current unbroken deficit; undefined when there is not one. */
  deficit_since?: string | undefined;
  /** Change in trend weight over `lookback_days`, kg. Negative when losing. */
  trend_delta_kg?: number | undefined;
  lookback_days?: number | undefined;
  goal_rate_kg_per_week: number;
  schedule: readonly ModeSwitch[];
}

export interface DietBreakProposal {
  reason: DietBreakReason;
  /** First day at maintenance — always a Monday, so it lines up with §5 banking weeks. */
  from: string;
  /** First day back on the old mode. */
  to: string;
  weeks: number;
  weeks_in_deficit: number;
  /** The reason, in the §5.2 register: a direction, not a verdict. */
  line: string;
  /** Ready to merge into `mode_schedule`. */
  switches: ModeSwitch[];
}

/** The Monday strictly after `date`. */
export function nextMonday(date: string): string {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(date, i);
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === 1) return d;
  }
  return addDays(date, 7);
}

function alreadyPlanned(schedule: readonly ModeSwitch[], today: string): boolean {
  return schedule.some(
    (s) =>
      s.mode === 'MAINTAIN' &&
      diffDays(today, s.date) >= 0 &&
      diffDays(today, s.date) <= PROPOSAL_QUIET_DAYS,
  );
}

/**
 * A break to offer, or nothing. Only from a deficit, only once there is a reason, and never
 * while one is already on the calendar.
 */
export function proposeDietBreak(i: DietBreakInput, today: string): DietBreakProposal | undefined {
  if (i.mode !== 'CUT' && i.mode !== 'RECOMP') return undefined;
  if (i.deficit_since == null) return undefined;
  if (alreadyPlanned(i.schedule, today)) return undefined;

  const days = diffDays(i.deficit_since, today);
  if (days < 0) return undefined;
  const weeks = Math.floor(days / 7);

  let reason: DietBreakReason | undefined;
  if (weeks >= BREAK_AFTER_WEEKS) {
    reason = 'duration';
  } else if (
    weeks >= STALL_AFTER_WEEKS &&
    i.trend_delta_kg != null &&
    i.lookback_days != null &&
    i.lookback_days > 0 &&
    i.goal_rate_kg_per_week > 0
  ) {
    const expected = (i.goal_rate_kg_per_week * i.lookback_days) / 7;
    const achieved = -i.trend_delta_kg; // positive when weight fell
    if (expected > 0 && achieved < STALL_RATIO * expected) reason = 'stalled';
  }
  if (reason == null) return undefined;

  const from = nextMonday(today);
  const to = addDays(from, BREAK_WEEKS * 7);
  const line =
    reason === 'duration'
      ? `${weeks} weeks in a deficit. Two weeks at maintenance costs no progress and tends to make the next block work better.`
      : `${weeks} weeks in, and the trend has barely moved. Two weeks at maintenance is the usual way back to a deficit that works.`;

  return {
    reason,
    from,
    to,
    weeks: BREAK_WEEKS,
    weeks_in_deficit: weeks,
    line,
    switches: [
      { date: from, mode: 'MAINTAIN' },
      { date: to, mode: i.mode },
    ],
  };
}

/** The schedule with the break folded in, replacing anything already sitting on those dates. */
export function withDietBreak(schedule: readonly ModeSwitch[], p: DietBreakProposal): ModeSwitch[] {
  const dates = new Set(p.switches.map((s) => s.date));
  return [...schedule.filter((s) => !dates.has(s.date)), ...p.switches].sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );
}

/** Whether `date` falls inside a scheduled break — for labelling the day. */
export function inDietBreak(schedule: readonly ModeSwitch[], date: string): boolean {
  const sorted = [...schedule].sort((a, b) => (a.date < b.date ? -1 : 1));
  let current: ModeSwitch | undefined;
  for (const s of sorted) {
    if (s.date <= date) current = s;
    else break;
  }
  return current?.mode === 'MAINTAIN';
}
