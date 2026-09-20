// Orchestration between the profile/weigh-in repos and the pure §3 formulas.
import { ageOn } from '@/core/dates';
import {
  computeTargets,
  isProvisional,
  resolveMode,
  type ModeSwitch,
  type TargetInputs,
  type Targets,
} from '@/core/targets';
import type { DailyTarget, Profile, WeighIn } from '@/core/types';
import {
  ensureDailyTarget,
  upsertDailyTarget,
  type DailyTargetInput,
} from '@/db/repo/dailyTargets';
import { getCurrentProfile } from '@/db/repo/profiles';
import { getSetting, setSetting } from '@/db/repo/settings';
import { listWeighIns } from '@/db/repo/weighIns';

export const MODE_SCHEDULE_KEY = 'mode_schedule';

export async function getModeSchedule(): Promise<ModeSwitch[]> {
  return (await getSetting<ModeSwitch[]>(MODE_SCHEDULE_KEY)) ?? [];
}

export async function setModeSchedule(schedule: ModeSwitch[]): Promise<void> {
  await setSetting(
    MODE_SCHEDULE_KEY,
    [...schedule].sort((a, b) => (a.date < b.date ? -1 : 1)),
  );
}

/** §4.4 — the TDEE the weekly publish put into force, and from when. */
export interface PublishedTdee {
  tdee: number;
  measured: number;
  since: string;
  estimate_date: string;
}

export const PUBLISHED_TDEE_KEY = 'tdee:published';

export async function getPublishedTdee(): Promise<PublishedTdee | undefined> {
  return (await getSetting<PublishedTdee>(PUBLISHED_TDEE_KEY)) ?? undefined;
}

export function targetInputsFor(
  profile: Profile,
  weight_kg: number,
  date: string,
  schedule: readonly ModeSwitch[] = [],
  published?: PublishedTdee | undefined,
): TargetInputs {
  return {
    sex: profile.sex,
    age: ageOn(profile.birth_date, date),
    height_cm: profile.height_cm,
    weight_kg,
    bodyfat_pct: profile.bodyfat_pct,
    activity_level: profile.activity_level,
    mode: resolveMode(profile.mode, schedule, date),
    goal_rate_kg_per_week: profile.goal_rate_kg_per_week,
    target_weight_kg: profile.target_weight_kg,
    // A published measurement applies from its publish date; earlier days stay formula.
    measured_tdee: published && date >= published.since ? published.tdee : undefined,
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
  const [weighIns, schedule, published] = await Promise.all([
    listWeighIns(),
    getModeSchedule(),
    getPublishedTdee(),
  ]);
  const weight = weightFor(weighIns, date);
  if (weight == null) return undefined;
  return computeTargets(targetInputsFor(profile, weight, date, schedule, published));
}

/** The §3.3 scaffold for `date`, ignoring any published measurement — the §4.3 reference. */
export async function formulaTargets(date: string): Promise<Targets | undefined> {
  const profile = await getCurrentProfile();
  if (!profile) return undefined;
  const [weighIns, schedule] = await Promise.all([listWeighIns(), getModeSchedule()]);
  const weight = weightFor(weighIns, date);
  if (weight == null) return undefined;
  return computeTargets(targetInputsFor(profile, weight, date, schedule));
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
