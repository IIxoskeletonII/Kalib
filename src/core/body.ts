// SPEC §3.1 / §14 — body composition from a tape measure.
//
// §14 records the owner's body fat as "30–40% self-estimated — low confidence, verify by waist
// measurement", and the project's third success criterion is judged on waist rather than scale
// weight alone. This module is that verification: Relative Fat Mass (Woolcott & Bergman 2018,
// Nature Scientific Reports 8:10980) estimates whole-body fat percentage from height and waist
// only, validated against DXA at R² 0.84 — better than BMI, and comparable to a consumer
// impedance scale without the device-to-device bias.
//
// Pure, like everything in core/: no clamping surprises, no I/O, every branch tested.
import type { Sex } from './types';

/** Plausible tape readings. Outside this the input is a typo, not a body. */
export const WAIST_MIN_CM = 40;
export const WAIST_MAX_CM = 250;

/** Body fat percentages outside this range are not survivable; RFM is clamped into it. */
export const BODYFAT_MIN_PCT = 3;
export const BODYFAT_MAX_PCT = 75;

/** Waist-to-height at or under this is the widely used low-risk screen ("waist < half height"). */
export const WHTR_HEALTHY_MAX = 0.5;

export function isPlausibleWaist(waist_cm: number): boolean {
  return Number.isFinite(waist_cm) && waist_cm >= WAIST_MIN_CM && waist_cm <= WAIST_MAX_CM;
}

/**
 * RFM = 64 − 20 × (height / waist), plus 12 for women. Height and waist must share a unit;
 * the ratio makes the choice irrelevant, so centimetres are used throughout the app.
 */
export function relativeFatMass(height_cm: number, waist_cm: number, sex: Sex): number {
  if (!(height_cm > 0) || !(waist_cm > 0)) {
    throw new RangeError(`height and waist must be positive, got ${height_cm} and ${waist_cm}`);
  }
  const raw = 64 - 20 * (height_cm / waist_cm) + (sex === 'female' ? 12 : 0);
  return Math.min(BODYFAT_MAX_PCT, Math.max(BODYFAT_MIN_PCT, raw));
}

/** Waist as a share of height. Below 0.5 is the low-risk side of the screen. */
export function waistToHeight(height_cm: number, waist_cm: number): number {
  if (!(height_cm > 0)) throw new RangeError(`height must be positive, got ${height_cm}`);
  return waist_cm / height_cm;
}

/**
 * Fat-free mass index — FFM in kg over height in metres squared. Used only as a plausibility
 * check on an entered body fat percentage: a natural male ceiling sits near 25.
 */
export function fatFreeMassIndex(
  weight_kg: number,
  bodyfat_pct: number,
  height_cm: number,
): number {
  const m = height_cm / 100;
  if (!(m > 0)) throw new RangeError(`height must be positive, got ${height_cm}`);
  return (weight_kg * (1 - bodyfat_pct / 100)) / (m * m);
}

/** Where a body fat percentage came from, in descending order of trust. */
export type BodyFatSource = 'measured' | 'waist' | 'profile';

export interface BodyFatEstimate {
  pct: number;
  source: BodyFatSource;
  /** Present for 'waist': the reading it was derived from. */
  waist_cm?: number;
}

export interface BodyFatInputs {
  sex: Sex;
  height_cm: number;
  /** Entered on a weigh-in — an impedance scale or a caliper reading. Trusted first. */
  measured_pct?: number | undefined;
  /** Tape reading from the same weigh-in. */
  waist_cm?: number | undefined;
  /** The onboarding estimate. §14 calls this low confidence, so it loses to both of the above. */
  profile_pct?: number | undefined;
}

/**
 * The body fat percentage §3.2 should use: a real measurement if there is one, else RFM from the
 * waist, else the onboarding guess. Returns undefined when nothing is known, which keeps
 * `computeTargets` on the Mifflin-St Jeor branch exactly as before.
 */
export function resolveBodyFat(i: BodyFatInputs): BodyFatEstimate | undefined {
  if (i.measured_pct != null && Number.isFinite(i.measured_pct)) {
    return { pct: i.measured_pct, source: 'measured' };
  }
  if (i.waist_cm != null && isPlausibleWaist(i.waist_cm) && i.height_cm > 0) {
    return {
      pct: relativeFatMass(i.height_cm, i.waist_cm, i.sex),
      source: 'waist',
      waist_cm: i.waist_cm,
    };
  }
  if (i.profile_pct != null && Number.isFinite(i.profile_pct)) {
    return { pct: i.profile_pct, source: 'profile' };
  }
  return undefined;
}

/** How the number is described wherever it is shown, so the UI never implies a DXA scan. */
export function bodyFatBasis(e: BodyFatEstimate): string {
  if (e.source === 'measured') return 'as entered';
  if (e.source === 'waist') return `from a ${Math.round(e.waist_cm ?? 0)} cm waist (RFM)`;
  return 'your starting estimate';
}
