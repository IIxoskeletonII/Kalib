// v2 — the week in review and the micronutrient panel (SPEC §7.4, §11). Pure over the
// coach's DaySummary so supplements and the same completeness/coverage rules apply.
import { isCompleteDay, MICRO_COVERAGE_FLOOR, type DaySummary } from './coach';
import { MICRO_DEFS, MICRO_KEYS } from './nutrients';
import { calorieConfidence, microCoverage, nutrientCoverage } from './nutrition';
import type { TrendPoint } from './trend';
import type { Confidence, MicroKey, Micros, Sex } from './types';

export interface WeekReview {
  /** Days in the window that had a target (i.e. the app was opened). */
  days: number;
  /** Complete days (§16.1 rule) — the ones every average below is over. */
  completeDays: number;
  weighedDays: number;
  avgKcal: number;
  avgTarget: number;
  /** avgKcal / avgTarget; 1.0 is on target. */
  adherence: number;
  avgProtein: number;
  proteinTarget: number;
  avgFiber: number;
  fiberTarget: number;
  /** Trend change over the window, kg; undefined without enough weigh-ins. */
  weightDelta?: number | undefined;
  /** Weighted over complete days; null when nothing logged. */
  calorieConfidence: number | null;
  microCoverage: number | null;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

type Entry = { kcal: number; micros?: Micros | undefined; confidence?: Confidence | undefined };

export function weekReview(
  days: readonly DaySummary[],
  trend: readonly TrendPoint[],
  from: string,
  to: string,
): WeekReview {
  const complete = days.filter(isCompleteDay);
  const entries: Entry[] = [];
  for (const d of complete) for (const e of d.entries ?? []) entries.push(e as Entry);
  const inWindow = trend.filter((p) => p.date >= from && p.date <= to);
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  const weighedDays = inWindow.filter((p) => p.weighed).length;
  return {
    days: days.length,
    completeDays: complete.length,
    weighedDays,
    avgKcal: mean(complete.map((d) => d.totals.kcal)),
    avgTarget: mean(complete.map((d) => d.target.kcal)),
    adherence:
      complete.length > 0
        ? mean(complete.map((d) => d.totals.kcal)) / mean(complete.map((d) => d.target.kcal))
        : 0,
    avgProtein: mean(complete.map((d) => d.totals.protein_g)),
    proteinTarget: mean(complete.map((d) => d.target.protein_g)),
    avgFiber: mean(complete.map((d) => d.totals.fiber_g)),
    fiberTarget: mean(complete.map((d) => d.target.fiber_g)),
    weightDelta: first && last && weighedDays >= 2 ? last.trend - first.trend : undefined,
    calorieConfidence: calorieConfidence(
      entries.map((e) => ({ kcal: e.kcal, confidence: e.confidence ?? 'high' })),
    ),
    microCoverage: microCoverage(entries),
  };
}

export interface MicroStat {
  key: MicroKey;
  label: string;
  unit: string;
  /** Average per day over the days whose food carried this nutrient. */
  average: number;
  rda: number;
  /** average / rda, uncapped. */
  ratio: number;
  /** Complete days that could be judged for this nutrient (§7.4, per nutrient). */
  days: number;
  group: 'vitamin' | 'mineral';
}

export interface MicroPanel {
  /** Nutrients with at least one judgeable day, lowest ratio first. */
  stats: MicroStat[];
  /** Nutrients no logged food carried data for — unknown, not zero. */
  unknown: MicroStat[];
  daysComplete: number;
}

const MINERALS = new Set<MicroKey>([
  'calcium',
  'iron',
  'magnesium',
  'phosphorus',
  'potassium',
  'zinc',
  'copper',
  'manganese',
  'selenium',
]);

/** §7.4 — averages against the DRI, each nutrient over the days whose food carried it. */
export function microPanel(days: readonly DaySummary[], sex: Sex): MicroPanel {
  const complete = days.filter(isCompleteDay);
  const stats: MicroStat[] = [];
  const unknown: MicroStat[] = [];
  for (const k of MICRO_KEYS) {
    const def = MICRO_DEFS[k];
    const rda = def.rda?.[sex];
    if (!rda) continue;
    const covered = complete.filter((d) => {
      if (!d.entries) return false;
      const c = nutrientCoverage(d.entries, k);
      return c != null && c >= MICRO_COVERAGE_FLOOR;
    });
    const average = mean(covered.map((d) => d.totals.micros[k] ?? 0));
    const stat: MicroStat = {
      key: k,
      label: def.label,
      unit: def.unit,
      average,
      rda,
      ratio: average / rda,
      days: covered.length,
      group: MINERALS.has(k) ? 'mineral' : 'vitamin',
    };
    (covered.length > 0 ? stats : unknown).push(stat);
  }
  stats.sort((a, b) => a.ratio - b.ratio);
  return { stats, unknown, daysComplete: complete.length };
}
