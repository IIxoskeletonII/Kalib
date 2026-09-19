// SPEC §3 — user parameters and target derivation. Pure functions; every branch is tested.
import type { ActivityLevel, Mode, Sex } from './types';

export const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  heavy: 1.725,
};

/** kcal per kg of fat mass (§4.2). */
export const ENERGY_DENSITY_KCAL_PER_KG = 7700;
/** Days before the formula TDEE is replaced by a measured one (§3.3, §4.2). */
export const CALIBRATION_DAYS = 14;

export const DEFICIT_MIN = 0.1;
export const DEFICIT_MAX = 0.25;
export const RECOMP_DEFICIT_MAX = 0.1;

export interface TargetInputs {
  sex: Sex;
  age: number;
  height_cm: number;
  weight_kg: number;
  bodyfat_pct?: number | undefined;
  activity_level: ActivityLevel;
  mode: Mode;
  /** Desired loss rate, kg/week (positive = losing). */
  goal_rate_kg_per_week: number;
  /** Used for protein when body fat is unknown (§3.4). Falls back to weight_kg. */
  target_weight_kg?: number | undefined;
  /** Measured TDEE from the §4 engine. When present it replaces the formula scaffold. */
  measured_tdee?: number | undefined;
}

export type BmrMethod = 'katch_mcardle' | 'mifflin_st_jeor' | 'mean';
export type FloorName = 'bmr_110pct' | 'sex_minimum' | 'macro_minimum';

export interface BmrResult {
  bmr: number;
  method: BmrMethod;
  /** True when both formulas were available and disagreed by >10% (§3.2). */
  uncertain: boolean;
  lbm_kg?: number;
  mifflin: number;
  katch?: number;
}

export interface Targets {
  bmr: number;
  bmr_method: BmrMethod;
  bmr_uncertain: boolean;
  lbm_kg?: number;
  tdee: number;
  tdee_source: 'formula' | 'measured';
  deficit_pct: number;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  fiber_g: number;
  water_ml: number;
  floors_applied: FloorName[];
}

export function mifflinStJeor(sex: Sex, weight_kg: number, height_cm: number, age: number): number {
  return 10 * weight_kg + 6.25 * height_cm - 5 * age + (sex === 'male' ? 5 : -161);
}

export function katchMcArdle(lbm_kg: number): number {
  return 370 + 21.6 * lbm_kg;
}

export function leanBodyMass(weight_kg: number, bodyfat_pct: number): number {
  return weight_kg * (1 - bodyfat_pct / 100);
}

export function computeBmr(i: TargetInputs): BmrResult {
  const mifflin = mifflinStJeor(i.sex, i.weight_kg, i.height_cm, i.age);
  if (i.bodyfat_pct == null) {
    return { bmr: mifflin, method: 'mifflin_st_jeor', uncertain: false, mifflin };
  }
  const lbm_kg = leanBodyMass(i.weight_kg, i.bodyfat_pct);
  const katch = katchMcArdle(lbm_kg);
  const disagreement = Math.abs(katch - mifflin) / Math.max(katch, mifflin);
  if (disagreement > 0.1) {
    return { bmr: (katch + mifflin) / 2, method: 'mean', uncertain: true, lbm_kg, mifflin, katch };
  }
  return { bmr: katch, method: 'katch_mcardle', uncertain: false, lbm_kg, mifflin, katch };
}

export function formulaTdee(bmr: number, activity: ActivityLevel): number {
  return bmr * ACTIVITY_MULTIPLIER[activity];
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** §3.4 / §3.5 — deficit fraction for the mode. Positive = below TDEE. */
export function deficitPct(mode: Mode, goal_rate_kg_per_week: number, tdee: number): number {
  if (mode === 'MAINTAIN') return 0;
  const raw = (goal_rate_kg_per_week * ENERGY_DENSITY_KCAL_PER_KG) / (tdee * 7);
  if (mode === 'RECOMP') return clamp(raw, 0, RECOMP_DEFICIT_MAX);
  return clamp(raw, DEFICIT_MIN, DEFICIT_MAX);
}

export function proteinTarget(i: TargetInputs, lbm_kg: number | undefined): number {
  if (lbm_kg != null) {
    // §3.4: 2.0 g/kg LBM, range 1.8–2.2, cap 2.5. RECOMP holds protein at the upper bound.
    const perKg = i.mode === 'RECOMP' ? 2.2 : 2.0;
    return Math.min(perKg, 2.5) * lbm_kg;
  }
  return 1.8 * (i.target_weight_kg ?? i.weight_kg);
}

export function fatTarget(weight_kg: number, kcal: number): number {
  return Math.max(0.6 * weight_kg, (0.22 * kcal) / 9);
}

export function fiberTarget(kcal: number): number {
  return Math.max((14 * kcal) / 1000, 25);
}

export function waterTarget(weight_kg: number): number {
  return 35 * weight_kg;
}

export function sexFloor(sex: Sex): number {
  return sex === 'male' ? 1500 : 1200;
}

export function computeTargets(i: TargetInputs): Targets {
  const b = computeBmr(i);
  const tdee_source = i.measured_tdee != null ? 'measured' : 'formula';
  const tdee = i.measured_tdee ?? formulaTdee(b.bmr, i.activity_level);
  const deficit_pct = deficitPct(i.mode, i.goal_rate_kg_per_week, tdee);
  const protein_g = proteinTarget(i, b.lbm_kg);

  // Fat depends on kcal and the macro floor depends on fat, so: fat from the pre-floor
  // kcal, apply floors, then recompute fat from the final kcal. Tests assert the fixed point.
  const kcalRaw = tdee * (1 - deficit_pct);
  const fatRaw = fatTarget(i.weight_kg, kcalRaw);
  const floors: [FloorName, number][] = [
    ['bmr_110pct', b.bmr * 1.1],
    ['sex_minimum', sexFloor(i.sex)],
    ['macro_minimum', protein_g * 4 + fatRaw * 9 + 50],
  ];
  let kcal = kcalRaw;
  const floors_applied: FloorName[] = [];
  for (const [name, floor] of floors) {
    if (kcal < floor) {
      kcal = floor;
      floors_applied.push(name);
    }
  }
  const fat_g = fatTarget(i.weight_kg, kcal);
  const carb_g = Math.max(0, (kcal - protein_g * 4 - fat_g * 9) / 4);

  return {
    bmr: b.bmr,
    bmr_method: b.method,
    bmr_uncertain: b.uncertain,
    ...(b.lbm_kg != null ? { lbm_kg: b.lbm_kg } : {}),
    tdee,
    tdee_source,
    deficit_pct,
    kcal,
    protein_g,
    fat_g,
    carb_g,
    fiber_g: fiberTarget(kcal),
    water_ml: waterTarget(i.weight_kg),
    floors_applied,
  };
}

/** §3.3 — the formula TDEE is a scaffold; anything not measured by the §4 engine is provisional. */
export function isProvisional(tdee_source: Targets['tdee_source']): boolean {
  return tdee_source === 'formula';
}
