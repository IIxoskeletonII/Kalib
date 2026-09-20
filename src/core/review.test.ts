import { describe, expect, it } from 'vitest';
import type { DaySummary } from './coach';
import { microPanel, weekReview } from './review';
import type { TrendPoint } from './trend';

const target = { kcal: 2200, protein_g: 160, carb_g: 200, fat_g: 70, fiber_g: 35 };

function day(
  date: string,
  kcal: number,
  over: Partial<DaySummary['totals']> = {},
  entries?: DaySummary['entries'],
): DaySummary {
  return {
    date,
    totals: { kcal, protein_g: 150, carb_g: 200, fat_g: 70, fiber_g: 30, micros: {}, ...over },
    target,
    entries: entries ?? [{ kcal, micros: { iron: 8 } }],
  };
}

const trend: TrendPoint[] = [
  { date: '2026-09-14', trend: 112, weighed: true },
  { date: '2026-09-15', trend: 111.9, weighed: true },
  { date: '2026-09-16', trend: 111.8, weighed: false },
  { date: '2026-09-17', trend: 111.7, weighed: true },
  { date: '2026-09-18', trend: 111.6, weighed: true },
  { date: '2026-09-19', trend: 111.5, weighed: true },
  { date: '2026-09-20', trend: 111.4, weighed: true },
];

describe('weekReview', () => {
  it('averages over complete days only and reads the trend change', () => {
    const days = [
      day('2026-09-14', 2100),
      day('2026-09-15', 2300),
      day('2026-09-16', 400), // half-logged: excluded
      day('2026-09-17', 2200),
    ];
    const r = weekReview(days, trend, '2026-09-14', '2026-09-20');
    expect(r.days).toBe(4);
    expect(r.completeDays).toBe(3);
    expect(r.avgKcal).toBeCloseTo(2200);
    expect(r.avgTarget).toBe(2200);
    expect(r.adherence).toBeCloseTo(1);
    expect(r.weighedDays).toBe(6);
    expect(r.weightDelta).toBeCloseTo(-0.6, 5);
  });

  it('carries the §7.4 provenance over the week', () => {
    const days = [
      day('2026-09-14', 2000, {}, [
        { kcal: 1500, micros: { iron: 5 }, confidence: 'high' },
        { kcal: 500, micros: {}, confidence: 'medium' },
      ]),
      day('2026-09-15', 2000, {}, [{ kcal: 2000, micros: { iron: 5 }, confidence: 'high' }]),
    ];
    const r = weekReview(days, trend, '2026-09-14', '2026-09-20');
    expect(r.calorieConfidence).toBeCloseTo(3500 / 4000);
    expect(r.microCoverage).toBeCloseTo(3500 / 4000);
  });

  it('is empty-safe', () => {
    const r = weekReview([], [], '2026-09-14', '2026-09-20');
    expect(r.completeDays).toBe(0);
    expect(r.adherence).toBe(0);
    expect(r.weightDelta).toBeUndefined();
    expect(r.calorieConfidence).toBeNull();
  });
});

describe('microPanel', () => {
  it('judges each nutrient only on days whose food carried it; the rest is unknown, not zero', () => {
    const days = [
      day('2026-09-14', 2200, { micros: { iron: 4, vit_c: 90 } }, [
        { kcal: 2200, micros: { iron: 4, vit_c: 90 } },
      ]),
      day('2026-09-15', 2200, { micros: { iron: 12, vit_c: 90 } }, [
        { kcal: 2200, micros: { iron: 12, vit_c: 90 } },
      ]),
      // a gyro day: 800 of 2,200 kcal with no data → iron coverage 64% < 70%, excluded
      day('2026-09-16', 2200, { micros: { iron: 40 } }, [
        { kcal: 1400, micros: { iron: 40 } },
        { kcal: 800, micros: {} },
      ]),
      day('2026-09-17', 900), // incomplete
    ];
    const p = microPanel(days, 'male');
    expect(p.daysComplete).toBe(3);
    const iron = p.stats.find((s) => s.key === 'iron')!;
    expect(iron.days).toBe(2);
    expect(iron.average).toBe(8);
    expect(iron.ratio).toBe(1);
    expect(p.stats.find((s) => s.key === 'vit_c')!.ratio).toBe(1);
    // nothing logged carried magnesium: it is unknown, never "0%"
    expect(p.stats.find((s) => s.key === 'magnesium')).toBeUndefined();
    expect(p.unknown.find((s) => s.key === 'magnesium')!.days).toBe(0);
    expect(p.stats.length + p.unknown.length).toBe(22);
    expect(p.stats.find((s) => s.key === 'iron')!.group).toBe('mineral');
  });

  it('uses the sex-specific RDA', () => {
    const days = [
      day('2026-09-14', 2200, { micros: { iron: 9 } }, [{ kcal: 2200, micros: { iron: 9 } }]),
    ];
    expect(microPanel(days, 'male').stats.find((s) => s.key === 'iron')!.rda).toBe(8);
    expect(microPanel(days, 'female').stats.find((s) => s.key === 'iron')!.rda).toBe(18);
  });

  it('returns no stats without a usable day', () => {
    const p = microPanel([day('2026-09-14', 500)], 'male');
    expect(p.stats).toEqual([]);
    expect(p.unknown.length).toBe(22);
  });
});
