// SPEC §17.1 — water. Tiny and pure: totals, presets, litres formatting (§2.4: one decimal).
import type { WaterLog } from './types';

export const WATER_PRESETS_ML: readonly number[] = [200, 250, 330, 500, 750];
export const DEFAULT_GLASS_ML = 250;
export const WATER_GLASS_KEY = 'water_glass_ml';

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
