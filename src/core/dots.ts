// SPEC §21.3 — DOTS, the bodyweight normalisation the circle scores progress with.
//
// A total means nothing across body sizes: 400 kg is a modest total at 120 kg and a remarkable
// one at 60 kg. DOTS is the IPF's answer for raw powerlifting, published openly, and the formula
// OpenPowerlifting ranks every lifter by: 500 divided by a fourth-degree polynomial in
// bodyweight, times the total.
//
// The circle never compares one person's DOTS with another's — it compares each person with
// their own past (§21.3). DOTS is here for what happens to one person over a few weeks: on a cut
// the bodyweight falls, the same total is worth more per kilogram, and holding strength while
// losing weight is the improvement it is. Without it, the best cut of someone's life would score
// as a plateau.
//
// Constants from OpenPowerlifting's implementation (opl-data, crates/coefficients/src/dots.rs),
// checked against its published meet results in dots.test.ts.
import type { Sex } from './types';

/** Highest power first: a·bw⁴ + b·bw³ + c·bw² + d·bw + e. */
const COEFFICIENTS: Record<Sex, readonly [number, number, number, number, number]> = {
  male: [-0.000001093, 0.0007391293, -0.1918759221, 24.0900756, -307.75076],
  female: [-0.0000010706, 0.0005158568, -0.1126655495, 13.6175032, -57.96288],
};

/**
 * The bodyweights the polynomial was fitted over. Outside them it is held at the edge rather
 * than extrapolated, as the reference implementation does: a quartic left to run turns over and
 * would start rewarding weight it was never fitted to.
 */
export const DOTS_BODYWEIGHT: Record<Sex, { min: number; max: number }> = {
  male: { min: 40, max: 210 },
  female: { min: 40, max: 150 },
};

/** Multiply a total in kg by this. Undefined for a bodyweight that is not a bodyweight. */
export function dotsCoefficient(sex: Sex, bodyweight_kg: number): number | undefined {
  if (!Number.isFinite(bodyweight_kg) || bodyweight_kg <= 0) return undefined;
  const { min, max } = DOTS_BODYWEIGHT[sex];
  const bw = Math.min(max, Math.max(min, bodyweight_kg));
  const [a, b, c, d, e] = COEFFICIENTS[sex];
  return 500 / ((((a * bw + b) * bw + c) * bw + d) * bw + e);
}

/** The DOTS score of a total. Undefined when either number is not one. */
export function dots(sex: Sex, bodyweight_kg: number, total_kg: number): number | undefined {
  if (!Number.isFinite(total_kg) || total_kg < 0) return undefined;
  const k = dotsCoefficient(sex, bodyweight_kg);
  return k == null ? undefined : k * total_kg;
}
