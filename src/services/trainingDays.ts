// SPEC §20.7 — applying the energy bridge to a day's target.
//
// The maths is in core/trainingDays.ts, including the invariant that matters: the week's total
// is untouched. This assembles the week it needs — which days were trained, which are expected
// to be — and leaves the decision to core.
import { sexFloor } from '@/core/targets';
import {
  DEFAULT_DIFFERENCE_KCAL,
  inferTrainingWeekdays,
  isTrainingDay,
  MAX_DIFFERENCE_KCAL,
  redistribute,
  type DayBudget,
} from '@/core/trainingDays';
import { todayKey } from '@/core/dates';
import { weekStart } from '@/core/trainingWeek';
import { toDateKey } from '@/core/dates';
import type { MacroTotals } from '@/core/types';
import { getCurrentProfile } from '@/db/repo/profiles';
import { getSetting, setSetting } from '@/db/repo/settings';
import { listSessions } from '@/db/repo/workouts';

export const ENERGY_BRIDGE_KEY = 'training:energy_bridge';

export interface EnergyBridge {
  enabled: boolean;
  /** How much more a training day carries than a rest day. */
  difference_kcal: number;
}

/** Off until switched on: a budget that changes shape without being asked is a surprise. */
export const DEFAULT_BRIDGE: EnergyBridge = {
  enabled: false,
  difference_kcal: DEFAULT_DIFFERENCE_KCAL,
};

export async function getEnergyBridge(): Promise<EnergyBridge> {
  const stored = await getSetting<Partial<EnergyBridge>>(ENERGY_BRIDGE_KEY);
  return {
    enabled: stored?.enabled === true,
    difference_kcal: Math.max(
      0,
      Math.min(MAX_DIFFERENCE_KCAL, stored?.difference_kcal ?? DEFAULT_DIFFERENCE_KCAL),
    ),
  };
}

export async function setEnergyBridge(patch: Partial<EnergyBridge>): Promise<void> {
  await setSetting(ENERGY_BRIDGE_KEY, { ...(await getEnergyBridge()), ...patch });
}

export interface WeekShape {
  /** Mon–Sun of the week containing the date asked about. */
  days: { date: string; training: boolean }[];
  /** The weekdays the pattern was inferred from; empty means not enough history. */
  pattern: number[];
}

/**
 * Which days of `date`'s week count as training days: those that already have a finished
 * session, plus those whose weekday matches the inferred pattern.
 */
export async function weekShape(date: string): Promise<WeekShape> {
  const sessions = await listSessions();
  const trained = new Set(sessions.map((s) => toDateKey(new Date(s.started_at))));
  const pattern = inferTrainingWeekdays([...trained], new Date());

  const start = weekStart(new Date(`${date}T12:00:00`));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = toDateKey(d);
    return { date: key, training: isTrainingDay(key, trained, pattern) };
  });
  return { days, pattern };
}

export interface BridgedDay {
  budget: DayBudget;
  /** True when the bridge actually moved anything for this day. */
  applied: boolean;
  pattern: number[];
}

/**
 * The day's budget with the bridge applied, or the flat one when it is off, when there is not
 * enough history to infer a pattern, or when the floors leave no room to move anything.
 */
export async function bridgedDay(date: string, base: MacroTotals): Promise<BridgedDay | undefined> {
  const bridge = await getEnergyBridge();
  const flat: DayBudget = { date, training: false, delta_kcal: 0, ...base };
  if (!bridge.enabled) return { budget: flat, applied: false, pattern: [] };

  const profile = await getCurrentProfile();
  if (!profile) return { budget: flat, applied: false, pattern: [] };

  const shape = await weekShape(date);
  const out = redistribute({
    days: shape.days,
    base,
    difference_kcal: bridge.difference_kcal,
    floor_kcal: sexFloor(profile.sex),
  });
  const budget = out.find((d) => d.date === date);
  if (!budget) return { budget: flat, applied: false, pattern: shape.pattern };
  return { budget, applied: budget.delta_kcal !== 0, pattern: shape.pattern };
}

/** The whole week, for a surface that wants to show the shape rather than one day of it. */
export async function bridgedWeek(
  base: MacroTotals,
  date: string = todayKey(),
): Promise<{ days: DayBudget[]; applied: boolean; pattern: number[] } | undefined> {
  const bridge = await getEnergyBridge();
  const profile = await getCurrentProfile();
  const shape = await weekShape(date);
  if (!profile) return undefined;
  if (!bridge.enabled) {
    return {
      days: shape.days.map((d) => ({ ...d, delta_kcal: 0, ...base })),
      applied: false,
      pattern: shape.pattern,
    };
  }
  const days = redistribute({
    days: shape.days,
    base,
    difference_kcal: bridge.difference_kcal,
    floor_kcal: sexFloor(profile.sex),
  });
  return { days, applied: days.some((d) => d.delta_kcal !== 0), pattern: shape.pattern };
}
