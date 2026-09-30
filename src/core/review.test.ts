import { describe, expect, it } from 'vitest';
import type { DaySummary } from './coach';
import { daySodium, K_NA_TARGET, microPanel, potassiumSodium, weekReview } from './review';
import type { TrendPoint } from './trend';
import type { LogEntry } from './types';

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

describe('daySodium', () => {
  const foods = new Map([
    ['salty', { per_100g: { kcal: 100, protein: 5, carb: 10, fat: 2, fiber: 1, sodium: 800 } }],
    ['veg', { per_100g: { kcal: 50, protein: 2, carb: 8, fat: 0, fiber: 3, sodium: 10 } }],
    ['nosalt', { per_100g: { kcal: 100, protein: 5, carb: 10, fat: 2, fiber: 1 } }],
  ]);

  const entry = (over: Partial<LogEntry>): LogEntry =>
    ({
      id: over.id ?? 'e',
      user_id: 'local',
      created_at: '',
      updated_at: '',
      logged_at: '',
      date: '2026-09-14',
      meal_slot: 'lunch',
      name: 'x',
      grams: 100,
      servings: 1,
      kcal: 100,
      protein_g: 5,
      carb_g: 10,
      fat_g: 2,
      fiber_g: 1,
      micros: {},
      entry_method: 'search',
      confidence: 'high',
      ...over,
    }) as LogEntry;

  it('scales sodium from the food behind the entry', () => {
    const s = daySodium(
      [entry({ food_id: 'salty', grams: 200 })],
      foods,
      '2026-09-14',
      '2026-09-20',
    );
    expect(s).toHaveLength(1);
    expect(s[0]!.sodium_mg).toBeCloseTo(1600, 6);
    expect(s[0]!.coverage).toBe(1);
  });

  it('counts an entry with no food as uncovered rather than as zero salt', () => {
    const s = daySodium(
      [entry({ id: 'a', food_id: 'salty' }), entry({ id: 'b' })],
      foods,
      '2026-09-14',
      '2026-09-20',
    );
    expect(s[0]!.sodium_mg).toBeCloseTo(800, 6);
    expect(s[0]!.coverage).toBeCloseTo(0.5, 6);
  });

  it('treats a food without a sodium figure as unknown too', () => {
    const s = daySodium([entry({ food_id: 'nosalt' })], foods, '2026-09-14', '2026-09-20');
    expect(s[0]!.coverage).toBe(0);
  });

  it('ignores entries outside the window', () => {
    const s = daySodium(
      [entry({ date: '2026-09-01', food_id: 'salty' })],
      foods,
      '2026-09-14',
      '2026-09-20',
    );
    expect(s).toEqual([]);
  });
});

describe('potassiumSodium', () => {
  const withK = (date: string, potassium: number) =>
    day(date, 2200, { micros: { potassium } }, [{ kcal: 2200, micros: { potassium } }]);

  it('reports the ratio against the 2:1 target', () => {
    const days = [withK('2026-09-14', 3400), withK('2026-09-15', 3400)];
    const sodium = [
      { date: '2026-09-14', sodium_mg: 1700, coverage: 1 },
      { date: '2026-09-15', sodium_mg: 1700, coverage: 1 },
    ];
    const b = potassiumSodium(days, sodium)!;
    expect(b.ratio).toBeCloseTo(2, 6);
    expect(b.target).toBe(K_NA_TARGET);
    expect(b.days).toBe(2);
    expect(b.coverage).toBe(1);
  });

  it('reads an inverted diet as below target', () => {
    const b = potassiumSodium(
      [withK('2026-09-14', 2000)],
      [{ date: '2026-09-14', sodium_mg: 3500, coverage: 1 }],
    )!;
    expect(b.ratio).toBeLessThan(1);
  });

  it('refuses to judge a day it barely knows, rather than guessing', () => {
    expect(
      potassiumSodium(
        [withK('2026-09-14', 3400)],
        [{ date: '2026-09-14', sodium_mg: 1700, coverage: 0.2 }],
      ),
    ).toBeUndefined();
  });

  it('needs potassium coverage too', () => {
    const noK = day('2026-09-14', 2200, {}, [{ kcal: 2200, micros: {} }]);
    expect(
      potassiumSodium([noK], [{ date: '2026-09-14', sodium_mg: 1700, coverage: 1 }]),
    ).toBeUndefined();
  });

  it('skips incomplete days and says nothing when nothing is judgeable', () => {
    const half = day('2026-09-14', 400, { micros: { potassium: 3400 } }, [
      { kcal: 400, micros: { potassium: 3400 } },
    ]);
    expect(
      potassiumSodium([half], [{ date: '2026-09-14', sodium_mg: 1700, coverage: 1 }]),
    ).toBeUndefined();
    expect(potassiumSodium([], [])).toBeUndefined();
  });
});
