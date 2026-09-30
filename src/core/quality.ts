// SPEC §16 — food quality beyond the macro count.
//
// Three cheap, well-evidenced levers that the numbers already on file can express:
//
//   Protein density (g per 100 kcal). The protein-leverage hypothesis holds that intake is
//   regulated partly by seeking a protein target, so diluting protein makes people eat more
//   total energy. Protein per calorie is therefore a better guide than protein in grams.
//
//   Energy density (kcal per 100 g). Lower means more food for the same calories, largely
//   through water and fibre, and it raises fullness per calorie eaten.
//
//   Satiety. Holt et al. (Eur J Clin Nutr 1995) ranked 38 foods per 240 kcal serving against
//   white bread and found protein, fibre and water pushing fullness up and fat pushing it down.
//
// `satietyScore` is an ordinal heuristic built from those directions — not the measured index,
// which only ever covered 38 foods. It is labelled as an estimate everywhere it is shown, for
// the same reason §7.4 shows coverage: a score whose basis is hidden is worse than no score.
// The weights are stated here in the open and asserted in the test.
import type { Per100g } from './types';

/** Above this, food is calorie-dense enough that portion size stops being intuitive. */
export const ENERGY_DENSE_KCAL_PER_100G = 275;
/** Energy density at which the density component of the satiety score reaches zero. */
export const ED_CEILING = 400;

export const SATIETY_WEIGHTS = {
  protein: 0.35,
  fiber: 0.25,
  low_energy_density: 0.3,
  low_fat: 0.1,
} as const;

/** Protein density saturates here — past this, more protein per calorie changes little. */
export const PROTEIN_DENSITY_CAP = 12;
export const FIBER_DENSITY_CAP = 5;

/** Grams of protein per 100 kcal. Zero-calorie foods have no density to speak of. */
export function proteinDensity(p: Per100g): number {
  return p.kcal > 0 ? (p.protein / p.kcal) * 100 : 0;
}

/** Grams of fibre per 100 kcal. */
export function fiberDensity(p: Per100g): number {
  return p.kcal > 0 ? (p.fiber / p.kcal) * 100 : 0;
}

/** Kilocalories per 100 g — the per_100g figure, named for what it means. */
export function energyDensity(p: Per100g): number {
  return p.kcal;
}

/** Share of a food's energy that comes from fat, 0-1. */
export function fatEnergyShare(p: Per100g): number {
  return p.kcal > 0 ? Math.min(1, (p.fat * 9) / p.kcal) : 0;
}

/**
 * 0-100, higher means more filling per calorie. Calibrated so the landmark foods fall in the
 * order they were measured in: chicken breast 61, boiled potato 50, white bread 34,
 * croissant 14.
 */
export function satietyScore(p: Per100g): number {
  if (!(p.kcal > 0)) return 0;
  const protein = Math.min(1, proteinDensity(p) / PROTEIN_DENSITY_CAP);
  const fiber = Math.min(1, fiberDensity(p) / FIBER_DENSITY_CAP);
  const lowED = Math.max(0, 1 - energyDensity(p) / ED_CEILING);
  const lowFat = 1 - fatEnergyShare(p);
  const raw =
    SATIETY_WEIGHTS.protein * protein +
    SATIETY_WEIGHTS.fiber * fiber +
    SATIETY_WEIGHTS.low_energy_density * lowED +
    SATIETY_WEIGHTS.low_fat * lowFat;
  return Math.round(Math.min(100, Math.max(0, raw * 100)));
}

export type SatietyBand = 'low' | 'moderate' | 'high';

// Bands chosen against the study's own landmarks: white bread was the 100 baseline and sits
// mid-table, the boiled potato was the most filling food measured, the croissant the least.
export const SATIETY_HIGH = 48;
export const SATIETY_MODERATE = 33;

export function satietyBand(score: number): SatietyBand {
  if (score >= SATIETY_HIGH) return 'high';
  if (score >= SATIETY_MODERATE) return 'moderate';
  return 'low';
}

/** One phrase for a food row - only worth showing when it says something. */
export function qualityNote(p: Per100g): string | undefined {
  if (!(p.kcal > 0)) return undefined;
  const pd = proteinDensity(p);
  const band = satietyBand(satietyScore(p));
  if (pd >= 10) return `${pd.toFixed(0)} g protein per 100 kcal`;
  if (band === 'high') return 'Filling for its calories';
  if (energyDensity(p) >= ENERGY_DENSE_KCAL_PER_100G) return 'Calorie-dense - weigh this one';
  return undefined;
}

/** Protein per 100 kcal across a day's totals, for the weekly review. */
export function dayProteinDensity(kcal: number, protein_g: number): number {
  return kcal > 0 ? (protein_g / kcal) * 100 : 0;
}
