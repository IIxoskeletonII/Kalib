// SPEC §3.5 — offering a diet break and, if accepted, scheduling it. Maths in core/dietBreak.ts.
//
// The proposal is derived, never stored: the only things written are the two mode switches the
// person accepts, and a dismissal that keeps it quiet for the rest of the week.
import { weekStart } from '@/core/banking';
import { proposeDietBreak, withDietBreak, type DietBreakProposal } from '@/core/dietBreak';
import { todayKey } from '@/core/dates';
import { resolveMode, type ModeSwitch } from '@/core/targets';
import { computeTrend, trendDelta } from '@/core/trend';
import type { Mode } from '@/core/types';
import { firstActivityDate } from '@/db/repo/logEntries';
import { getCurrentProfile } from '@/db/repo/profiles';
import { getSetting, setSetting } from '@/db/repo/settings';
import { listWeighIns } from '@/db/repo/weighIns';
import { getModeSchedule, setModeSchedule } from './targets';

export const DIET_BREAK_DISMISSED_KEY = 'diet_break:dismissed_week';

/** How far back the stall test looks. */
export const LOOKBACK_DAYS = 28;

const DEFICIT_MODES: readonly Mode[] = ['CUT', 'RECOMP'];

/**
 * When the current unbroken deficit began: the last switch into a deficit mode, or the first day
 * of logging when the profile has simply been in deficit from the start. Undefined when today is
 * not a deficit day at all.
 */
export function deficitSince(
  baseMode: Mode,
  schedule: readonly ModeSwitch[],
  firstDay: string | undefined,
  today: string,
): string | undefined {
  const mode = resolveMode(baseMode, schedule, today);
  if (!DEFICIT_MODES.includes(mode)) return undefined;
  const past = [...schedule]
    .filter((s) => s.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = past[past.length - 1];
  if (last) return last.date;
  return firstDay;
}

/** The break worth offering today, or nothing. Suppressed for the week once dismissed. */
export async function dietBreakProposal(
  today: string = todayKey(),
): Promise<DietBreakProposal | undefined> {
  const [profile, schedule, weighIns, firstDay, dismissed] = await Promise.all([
    getCurrentProfile(),
    getModeSchedule(),
    listWeighIns(),
    firstActivityDate(),
    getSetting<string>(DIET_BREAK_DISMISSED_KEY),
  ]);
  if (!profile) return undefined;
  if (dismissed === weekStart(today)) return undefined;

  const mode = resolveMode(profile.mode, schedule, today);
  const since = deficitSince(profile.mode, schedule, firstDay ?? undefined, today);
  const trend = computeTrend(weighIns, undefined, today);
  const delta = trendDelta(trend, LOOKBACK_DAYS);

  return proposeDietBreak(
    {
      mode,
      deficit_since: since,
      trend_delta_kg: delta,
      lookback_days: LOOKBACK_DAYS,
      goal_rate_kg_per_week: profile.goal_rate_kg_per_week,
      schedule,
    },
    today,
  );
}

/** Accepting writes the two §3.5 switches; every target from that Monday follows them. */
export async function acceptDietBreak(p: DietBreakProposal): Promise<void> {
  const schedule = await getModeSchedule();
  await setModeSchedule(withDietBreak(schedule, p));
  await setSetting(DIET_BREAK_DISMISSED_KEY, null);
}

/** Not this week. The offer comes back if the reason still holds next week. */
export async function dismissDietBreak(today: string = todayKey()): Promise<void> {
  await setSetting(DIET_BREAK_DISMISSED_KEY, weekStart(today));
}
