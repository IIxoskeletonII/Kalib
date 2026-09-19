// SPEC §4.1 — exponentially weighted trend weight. Gaps carry the trend forward and are
// marked un-weighed; nothing is interpolated into the series.
import { addDays, diffDays } from './dates';

export const DEFAULT_ALPHA = 0.15;

export interface WeighInPoint {
  date: string;
  weight_kg: number;
}

export interface TrendPoint {
  date: string;
  raw?: number;
  trend: number;
  weighed: boolean;
}

/**
 * Daily series from the first weigh-in through `through` (default: last weigh-in).
 * Duplicate dates: last one wins. Input order does not matter.
 */
export function computeTrend(
  weighIns: readonly WeighInPoint[],
  alpha: number = DEFAULT_ALPHA,
  through?: string,
): TrendPoint[] {
  if (alpha <= 0 || alpha > 1) throw new RangeError(`alpha must be in (0, 1], got ${alpha}`);
  const byDate = new Map<string, number>();
  for (const w of weighIns) byDate.set(w.date, w.weight_kg);
  if (byDate.size === 0) return [];

  const dates = [...byDate.keys()].sort();
  const first = dates[0]!;
  const last = through && through > dates[dates.length - 1]! ? through : dates[dates.length - 1]!;
  const n = diffDays(first, last);

  const out: TrendPoint[] = [];
  let trend = byDate.get(first)!;
  for (let i = 0; i <= n; i++) {
    const date = addDays(first, i);
    const raw = byDate.get(date);
    if (raw != null) {
      trend = i === 0 ? raw : trend + alpha * (raw - trend);
      out.push({ date, raw, trend, weighed: true });
    } else {
      out.push({ date, trend, weighed: false });
    }
  }
  return out;
}

/** Change in trend over the last `days` days; undefined when the series is too short. */
export function trendDelta(points: readonly TrendPoint[], days: number): number | undefined {
  if (points.length <= days) return undefined;
  const last = points[points.length - 1]!;
  const prev = points[points.length - 1 - days]!;
  return last.trend - prev.trend;
}
