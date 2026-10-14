// SPEC §20.4 — what to actually put on the bar, and how to get there.
//
// Both of these are arithmetic someone does in their head between sets, badly, while tired.
// Hevy charges for the warm-up calculator; it is thirty lines of pure maths, so it is free here.
//
// Plate maths is done in the user's own unit rather than in kilograms. A rack of pound plates
// cannot make 62.5 kg however hard the arithmetic tries, and converting first would produce
// loads that look right and cannot be loaded.
import { fromDisplay, INCREMENT, toDisplay } from './weightUnit';
import type { WeightUnit } from './types';

/** What a commercial gym has on the rack, heaviest first. In the unit named, not kilograms. */
export const DEFAULT_PLATES: Record<WeightUnit, number[]> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
};

/** The men's Olympic bar in each unit. A 15 kg bar or a technique bar is set per routine. */
export const DEFAULT_BAR: Record<WeightUnit, number> = { kg: 20, lb: 45 };

export interface PlateLoad {
  /** Plates for one side, heaviest first, in the display unit. */
  per_side: number[];
  /** What those plates and the bar actually come to, in kilograms. */
  achieved_kg: number;
  /** How far short of the request that is, in kilograms. Zero when it lands exactly. */
  short_kg: number;
  bar_kg: number;
}

const EPS = 1e-9;

/**
 * The plates for one side of a bar, greedily heaviest first — which is optimal for every real
 * plate set, since each is a multiple of the next.
 *
 * Returns undefined when the target is lighter than the bar: there is nothing to say except
 * that it cannot be loaded, and a UI saying "no plates" would imply the bar alone is right.
 */
export function plateLoad(
  target_kg: number,
  o: { unit: WeightUnit; bar?: number; plates?: readonly number[] },
): PlateLoad | undefined {
  const bar = o.bar ?? DEFAULT_BAR[o.unit];
  const plates = [...(o.plates ?? DEFAULT_PLATES[o.unit])].sort((a, b) => b - a);
  const target = toDisplay(target_kg, o.unit);
  if (!Number.isFinite(target) || target < bar - EPS) return undefined;

  let remaining = (target - bar) / 2;
  const per_side: number[] = [];
  for (const p of plates) {
    // A plate set with a zero or negative entry would spin here forever.
    if (p <= 0) continue;
    while (remaining >= p - EPS) {
      per_side.push(p);
      remaining -= p;
    }
  }
  const loaded = bar + per_side.reduce((a, b) => a + b, 0) * 2;
  return {
    per_side,
    achieved_kg: fromDisplay(loaded, o.unit),
    short_kg: fromDisplay(Math.max(0, target - loaded), o.unit),
    bar_kg: fromDisplay(bar, o.unit),
  };
}

/** "20 + 20 + 10 + 2.5" — what you hang on one side, in the order you hang it. */
export function describePlates(load: PlateLoad): string {
  return load.per_side.length === 0 ? 'bar only' : load.per_side.join(' + ');
}

export interface WarmupSet {
  weight_kg: number;
  reps: number;
  /** The share of the working weight this step is, for a UI that wants to show it. */
  fraction: number;
}

/**
 * A warm-up ramp to a working weight: the bar, then roughly 40%, 60% and 80%, with reps falling
 * as load rises. The pattern is the ordinary one in strength coaching — enough to rehearse the
 * groove and raise tissue temperature without spending the session's working sets.
 *
 * Every step is snapped to something loadable and anything that collapses into the step before
 * it, or into the working weight itself, is dropped. A light working weight therefore produces
 * a short ramp or none at all, which is correct: you do not warm up to 30 kg in four stages.
 */
export function warmupRamp(working_kg: number, o: { unit: WeightUnit; bar?: number }): WarmupSet[] {
  const barDisplay = o.bar ?? DEFAULT_BAR[o.unit];
  const bar_kg = fromDisplay(barDisplay, o.unit);
  if (!Number.isFinite(working_kg) || working_kg <= bar_kg) return [];

  const step = INCREMENT[o.unit];
  const snap = (kg: number): number => {
    const inUnit = toDisplay(kg, o.unit);
    // Round down: a warm-up that overshoots is no longer a warm-up.
    const stepped = Math.max(barDisplay, Math.floor(inUnit / step) * step);
    return fromDisplay(stepped, o.unit);
  };

  const plan: { weight_kg: number; reps: number; fraction: number }[] = [
    { weight_kg: bar_kg, reps: 8, fraction: bar_kg / working_kg },
    { weight_kg: snap(working_kg * 0.4), reps: 5, fraction: 0.4 },
    { weight_kg: snap(working_kg * 0.6), reps: 3, fraction: 0.6 },
    { weight_kg: snap(working_kg * 0.8), reps: 2, fraction: 0.8 },
  ];

  const out: WarmupSet[] = [];
  for (const s of plan) {
    if (s.weight_kg >= working_kg - EPS) continue;
    const prev = out[out.length - 1];
    if (prev && s.weight_kg <= prev.weight_kg + EPS) continue;
    out.push(s);
  }
  return out;
}
