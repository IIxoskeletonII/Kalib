// SPEC §22 — metric or US, for everything a person reads or types.
//
// One rule, the same one weightUnit.ts already applies to the bar: **store metric, convert at the
// edge.** Every weigh-in, waist, height, glass of water and gram of food is kept exactly as it was
// kept before this switch existed, so the trend, the Kalman filter and every target are computed
// on numbers that never change unit. This module is only the edge — what a number looks like on
// the way out, and what a typed number means on the way in.
//
// Two things the edge has to get right:
//
//   Round trips. 180 lb is stored as 81.6466266 kg — unrounded, because rounding to a tenth of a
//   kilo would read back as 179.9 lb, and a scale that says 180 must be shown as 180. Rounding
//   happens on display only.
//
//   Precision (§2.4). A unit change is not new data. A waist taped to the centimetre is good to
//   about 0.4 in, so inches get one decimal and no more; a body weight read to 0.1 kg is shown to
//   0.1 lb, which a pound scale also reads to.
//
// Energy stays kcal and macros stay grams in both systems: US nutrition labels print grams, and
// so does every US macro-tracking app, because "31 g of protein" is how the target is written.
import { KG_PER_LB } from './weightUnit';
import type { WeightUnit } from './types';

export type UnitSystem = 'metric' | 'us';

export const UNIT_SYSTEMS: readonly UnitSystem[] = ['metric', 'us'];

export function isUnitSystem(v: unknown): v is UnitSystem {
  return v === 'metric' || v === 'us';
}

export { KG_PER_LB };
/** The inch, exactly 2.54 cm since 1959. */
export const CM_PER_IN = 2.54;
export const IN_PER_FT = 12;
/** The avoirdupois ounce: a sixteenth of the international pound, so exact. */
export const G_PER_OZ = (KG_PER_LB * 1000) / 16;
/** The US customary fluid ounce: 231 cubic inches to the gallon, 128 ounces to it. */
export const ML_PER_FL_OZ = (231 * CM_PER_IN ** 3) / 128;
export const G_PER_LB = KG_PER_LB * 1000;

// Two ways of printing a number, kept apart on purpose because the app already used both and
// metric output must not change under this module: body measurements were always printed with
// a decimal point (`toFixed`), while food and water amounts follow the phone's locale (`fmt`).

/** `n` rounded to `dp` decimals, with a rounded-away minus dropped: nobody lost minus nothing. */
function round(n: number, dp: number): number {
  const r = Math.round(n * 10 ** dp) / 10 ** dp;
  return r === 0 ? 0 : r;
}

/** Locale digits with exactly `dp` decimals: the same formatting the UI's `fmt` uses. */
function digits(n: number, dp = 0): string {
  return round(n, dp).toLocaleString(undefined, {
    maximumFractionDigits: dp,
    minimumFractionDigits: dp,
  });
}

/** A decimal point and exactly `dp` decimals, as body measurements have always been shown. */
function fixed(n: number, dp: number): string {
  return round(n, dp).toFixed(dp);
}

/** Up to `dp` decimals, trailing zeros dropped: "180", "179.9", "0.25". */
function trimmed(n: number, dp: number): string {
  return String(round(n, dp));
}

/** As `trimmed`, in locale digits. */
function trimmedDigits(n: number, dp: number): string {
  const r = round(n, dp);
  return digits(r, decimalsOf(r, dp));
}

function decimalsOf(n: number, max: number): number {
  for (let d = 0; d < max; d++) {
    if (Math.abs(Math.round(n * 10 ** d) / 10 ** d - n) < 1e-9) return d;
  }
  return max;
}

// ---- body weight -------------------------------------------------------------------------

export function bodyUnit(s: UnitSystem): WeightUnit {
  return s === 'us' ? 'lb' : 'kg';
}

export function toBodyUnit(kg: number, s: UnitSystem): number {
  return s === 'us' ? kg / KG_PER_LB : kg;
}

export function fromBodyUnit(value: number, s: UnitSystem): number {
  return s === 'us' ? value * KG_PER_LB : value;
}

/** "81.6" or "179.9": the number alone, for a tile or a pad that prints its own unit. */
export function bodyWeightValue(kg: number, s: UnitSystem, dp = 1): string {
  return fixed(toBodyUnit(kg, s), dp);
}

/** "81.6 kg", "179.9 lb". */
export function formatBodyWeight(kg: number, s: UnitSystem, dp = 1): string {
  return `${bodyWeightValue(kg, s, dp)} ${bodyUnit(s)}`;
}

/** A typed goal, as typed: "68 kg", "68.5 kg", "150 lb" — no ".0" on a round number. */
export function formatBodyGoal(kg: number, s: UnitSystem): string {
  return `${trimmed(toBodyUnit(kg, s), 1)} ${bodyUnit(s)}`;
}

/** A change, signed: "+0.25", "−1.1". The sign is part of the reading, so 0 has none. */
export function signedBodyChange(kg: number, s: UnitSystem, dp = 1): string {
  return signed(toBodyUnit(kg, s), dp);
}

function signed(v: number, dp: number): string {
  const r = round(v, dp);
  return `${r > 0 ? '+' : ''}${r.toFixed(dp)}`;
}

/** Plausible body weights (§3): the same 20–400 kg either way, said in the unit being typed. */
export const BODY_MIN_KG = 20;
export const BODY_MAX_KG = 400;

export function isPlausibleBodyWeight(kg: number): boolean {
  return Number.isFinite(kg) && kg >= BODY_MIN_KG && kg <= BODY_MAX_KG;
}

// ---- lengths: waist and other tape measurements -------------------------------------------

export type LengthUnit = 'cm' | 'in';

export function lengthUnit(s: UnitSystem): LengthUnit {
  return s === 'us' ? 'in' : 'cm';
}

export function toLengthUnit(cm: number, s: UnitSystem): number {
  return s === 'us' ? cm / CM_PER_IN : cm;
}

export function fromLengthUnit(value: number, s: UnitSystem): number {
  return s === 'us' ? value * CM_PER_IN : value;
}

/**
 * Decimals a tape reading is good for. A centimetre tape reads to the centimetre; that is
 * 0.39 in, so one decimal of an inch is already a little finer than the data and two would be
 * invention. An inch tape typed as 33.5 keeps its half.
 */
export function lengthDecimals(s: UnitSystem): number {
  return s === 'us' ? 1 : 0;
}

export function lengthValue(cm: number, s: UnitSystem, dp = lengthDecimals(s)): string {
  return fixed(toLengthUnit(cm, s), dp);
}

export function formatLength(cm: number, s: UnitSystem, dp = lengthDecimals(s)): string {
  return `${lengthValue(cm, s, dp)} ${lengthUnit(s)}`;
}

export function signedLengthChange(cm: number, s: UnitSystem, dp = lengthDecimals(s)): string {
  return signed(toLengthUnit(cm, s), dp);
}

// ---- height --------------------------------------------------------------------------------

export interface FeetInches {
  feet: number;
  inches: number;
}

/**
 * 178 cm → 5 ft 10 in. Whole inches, as a height is said; 71.9 in rounds to 6 ft 0 in, never
 * to "5 ft 12 in".
 */
export function cmToFeetInches(cm: number): FeetInches {
  const total = Math.round(cm / CM_PER_IN);
  return { feet: Math.floor(total / IN_PER_FT), inches: total % IN_PER_FT };
}

/** 5 ft 10 in → 177.8 cm. Inches may carry a decimal, and more than 11 simply adds up. */
export function feetInchesToCm(feet: number, inches: number): number {
  return (feet * IN_PER_FT + inches) * CM_PER_IN;
}

/** "178 cm", "5 ft 10 in". Words, not primes: a screen reader says 5′10″ as "5 prime 10". */
export function formatHeight(cm: number, s: UnitSystem): string {
  if (s === 'metric') return `${trimmed(cm, 1)} cm`;
  const { feet, inches } = cmToFeetInches(cm);
  return `${feet} ft ${inches} in`;
}

/** Heights the profile accepts (§3): 100–250 cm, whichever way they were typed. */
export const HEIGHT_MIN_CM = 100;
export const HEIGHT_MAX_CM = 250;

export function isPlausibleHeight(cm: number): boolean {
  return Number.isFinite(cm) && cm >= HEIGHT_MIN_CM && cm <= HEIGHT_MAX_CM;
}

// ---- water ---------------------------------------------------------------------------------

export type WaterUnit = 'L' | 'fl oz';

export function waterUnit(s: UnitSystem): WaterUnit {
  return s === 'us' ? 'fl oz' : 'L';
}

/** Millilitres from fluid ounces, to the whole millilitre: water is logged in whole ml. */
export function flOzToMl(flOz: number): number {
  return Math.round(flOz * ML_PER_FL_OZ);
}

export function mlToFlOz(ml: number): number {
  return ml / ML_PER_FL_OZ;
}

/**
 * A total, as the tile and the sheet header show it: litres to one decimal, or whole fluid
 * ounces — the way a US bottle is labelled. A fluid ounce is 30 ml, finer than the litre's
 * tenth, so whole ounces lose nothing the litre display kept.
 */
export function waterTotalValue(ml: number, s: UnitSystem): string {
  return s === 'us' ? digits(mlToFlOz(ml)) : digits(ml / 1000, 1);
}

/** "250 ml" under a litre and "1.5 L" from there; "8 fl oz" and "64 fl oz" in US. */
export function formatWaterAmount(ml: number, s: UnitSystem): string {
  if (s === 'us') return `${digits(mlToFlOz(ml))} fl oz`;
  return ml < 1000 ? `${Math.round(ml)} ml` : `${digits(ml / 1000, 1)} L`;
}

/** A target or a total: always litres in metric ("2.5 L", never "2500 ml"). */
export function formatWaterTotal(ml: number, s: UnitSystem): string {
  return `${waterTotalValue(ml, s)} ${waterUnit(s)}`;
}

export const WATER_PRESETS_FL_OZ: readonly number[] = [8, 12, 16, 20, 24];
export const GLASS_CHOICES_FL_OZ: readonly number[] = [8, 12, 16, 20];
export const DEFAULT_GLASS_FL_OZ = 8;

/** The custom amount pad, in the unit being typed. */
export const WATER_ENTRY_MIN_ML = 10;
export const WATER_ENTRY_MAX_ML = 3000;

/** A typed custom amount, in ml: whole ml as typed, or fluid ounces converted. */
export function waterEntryMl(value: number, s: UnitSystem): number {
  return s === 'us' ? flOzToMl(value) : Math.round(value);
}

// ---- food amounts --------------------------------------------------------------------------

export type FoodMassUnit = 'g' | 'oz';

export function foodMassUnit(s: UnitSystem): FoodMassUnit {
  return s === 'us' ? 'oz' : 'g';
}

export function toFoodUnit(g: number, s: UnitSystem): number {
  return s === 'us' ? g / G_PER_OZ : g;
}

export function fromFoodUnit(value: number, s: UnitSystem): number {
  return s === 'us' ? value * G_PER_OZ : value;
}

/**
 * Ounces are coarse: one is 28 g, so a tenth of one (2.8 g) is about what a kitchen scale
 * reads and is kept below 100 oz; above that the tenth is noise on a pot of chili.
 */
export function foodValue(g: number, s: UnitSystem): string {
  if (s === 'metric') return digits(g);
  const oz = toFoodUnit(g, s);
  return Math.abs(oz) < 100 ? trimmedDigits(oz, 1) : digits(oz);
}

/** "150 g", "5.3 oz". */
export function formatFoodMass(g: number, s: UnitSystem): string {
  return `${foodValue(g, s)} ${foodMassUnit(s)}`;
}

/**
 * A quantity to buy: "450 g" and "1.25 kg", or "12 oz" and "2.4 lb". Packs are sold in pounds
 * past one, so past a pound it is pounds.
 */
export function formatBulkMass(g: number, s: UnitSystem): string {
  if (s === 'metric') return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`;
  if (g >= G_PER_LB) return `${trimmed(g / G_PER_LB, 1)} lb`;
  return `${digits(g / G_PER_OZ)} oz`;
}

/** The pack-weight pad: grams, or ounces with a decimal. */
export function packEntryGrams(value: number, s: UnitSystem): number {
  return fromFoodUnit(value, s);
}

/** What a typical pack weighs, in the unit being typed: 500 g, or a pound written as 16 oz. */
export function defaultPackValue(s: UnitSystem): string {
  return s === 'us' ? '16' : '500';
}

/** A price per kilo, or per pound, for display. Storage keeps per kilo. */
export function pricePerMassUnit(perKg: number, s: UnitSystem): number {
  return s === 'us' ? perKg * KG_PER_LB : perKg;
}

export function pricePerKgFrom(value: number, s: UnitSystem): number {
  return s === 'us' ? value / KG_PER_LB : value;
}

export function priceMassLabel(s: UnitSystem): 'kg' | 'lb' {
  return s === 'us' ? 'lb' : 'kg';
}

/** A week's cooked weight, to the whole kilo as before, or the whole pound. */
export function cookedWeightValue(g: number, s: UnitSystem): { value: string; unit: string } {
  return s === 'us'
    ? { value: digits(g / G_PER_LB), unit: 'lb' }
    : { value: digits(g / 1000), unit: 'kg' };
}

// ---- goal rate -----------------------------------------------------------------------------

/**
 * The rate chips, in the unit they are shown in. US coaching is said in whole and half pounds
 * a week — "a pound a week" — so the chips are those, not 0.25 kg converted to 0.55 lb.
 */
export const RATE_CHOICES: Record<UnitSystem, { cut: number[]; bulk: number[] }> = {
  metric: { cut: [0.25, 0.5, 0.75, 1.0], bulk: [0.125, 0.25, 0.375, 0.5] },
  us: { cut: [0.5, 1, 1.5, 2], bulk: [0.25, 0.5, 0.75, 1] },
};

/** "0.5" kg, "1" lb, "0.125" kg: as many decimals as the chip has, up to three. */
export function rateValue(kgPerWeek: number, s: UnitSystem): string {
  return trimmed(toBodyUnit(kgPerWeek, s), s === 'us' ? 2 : 3);
}

/** "0.5 kg a week", "1 lb a week". */
export function formatRate(kgPerWeek: number, s: UnitSystem): string {
  return `${rateValue(kgPerWeek, s)} ${bodyUnit(s)} a week`;
}

/** Whether a stored rate is the chip `choice` (in display units), allowing for float noise. */
export function isRateChoice(kgPerWeek: number, choice: number, s: UnitSystem): boolean {
  return Math.abs(kgPerWeek - fromBodyUnit(choice, s)) < 1e-6;
}

// ---- entry ---------------------------------------------------------------------------------

/** A typed decimal: "180", "72,5" or "72.5". Empty or not a number is undefined. */
export function parseDecimal(text: string): number | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '' || t === '.') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The text a pad starts on for a stored value: the display value with no trailing zeros, so a
 * stored 81.6466266 kg opens as "180" in pounds and an untouched save writes nothing new.
 */
export function entryText(value: number, dp: number): string {
  const r = Math.round(value * 10 ** dp) / 10 ** dp;
  return String(r === 0 ? 0 : r);
}

// ---- choosing the system -------------------------------------------------------------------

/**
 * Which system to use. What you chose wins; until then the market Kalib is shopping in (§19)
 * decides, because the US is the one market here that weighs in pounds. A guess, never a lock:
 * it is a default shown in Settings with the switch beside it.
 */
export function decideUnitSystem(stored: unknown, market: string | undefined): UnitSystem {
  if (isUnitSystem(stored)) return stored;
  return market === 'US' ? 'us' : 'metric';
}

/** The gym's own override (§22): plates are physical, and a gym's are kilos or pounds. */
export type GymUnitChoice = 'follow' | 'kg' | 'lb';

export function isGymUnitChoice(v: unknown): v is GymUnitChoice {
  return v === 'follow' || v === 'kg' || v === 'lb';
}

/**
 * The gym's choice. Before this setting existed the gym had its own kg/lb switch; someone who set
 * it to pounds keeps pounds at the bar whatever the rest of the app does, so nothing they see
 * changes on update. A stored "kg" was the default anyone could have tapped back to, so it
 * follows the system.
 */
export function decideGymChoice(stored: unknown, legacy: unknown): GymUnitChoice {
  if (isGymUnitChoice(stored)) return stored;
  return legacy === 'lb' ? 'lb' : 'follow';
}

export function gymUnit(s: UnitSystem, choice: GymUnitChoice): WeightUnit {
  return choice === 'follow' ? bodyUnit(s) : choice;
}
