// SPEC §16 — assemble the trailing week for the coach and pick foods that close the leading gap.
import {
  findGaps,
  gapClosed,
  recommendFoods,
  COACH_WINDOW_DAYS,
  type DaySummary,
  type Gap,
  type Recommendation,
} from '@/core/coach';
import { selectEverydayPool } from '@/core/coachFoods';
import { addDays } from '@/core/dates';
import { dayTotals } from '@/core/nutrition';
import type { Food, LogEntry, Sex } from '@/core/types';
import { listDailyTargets } from '@/db/repo/dailyTargets';
import { listCandidateFoods } from '@/db/repo/foods';
import { foodUsageCounts, listEntriesSince } from '@/db/repo/logEntries';
import { getSetting, setSetting } from '@/db/repo/settings';

export interface CoachResult {
  gap: Gap;
  recommendations: Recommendation[];
}

export type CoachState =
  | { kind: 'quiet' }
  | { kind: 'gap'; result: CoachResult }
  | { kind: 'closed'; nutrientLabel: string };

const LAST_GAP_KEY = 'coach:last_gap';

export async function buildWeek(date: string): Promise<DaySummary[]> {
  const from = addDays(date, -(COACH_WINDOW_DAYS - 1));
  const [entries, targets] = await Promise.all([listEntriesSince(from), listDailyTargets()]);
  const byDate = new Map<string, LogEntry[]>();
  for (const e of entries) {
    if (e.date > date) continue;
    (byDate.get(e.date) ?? byDate.set(e.date, []).get(e.date)!).push(e);
  }
  const days: DaySummary[] = [];
  for (const t of targets) {
    if (t.date < from || t.date > date) continue;
    const dayEntries = byDate.get(t.date) ?? [];
    days.push({
      date: t.date,
      totals: dayTotals(dayEntries),
      target: {
        kcal: t.kcal,
        protein_g: t.protein_g,
        carb_g: t.carb_g,
        fat_g: t.fat_g,
        fiber_g: t.fiber_g,
      },
      entries: dayEntries,
    });
  }
  return days;
}

export async function computeCoach(date: string, sex: Sex): Promise<CoachState> {
  const days = await buildWeek(date);
  const gaps = findGaps(days, sex);
  const last = await getSetting<Gap>(LAST_GAP_KEY);

  if (gaps.length === 0) {
    if (gapClosed(last, gaps)) {
      await setSetting(LAST_GAP_KEY, null);
      return { kind: 'closed', nutrientLabel: last!.label };
    }
    return { kind: 'quiet' };
  }

  const gap = gaps[0]!;
  const [foods, usage] = await Promise.all([listCandidateFoods(), foodUsageCounts()]);
  // Candidates: the coach repertoire plus whatever the user already logs.
  const pool = selectEverydayPool(foods);
  const familiarIds = new Set(usage.keys());
  const candidates = (foods as Food[]).filter((f) => pool.has(f.id) || familiarIds.has(f.id));
  const serving = new Map<string, number>();
  for (const [id, spec] of pool) if (spec.grams) serving.set(id, spec.grams);
  const kcalTarget = days.at(-1)?.target.kcal;
  const recommendations = recommendFoods(gap, candidates, {
    familiarIds,
    serving,
    ...(kcalTarget ? { kcalTarget } : {}),
  });
  if (!last || last.nutrient !== gap.nutrient) await setSetting(LAST_GAP_KEY, gap);
  return { kind: 'gap', result: { gap, recommendations } };
}
