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
import { microPanel, weekReview, type MicroPanel, type WeekReview } from '@/core/review';
import { computeTrend } from '@/core/trend';
import { dayTotals } from '@/core/nutrition';
import type { Food, LogEntry, MicroKey, Micros, Sex } from '@/core/types';
import { listDailyTargets } from '@/db/repo/dailyTargets';
import { listCandidateFoods } from '@/db/repo/foods';
import { foodUsageCounts, listEntriesSince } from '@/db/repo/logEntries';
import { getSetting, setSetting } from '@/db/repo/settings';
import { listWeighIns } from '@/db/repo/weighIns';
import { listAllSupplements, listSupplementLogsSince } from '@/db/repo/supplements';

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
  const [entries, targets, supplements, takes] = await Promise.all([
    listEntriesSince(from),
    listDailyTargets(),
    listAllSupplements(),
    listSupplementLogsSince(from),
  ]);
  const byDate = new Map<string, LogEntry[]>();
  for (const e of entries) {
    if (e.date > date) continue;
    (byDate.get(e.date) ?? byDate.set(e.date, []).get(e.date)!).push(e);
  }
  // §17.2: a taken micronutrient supplement counts toward that day's micro total (never kcal).
  const supplementById = new Map(supplements.map((s) => [s.id, s]));
  const microsByDate = new Map<string, Micros>();
  for (const take of takes) {
    const s = supplementById.get(take.supplement_id);
    if (!s?.nutrient || !s.nutrient_amount || take.date > date) continue;
    const m = microsByDate.get(take.date) ?? microsByDate.set(take.date, {}).get(take.date)!;
    m[s.nutrient] = (m[s.nutrient] ?? 0) + s.nutrient_amount * (take.dose / s.dose);
  }
  const days: DaySummary[] = [];
  for (const t of targets) {
    if (t.date < from || t.date > date) continue;
    const dayEntries = byDate.get(t.date) ?? [];
    const totals = dayTotals(dayEntries);
    const extra = microsByDate.get(t.date);
    if (extra) {
      for (const k of Object.keys(extra) as MicroKey[]) {
        totals.micros[k] = (totals.micros[k] ?? 0) + extra[k]!;
      }
    }
    days.push({
      date: t.date,
      totals,
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

export interface WeekOverview {
  from: string;
  to: string;
  review: WeekReview;
  panel: MicroPanel;
}

/** v2 week in review + §7.4 micronutrient panel for the 7 days ending on `date`. */
export async function weekOverview(date: string, sex: Sex): Promise<WeekOverview> {
  const from = addDays(date, -(COACH_WINDOW_DAYS - 1));
  const [days, weighIns] = await Promise.all([buildWeek(date), listWeighIns()]);
  const trend = computeTrend(weighIns, undefined, date);
  return {
    from,
    to: date,
    review: weekReview(days, trend, from, date),
    panel: microPanel(days, sex),
  };
}
