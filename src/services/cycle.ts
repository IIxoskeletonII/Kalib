// SPEC §4.1 — the stored side of cycle-aware trend weight. The maths is in core/cycle.ts.
//
// Starts live in `settings`, the same pattern `mode_schedule` uses: a short, ordered list of
// dates that syncs like any other row and needs no table of its own.
import { cycleLength, cycleStartFor, weightSigmaScale } from '@/core/cycle';
import { getSetting, setSetting } from '@/db/repo/settings';

export const CYCLE_ENABLED_KEY = 'cycle:enabled';
export const CYCLE_STARTS_KEY = 'cycle:starts';

export async function isCycleAware(): Promise<boolean> {
  return (await getSetting<boolean>(CYCLE_ENABLED_KEY)) === true;
}

export async function setCycleAware(on: boolean): Promise<void> {
  await setSetting(CYCLE_ENABLED_KEY, on);
}

/** Logged period starts, ascending and deduplicated. */
export async function getCycleStarts(): Promise<string[]> {
  const raw = (await getSetting<string[]>(CYCLE_STARTS_KEY)) ?? [];
  return [...new Set(raw.filter((d) => typeof d === 'string'))].sort();
}

export async function addCycleStart(date: string): Promise<string[]> {
  const next = [...new Set([...(await getCycleStarts()), date])].sort();
  await setSetting(CYCLE_STARTS_KEY, next);
  return next;
}

export async function removeCycleStart(date: string): Promise<string[]> {
  const next = (await getCycleStarts()).filter((d) => d !== date);
  await setSetting(CYCLE_STARTS_KEY, next);
  return next;
}

export interface CycleView {
  enabled: boolean;
  starts: string[];
  length: number;
  /** The cycle `date` belongs to, real or predicted; undefined when unknown. */
  current?: string | undefined;
}

export async function cycleView(date: string): Promise<CycleView> {
  const [enabled, starts] = await Promise.all([isCycleAware(), getCycleStarts()]);
  return {
    enabled,
    starts,
    length: cycleLength(starts),
    current: enabled ? cycleStartFor(date, starts) : undefined,
  };
}

/**
 * Per-day multipliers on weigh-in trustworthiness for the engine, keyed by date. Empty when the
 * feature is off, so the filter behaves exactly as before for anyone who never enables it.
 */
export async function sigmaScales(dates: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!(await isCycleAware())) return out;
  const starts = await getCycleStarts();
  if (starts.length === 0) return out;
  for (const date of dates) {
    const scale = weightSigmaScale(date, starts);
    if (scale !== 1) out.set(date, scale);
  }
  return out;
}
