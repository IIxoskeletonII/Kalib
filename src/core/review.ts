// v2 — the week in review and the micronutrient panel (SPEC §7.4, §11). Pure over the
// coach's DaySummary so supplements and the same completeness/coverage rules apply.
import { isCompleteDay, MICRO_COVERAGE_FLOOR, type DaySummary } from './coach';
import { MICRO_DEFS, MICRO_KEYS } from './nutrients';
import { calorieConfidence, microCoverage, nutrientCoverage } from './nutrition';
import type { TrendPoint } from './trend';
import type { Confidence, Food, LogEntry, MicroKey, Micros, Sex } from './types';

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

// --- potassium against sodium -------------------------------------------------------------
//
// Sodium alone is a number nobody can act on: the DASH evidence is about the *ratio* of
// potassium to sodium, and most Western diets have it upside down. A ratio of roughly 2:1
// potassium to sodium is the target worth aiming at, and it is reached by eating more
// vegetables rather than by fearing salt.
//
// Sodium is a `per_100g` field rather than a tracked micronutrient (§6), so it cannot come from
// the day's totals — it is recomputed from the food behind each entry. Manual entries have no
// food behind them, so the coverage share is reported the same way §7.4 reports everything else:
// the panel says how much of the day it actually knew about.

/** Potassium to sodium, by mass. */
export const K_NA_TARGET = 2;

export interface DaySodium {
  date: string;
  sodium_mg: number;
  /** Share of the day's calories whose food carried a sodium figure, 0–1. */
  coverage: number;
}

export interface MineralBalance {
  /** Mean potassium per judgeable day, mg. */
  potassium_mg: number;
  /** Mean sodium per judgeable day, mg. */
  sodium_mg: number;
  /** potassium / sodium. */
  ratio: number;
  target: number;
  /** Days both nutrients were known well enough to judge. */
  days: number;
  /** Mean sodium coverage across those days. */
  coverage: number;
}

/**
 * Sodium per day from the foods behind the entries. Entries without a food (manual, quick-add)
 * contribute calories but no sodium, which is what drags `coverage` down honestly.
 */
export function daySodium(
  entries: readonly LogEntry[],
  foodById: ReadonlyMap<string, Pick<Food, 'per_100g'>>,
  from: string,
  to: string,
): DaySodium[] {
  const byDate = new Map<string, LogEntry[]>();
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    (byDate.get(e.date) ?? byDate.set(e.date, []).get(e.date)!).push(e);
  }
  const out: DaySodium[] = [];
  for (const [date, list] of [...byDate.entries()].sort()) {
    let mg = 0;
    let covered = 0;
    let total = 0;
    for (const e of list) {
      total += e.kcal;
      const food = e.food_id ? foodById.get(e.food_id) : undefined;
      const per100 = food?.per_100g.sodium;
      if (per100 != null && e.grams > 0) {
        mg += (per100 * e.grams) / 100;
        covered += e.kcal;
      }
    }
    out.push({ date, sodium_mg: mg, coverage: total > 0 ? covered / total : 0 });
  }
  return out;
}

/**
 * The week's potassium-to-sodium ratio, or undefined when too little of the week is known.
 * Judged only on days that clear the §7.4 coverage floor for both nutrients.
 */
export function potassiumSodium(
  days: readonly DaySummary[],
  sodium: readonly DaySodium[],
): MineralBalance | undefined {
  const sodiumByDate = new Map(sodium.map((d) => [d.date, d]));
  const judgeable: { k: number; na: number; coverage: number }[] = [];
  for (const d of days.filter(isCompleteDay)) {
    const s = sodiumByDate.get(d.date);
    if (!s || s.coverage < MICRO_COVERAGE_FLOOR || s.sodium_mg <= 0) continue;
    if (!d.entries) continue;
    const kCoverage = nutrientCoverage(d.entries, 'potassium');
    if (kCoverage == null || kCoverage < MICRO_COVERAGE_FLOOR) continue;
    const k = d.totals.micros.potassium;
    if (k == null) continue;
    judgeable.push({ k, na: s.sodium_mg, coverage: s.coverage });
  }
  if (judgeable.length === 0) return undefined;
  const potassium_mg = mean(judgeable.map((j) => j.k));
  const sodium_mg = mean(judgeable.map((j) => j.na));
  return {
    potassium_mg,
    sodium_mg,
    ratio: sodium_mg > 0 ? potassium_mg / sodium_mg : 0,
    target: K_NA_TARGET,
    days: judgeable.length,
    coverage: mean(judgeable.map((j) => j.coverage)),
  };
}
