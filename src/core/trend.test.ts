import { describe, expect, it } from 'vitest';
import { computeTrend, trendDelta } from './trend';

describe('computeTrend (§4.1)', () => {
  it('returns an empty series for no weigh-ins', () => {
    expect(computeTrend([])).toEqual([]);
  });

  it('seeds the trend with the first weigh-in', () => {
    expect(computeTrend([{ date: '2026-09-21', weight_kg: 110 }])).toEqual([
      { date: '2026-09-21', raw: 110, trend: 110, weighed: true },
    ]);
  });

  it('applies the EMA on consecutive days', () => {
    const s = computeTrend(
      [
        { date: '2026-09-21', weight_kg: 100 },
        { date: '2026-09-22', weight_kg: 90 },
        { date: '2026-09-23', weight_kg: 90 },
      ],
      0.15,
    );
    expect(s[1]!.trend).toBeCloseTo(98.5, 9);
    expect(s[2]!.trend).toBeCloseTo(98.5 + 0.15 * (90 - 98.5), 9);
  });

  it('carries the trend across gaps without interpolating', () => {
    const s = computeTrend([
      { date: '2026-09-21', weight_kg: 100 },
      { date: '2026-09-24', weight_kg: 98 },
    ]);
    expect(s.map((p) => p.date)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']);
    expect(s[1]).toEqual({ date: '2026-09-22', trend: 100, weighed: false });
    expect(s[2]).toEqual({ date: '2026-09-23', trend: 100, weighed: false });
    expect(s[3]!.weighed).toBe(true);
    expect(s[3]!.trend).toBeCloseTo(100 + 0.15 * (98 - 100), 9);
  });

  it('extends through a later date with the trend carried forward', () => {
    const s = computeTrend([{ date: '2026-09-21', weight_kg: 100 }], 0.15, '2026-09-23');
    expect(s).toHaveLength(3);
    expect(s[2]).toEqual({ date: '2026-09-23', trend: 100, weighed: false });
  });

  it('ignores a `through` earlier than the last weigh-in', () => {
    const s = computeTrend(
      [
        { date: '2026-09-21', weight_kg: 100 },
        { date: '2026-09-22', weight_kg: 100 },
      ],
      0.15,
      '2026-09-01',
    );
    expect(s).toHaveLength(2);
  });

  it('is order-independent and last-wins on duplicate dates', () => {
    const s = computeTrend([
      { date: '2026-09-22', weight_kg: 90 },
      { date: '2026-09-21', weight_kg: 100 },
      { date: '2026-09-22', weight_kg: 95 },
    ]);
    expect(s[0]!.raw).toBe(100);
    expect(s[1]!.raw).toBe(95);
    expect(s[1]!.trend).toBeCloseTo(99.25, 9);
  });

  it('rejects alpha outside (0, 1]', () => {
    expect(() => computeTrend([{ date: '2026-09-21', weight_kg: 1 }], 0)).toThrow(RangeError);
    expect(() => computeTrend([{ date: '2026-09-21', weight_kg: 1 }], 1.5)).toThrow(RangeError);
  });

  it('a smaller alpha responds more slowly to a step change', () => {
    const data = [
      { date: '2026-09-21', weight_kg: 100 },
      { date: '2026-09-22', weight_kg: 95 },
    ];
    expect(computeTrend(data, 0.1)[1]!.trend).toBeGreaterThan(computeTrend(data, 0.25)[1]!.trend);
  });
});

describe('trendDelta', () => {
  const s = computeTrend([
    { date: '2026-09-21', weight_kg: 100 },
    { date: '2026-09-22', weight_kg: 99 },
    { date: '2026-09-23', weight_kg: 98 },
  ]);

  it('returns the trend change over N days', () => {
    expect(trendDelta(s, 2)).toBeCloseTo(s[2]!.trend - s[0]!.trend, 9);
  });

  it('is undefined when the series is too short', () => {
    expect(trendDelta(s, 3)).toBeUndefined();
    expect(trendDelta([], 1)).toBeUndefined();
  });
});
