// Orchestration between the profile/weigh-in repos and the pure §3 formulas.
import { ageOn } from '@/core/dates';
import { computeTargets, isProvisional, type TargetInputs, type Targets } from '@/core/targets';
import type { DailyTarget, Profile, WeighIn } from '@/core/types';
import {
  ensureDailyTarget,
  upsertDailyTarget,
  type DailyTargetInput,
} from '@/db/repo/dailyTargets';
import { getCurrentProfile } from '@/db/repo/profiles';
import { listWeighIns } from '@/db/repo/weighIns';

export function targetInputsFor(profile: Profile, weight_kg: number, date: string): TargetInputs {
  return {
    sex: profile.sex,
    age: ageOn(profile.birth_date, date),
    height_cm: profile.height_cm,
    weight_kg,
    bodyfat_pct: profile.bodyfat_pct,
    activity_level: profile.activity_level,
    mode: profile.mode,
    goal_rate_kg_per_week: profile.goal_rate_kg_per_week,
    target_weight_kg: profile.target_weight_kg,
  };
}

/** Latest weigh-in on or before `date`, else the earliest one after it. */
export function weightFor(weighIns: readonly WeighIn[], date: string): number | undefined {
  let best: WeighIn | undefined;
  for (const w of weighIns) {
    if (w.date <= date) best = w;
    else break;
  }
  return (best ?? weighIns[0])?.weight_kg;
}

export function toDailyTargetInput(t: Targets): DailyTargetInput {
  return {
    kcal: Math.round(t.kcal),
    protein_g: Math.round(t.protein_g),
    carb_g: Math.round(t.carb_g),
    fat_g: Math.round(t.fat_g),
    fiber_g: Math.round(t.fiber_g),
    water_ml: Math.round(t.water_ml / 50) * 50,
    banking_adjustment: 0,
    source: t.tdee_source,
    provisional: isProvisional(t.tdee_source),
  };
}

/** Full §3 result for the current profile and latest weight; undefined until onboarded. */
export async function currentTargets(date: string): Promise<Targets | undefined> {
  const profile = await getCurrentProfile();
  if (!profile) return undefined;
  const weight = weightFor(await listWeighIns(), date);
  if (weight == null) return undefined;
  return computeTargets(targetInputsFor(profile, weight, date));
}

/** Stored target for `date`, computing it on first sight of the day. */
export async function ensureTargetForDate(date: string): Promise<DailyTarget | undefined> {
  const t = await currentTargets(date);
  if (!t) return undefined;
  return ensureDailyTarget(date, () => toDailyTargetInput(t));
}

/** Recompute and overwrite — used after the profile is edited. */
export async function refreshTargetForDate(date: string): Promise<DailyTarget | undefined> {
  const t = await currentTargets(date);
  if (!t) return undefined;
  return upsertDailyTarget(date, toDailyTargetInput(t));
}
