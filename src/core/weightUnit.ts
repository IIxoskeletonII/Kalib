// SPEC §20.4 — kilograms and pounds.
//
// The rule everywhere else in this app applies here too: store one unit, convert at the edge.
// Every weight on a set, a PR or a session total is kilograms in the database, exactly as body
// weight is; `lb` only changes what the pad asks for and what is printed. Storing whichever
// unit was typed would mean a year of history that cannot be totalled without knowing, per row,
// which unit it was in.
import type { WeightUnit } from './types';

/** The international pound, exactly 0.45359237 kg by definition. */
export const KG_PER_LB = 0.45359237;

export const UNIT_LABEL: Record<WeightUnit, string> = { kg: 'kg', lb: 'lb' };

/**
 * The smallest change a gym can actually make: a pair of 1.25 kg plates, or a pair of 2.5 lb.
 * Used by the warm-up ramp and by progression, so neither ever suggests a weight nobody can
 * load.
 */
export const INCREMENT: Record<WeightUnit, number> = { kg: 2.5, lb: 5 };

export function toDisplay(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? kg : kg / KG_PER_LB;
}

export function fromDisplay(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value : value * KG_PER_LB;
}

/**
 * Rounds to what a bar can hold. §2.4 forbids showing more precision than the data has, and a
 * loaded barbell resolves to about half a kilo — printing 82.47 kg would be inventing three
 * digits the plates do not have.
 */
export function roundForDisplay(value: number): number {
  return Math.round(value * 10) / 10;
}

/** "82.5 kg", "185 lb" — a trailing .0 is noise, so it goes. */
export function formatWeight(kg: number, unit: WeightUnit): string {
  const n = roundForDisplay(toDisplay(kg, unit));
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${UNIT_LABEL[unit]}`;
}

/** The number alone, for a pad or a field that prints its own unit. */
export function displayValue(kg: number, unit: WeightUnit): string {
  const n = roundForDisplay(toDisplay(kg, unit));
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Snaps a weight to the nearest loadable step in the user's unit, then returns kilograms.
 * A suggestion of "82.3 kg" is useless; "82.5 kg" is a pair of plates.
 */
export function snapToIncrement(kg: number, unit: WeightUnit): number {
  const step = INCREMENT[unit];
  const inUnit = toDisplay(kg, unit);
  return fromDisplay(Math.round(inUnit / step) * step, unit);
}

/** Rejects what a set cannot hold: negative, absurd, or not a number at all. */
export function isPlausibleLoad(kg: number): boolean {
  return Number.isFinite(kg) && kg >= 0 && kg <= 600;
}
