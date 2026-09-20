// SPEC §4.2–4.5 — the adaptive TDEE engine. Pure: takes a daily series (intake, trend weight,
// weigh-in flags), returns a measured TDEE with a confidence interval, or says why not.
// Guard rails (§4.3) and the weekly publish step (§4.4) are pure too, so the synthetic
// 90-day test in tdee.test.ts covers the whole thing.
import { addDays, diffDays } from './dates';
import { ENERGY_DENSITY_KCAL_PER_KG } from './targets';

export interface EngineDay {
  date: string;
  /** Intake for the day when it counts as logged (§4.5), else undefined. */
  kcal?: number | undefined;
  /** Share of the day's kcal from low/medium-confidence entries, 0–1. */
  low_confidence_share?: number | undefined;
  /** Trend weight for the day (carried forward on gaps). Undefined before the first weigh-in. */
  trend?: number | undefined;
  weighed: boolean;
}

export interface EngineOptions {
  /** Days 1–N are never inside the window (water and glycogen, §4.2). */
  excluded_days: number;
  window_days: number;
  min_window_days: number;
  min_logged_days: number;
  min_weighed_days: number;
  /** Raw daily weigh-in noise, kg. */
  weight_sigma_kg: number;
  /** Uncertainty in the energy density of the change, kcal/kg. */
  density_sigma: number;
  alpha: number;
}

// 28-day window, not the 21 of §4.2: on the synthetic benchmark (tdee.test.ts) a 21-day
// window's week-to-week noise (RMS ≈145 kcal) matched the ±150 publish cap, so targets would
// have bounced; 28 days halves the variance (RMS ≈105) and TDEE drifts far too slowly for the
// extra week to matter (≈15 kcal per kg lost). See SPEC §4.5.
export const DEFAULT_ENGINE: EngineOptions = {
  excluded_days: 10,
  window_days: 28,
  min_window_days: 14,
  min_logged_days: 10,
  min_weighed_days: 10,
  weight_sigma_kg: 0.7,
  density_sigma: 1000,
  alpha: 0.15,
};

/** Day number on which the first estimate can exist (§4.5). */
export function firstEstimateDay(o: EngineOptions = DEFAULT_ENGINE): number {
  return o.excluded_days + o.min_window_days;
}

export interface Estimate {
  computed_on: string;
  tdee_kcal: number;
  ci_low: number;
  ci_high: number;
  window_days: number;
  logged_days: number;
  weighed_days: number;
  /** 0–1, §4.5. */
  data_quality: number;
  /** Diagnostics the UI can show. */
  mean_intake: number;
  delta_trend_kg: number;
}

export type EngineResult =
  | { status: 'calibrating'; day: number; first_estimate_day: number }
  | {
      status: 'insufficient';
      day: number;
      window_days: number;
      logged_days: number;
      weighed_days: number;
      need_logged: number;
      need_weighed: number;
    }
  | { status: 'ok'; estimate: Estimate };

/**
 * Estimate from a daily series ending on `today`. `day1` is the first day of logging; the
 * series may start later than day1 (before the first weigh-in) and must be ascending.
 */
export function estimateTdee(
  days: readonly EngineDay[],
  day1: string,
  today: string,
  o: EngineOptions = DEFAULT_ENGINE,
): EngineResult {
  const dayNo = diffDays(day1, today) + 1;
  const first = firstEstimateDay(o);
  if (dayNo < first) return { status: 'calibrating', day: dayNo, first_estimate_day: first };

  // Window [start, today]: never earlier than day 11, at most window_days long.
  const startNo = Math.max(o.excluded_days + 1, dayNo - (o.window_days - 1));
  const byDate = new Map(days.map((d) => [d.date, d]));
  const window: EngineDay[] = [];
  for (let n = startNo; n <= dayNo; n++) {
    const date = addDays(day1, n - 1);
    const d = byDate.get(date);
    window.push(d ?? { date, weighed: false });
  }
  const span = window.length - 1; // days between the two trend points
  const logged = window.filter((d) => d.kcal != null);
  const weighed = window.filter((d) => d.weighed);
  const startTrend = window[0]?.trend;
  const endTrend = window[window.length - 1]?.trend;

  if (
    logged.length < o.min_logged_days ||
    weighed.length < o.min_weighed_days ||
    startTrend == null ||
    endTrend == null ||
    span < o.min_window_days - 1
  ) {
    return {
      status: 'insufficient',
      day: dayNo,
      window_days: window.length,
      logged_days: logged.length,
      weighed_days: weighed.length,
      need_logged: o.min_logged_days,
      need_weighed: o.min_weighed_days,
    };
  }

  // Recency-weighted mean intake: half-life of one window (§4.5).
  const halfLife = window.length;
  let wsum = 0;
  let isum = 0;
  let lowShare = 0;
  for (const d of logged) {
    const age = diffDays(d.date, today);
    const w = Math.pow(0.5, age / halfLife);
    wsum += w;
    isum += w * d.kcal!;
    lowShare += w * (d.low_confidence_share ?? 0);
  }
  const meanIntake = isum / wsum;
  lowShare /= wsum;

  const delta = endTrend - startTrend; // kg, negative when losing
  const perDay = (delta * ENERGY_DENSITY_KCAL_PER_KG) / span;
  const tdee = meanIntake - perDay;

  // §4.5 confidence interval.
  const perDaySigma = meanIntake * (0.1 * (1 - lowShare) + 0.3 * lowShare);
  const seIntake =
    (perDaySigma / Math.sqrt(logged.length)) * Math.sqrt(window.length / logged.length);
  // EMA variance factor α/(2−α); two roughly independent points; gaps lengthen the effective lag.
  const emaFactor = Math.sqrt(o.alpha / (2 - o.alpha));
  const trendSigma = o.weight_sigma_kg * emaFactor * Math.sqrt(window.length / weighed.length);
  const seWeight = (Math.SQRT2 * trendSigma * ENERGY_DENSITY_KCAL_PER_KG) / span;
  const seDensity = (Math.abs(delta) * o.density_sigma) / span;
  const se = Math.sqrt(seIntake ** 2 + seWeight ** 2 + seDensity ** 2);
  const ci = 1.96 * se;

  const quality =
    (logged.length / window.length) * (weighed.length / window.length) * (1 - lowShare / 2);

  return {
    status: 'ok',
    estimate: {
      computed_on: today,
      tdee_kcal: Math.round(tdee),
      ci_low: Math.round(tdee - ci),
      ci_high: Math.round(tdee + ci),
      window_days: window.length,
      logged_days: logged.length,
      weighed_days: weighed.length,
      data_quality: Math.round(quality * 100) / 100,
      mean_intake: Math.round(meanIntake),
      delta_trend_kg: Math.round(delta * 100) / 100,
    },
  };
}

// §4.3 guard rails and §4.4 publishing — pure so the synthetic test covers them.

export const MAX_STEP_KCAL = 150;
export const DIVERGENCE_KCAL = 600;

export interface PublishDecision {
  /** TDEE to apply, after the ±150 cap. */
  tdee: number;
  /** The raw measured value the cap was applied to. */
  measured: number;
  capped: boolean;
  /** >600 kcal from the formula: do not apply automatically (§4.3). */
  diverged: boolean;
}

/**
 * What a weekly publish would apply: the measured TDEE moved at most ±150 from the last
 * published value (the formula TDEE before the first publish).
 */
export function decidePublish(
  measured: number,
  previous: number,
  formula: number,
  maxStep = MAX_STEP_KCAL,
  divergence = DIVERGENCE_KCAL,
): PublishDecision {
  const diverged = Math.abs(measured - formula) > divergence;
  const tdee = Math.round(Math.min(previous + maxStep, Math.max(previous - maxStep, measured)));
  return { tdee, measured, capped: tdee !== Math.round(measured), diverged };
}
