// SPEC §17.1 — water. Tiny and pure: totals, presets, litres formatting (§2.4: one decimal).
// Fluid ounces live in core/measure.ts with the other US units (§22).
import { DEFAULT_GLASS_FL_OZ, flOzToMl, type UnitSystem } from './measure';
import type { WaterLog } from './types';

export const WATER_PRESETS_ML: readonly number[] = [200, 250, 330, 500, 750];
export const GLASS_CHOICES_ML: readonly number[] = [200, 250, 330, 500];
export const DEFAULT_GLASS_ML = 250;
/** Stored in millilitres whichever units are shown (§22), so a glass never changes size. */
export const WATER_GLASS_KEY = 'water_glass_ml';

/** The glass "+" adds before one is chosen: 250 ml, or an 8 fl oz cup (237 ml). */
export function defaultGlassMl(s: UnitSystem): number {
  return s === 'us' ? flOzToMl(DEFAULT_GLASS_FL_OZ) : DEFAULT_GLASS_ML;
}

export function sumWater(logs: readonly WaterLog[]): number {
  let ml = 0;
  for (const l of logs) if (l.deleted_at == null) ml += l.ml;
  return ml;
}

/** "1.5 L", "0.3 L" — never millilitres past a litre. */
export function formatLitres(ml: number): string {
  return `${(ml / 1000).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} L`;
}

/** "250 ml" below a litre, "1.5 L" from there. */
export function formatWater(ml: number): string {
  return ml < 1000 ? `${Math.round(ml)} ml` : formatLitres(ml);
}
