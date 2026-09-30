// SPEC §4.1 — menstrual-cycle-aware trend weight.
//
// Luteal-phase progesterone raises aldosterone and vasopressin, and the resulting fluid
// retention moves the scale by roughly 0.5–2 kg, peaking around the first day of menses and
// resolving over the following days (Wiley, Am J Hum Biol 2020). To an energy-balance engine
// that reads weight change as fat change, that looks like a stalled cut — and to the person
// reading the chart it looks like failure.
//
// The research sweep found no published algorithm for correcting it, so this takes the honest
// route rather than inventing one: it never subtracts a fabricated offset from a real reading.
// It says how much the reading can be *trusted*, and the filter in `tdee.ts` widens its
// measurement variance accordingly — a Kalman gain that drops in the retention window and
// recovers after it. Nothing is hidden, and nothing is made up.
import { addDays, diffDays } from './dates';

/** Used until the person's own cycles say otherwise. */
export const DEFAULT_CYCLE_DAYS = 28;
export const MIN_CYCLE_DAYS = 21;
export const MAX_CYCLE_DAYS = 35;

/** Days before the next expected start where retention builds. */
export const RETENTION_LEAD_DAYS = 5;
/** Days from the start of menses where it resolves. */
export const RETENTION_TAIL_DAYS = 3;

/** How far past the last logged start the prediction is still honest. */
export const MAX_PREDICTED_CYCLES = 2;

/** At the peak of the window a reading carries this multiple of its usual uncertainty. */
export const PEAK_SIGMA_SCALE = 3;

/**
 * Median gap between logged starts, clamped to the physiological range. One start (or none)
 * means there is no gap to measure, so the default stands.
 */
export function cycleLength(starts: readonly string[]): number {
  const sorted = [...new Set(starts)].sort();
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = diffDays(sorted[i - 1]!, sorted[i]!);
    if (gap >= MIN_CYCLE_DAYS && gap <= MAX_CYCLE_DAYS) gaps.push(gap);
  }
  if (gaps.length === 0) return DEFAULT_CYCLE_DAYS;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return Math.round(median);
}

/**
 * The cycle start on or before `date`, real or predicted. Predictions run at most
 * `MAX_PREDICTED_CYCLES` past the last logged start; beyond that the cycle is unknown and the
 * app says so rather than guessing.
 */
export function cycleStartFor(date: string, starts: readonly string[]): string | undefined {
  const sorted = [...new Set(starts)].sort();
  if (sorted.length === 0) return undefined;
  let last: string | undefined;
  for (const s of sorted) {
    if (s <= date) last = s;
    else break;
  }
  if (last == null) return undefined;
  const len = cycleLength(sorted);
  const elapsed = diffDays(last, date);
  if (elapsed < len) return last;
  const cycles = Math.floor(elapsed / len);
  if (cycles > MAX_PREDICTED_CYCLES) return undefined;
  return addDays(last, cycles * len);
}

/** 1-based day of the cycle `date` falls in, or undefined when the cycle is unknown. */
export function cycleDay(date: string, starts: readonly string[]): number | undefined {
  const start = cycleStartFor(date, starts);
  if (start == null) return undefined;
  return diffDays(start, date) + 1;
}

/**
 * How far into the retention window `date` sits, 0 (clear) to 1 (peak). The peak is the day
 * menses begins; it builds over the preceding days and resolves over the following ones.
 */
export function retentionLoad(date: string, starts: readonly string[]): number {
  const day = cycleDay(date, starts);
  if (day == null) return 0;
  const len = cycleLength(starts);
  // Distance in days from the nearest expected start: the day before the next one is -1,
  // the first day of this one is 0.
  const toNext = len - day + 1;
  const fromThis = day - 1;
  if (fromThis <= RETENTION_TAIL_DAYS) {
    return 1 - fromThis / (RETENTION_TAIL_DAYS + 1);
  }
  if (toNext <= RETENTION_LEAD_DAYS) {
    return 1 - (toNext - 1) / (RETENTION_LEAD_DAYS + 1);
  }
  return 0;
}

/**
 * Multiplier on the trend filter's measurement uncertainty for a weigh-in on `date`.
 * 1 outside the window, up to `PEAK_SIGMA_SCALE` at the peak.
 */
export function weightSigmaScale(date: string, starts: readonly string[]): number {
  return 1 + (PEAK_SIGMA_SCALE - 1) * retentionLoad(date, starts);
}

export interface RetentionWindow {
  from: string;
  to: string;
}

/**
 * The retention windows overlapping [from, to], for shading the trend chart. Contiguous days
 * are merged so a window crossing a cycle boundary reads as one band.
 */
export function retentionWindows(
  from: string,
  to: string,
  starts: readonly string[],
): RetentionWindow[] {
  if (starts.length === 0 || diffDays(from, to) < 0) return [];
  const out: RetentionWindow[] = [];
  let open: RetentionWindow | undefined;
  for (let i = 0; i <= diffDays(from, to); i++) {
    const date = addDays(from, i);
    if (retentionLoad(date, starts) > 0) {
      if (open) open.to = date;
      else open = { from: date, to: date };
    } else if (open) {
      out.push(open);
      open = undefined;
    }
  }
  if (open) out.push(open);
  return out;
}

/** One line for the chart legend and the weigh-in sheet. */
export function cyclePhaseLabel(date: string, starts: readonly string[]): string | undefined {
  const day = cycleDay(date, starts);
  if (day == null) return undefined;
  const load = retentionLoad(date, starts);
  if (load > 0) return `Day ${day} — water retention likely, the trend allows for it`;
  return `Day ${day} of the cycle`;
}
