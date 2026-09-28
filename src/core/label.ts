// SPEC §9.6 — what a photographed nutrition label becomes. Pure: validate the reader's JSON
// and put it on the footing the custom-food editor uses (a serving and its macros).
import type { Confidence } from './types';

export interface LabelReading {
  name: string;
  brand: string;
  /** Grams the figures below describe. */
  serving_g: number;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  fiber_g: number;
  confidence: Confidence;
  notes: string;
  /** True when the label's own per-serving column was used rather than per 100 g. */
  per_serving: boolean;
}

const num = (v: unknown, hi: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(hi, Math.round(n * 10) / 10);
};
const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

/**
 * A label is trustworthy only if its numbers hold together: the macros have to account for
 * the calories it claims, within the rounding a label is allowed (4/4/9 kcal per gram).
 */
export function macrosAgree(
  r: Pick<LabelReading, 'kcal' | 'protein_g' | 'carb_g' | 'fat_g'>,
): boolean {
  const fromMacros = r.protein_g * 4 + r.carb_g * 4 + r.fat_g * 9;
  if (r.kcal <= 0) return false;
  // Sugar alcohols, fibre and rounding move this a little; a quarter out is a misread.
  return Math.abs(fromMacros - r.kcal) <= Math.max(25, r.kcal * 0.25);
}

export function parseLabel(raw: unknown): LabelReading | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const perServing = o.basis === 'per_serving';
  const serving = num(o.serving_g, 5000);
  const reading: LabelReading = {
    name: str(o.name, 80),
    brand: str(o.brand, 60),
    // Per-100 g figures describe 100 g, whatever serving the packet suggests.
    serving_g: perServing ? serving || 100 : 100,
    kcal: num(o.kcal, 2000),
    protein_g: num(o.protein_g, 200),
    carb_g: num(o.carb_g, 200),
    fat_g: num(o.fat_g, 200),
    fiber_g: num(o.fiber_g, 100),
    confidence: o.confidence === 'high' || o.confidence === 'medium' ? o.confidence : 'low',
    notes: str(o.notes, 200),
    per_serving: perServing,
  };
  if (reading.kcal <= 0) return null;
  return reading;
}
