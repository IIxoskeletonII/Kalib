// SPEC §22 — reading and writing the units choice. Both keys are ordinary settings, so they
// sync and both phones show the same units.
import { deviceZone, isMarket, marketForZone, MARKET_KEY } from '@/core/market';
import {
  decideGymChoice,
  decideUnitSystem,
  gymUnit,
  isUnitSystem,
  type GymUnitChoice,
  type UnitSystem,
} from '@/core/measure';
import type { WeightUnit } from '@/core/types';
import { getSetting, setSetting } from '@/db/repo/settings';
import { WEIGHT_UNIT_KEY } from './workouts';

export const UNIT_SYSTEM_KEY = 'unit_system';
export const GYM_UNIT_KEY = 'gym_unit';

export interface UnitsChoice {
  system: UnitSystem;
  /** Whether `system` is a stored choice, or a guess not yet written down. */
  chosen: boolean;
  gym: GymUnitChoice;
  /** What the bar is loaded in, after the gym's override. */
  gymUnit: WeightUnit;
}

/** Where the guess comes from: the stored market, else what the phone's clock says. */
async function marketGuess(): Promise<string | undefined> {
  const stored = await getSetting<unknown>(MARKET_KEY);
  return isMarket(stored) ? stored : marketForZone(deviceZone());
}

export async function getUnits(): Promise<UnitsChoice> {
  const [stored, gymStored, legacy] = await Promise.all([
    getSetting<unknown>(UNIT_SYSTEM_KEY),
    getSetting<unknown>(GYM_UNIT_KEY),
    getSetting<unknown>(WEIGHT_UNIT_KEY),
  ]);
  const chosen = isUnitSystem(stored);
  const system = chosen ? stored : decideUnitSystem(undefined, await marketGuess());
  const gym = decideGymChoice(gymStored, legacy);
  return { system, chosen, gym, gymUnit: gymUnit(system, gym) };
}

export async function getUnitSystem(): Promise<UnitSystem> {
  return (await getUnits()).system;
}

export async function setUnitSystem(system: UnitSystem): Promise<void> {
  await setSetting(UNIT_SYSTEM_KEY, system);
}

/**
 * Writes the guess down the first time it is made. A guess left floating would follow the
 * market, and the market follows the phone abroad: a week in New York would quietly turn a
 * metric person's weigh-ins into pounds. Written once, it only changes when they change it.
 */
export async function adoptUnitSystem(): Promise<void> {
  const u = await getUnits();
  if (!u.chosen) await setUnitSystem(u.system);
}

export async function setGymChoice(choice: GymUnitChoice): Promise<void> {
  await setSetting(GYM_UNIT_KEY, choice);
}
