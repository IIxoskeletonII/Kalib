import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIFFERENCE_KCAL,
  inferTrainingWeekdays,
  isTrainingDay,
  MAX_DIFFERENCE_KCAL,
  redistribute,
  type DayShape,
} from './trainingDays';
import type { MacroTotals } from './types';

const BASE: MacroTotals = { kcal: 2200, protein_g: 160, carb_g: 230, fat_g: 60, fiber_g: 30 };

/** Mon–Sun, training on the days named. */
function week(trainingDays: number[]): DayShape[] {
  return Array.from({ length: 7 }, (_, i) => ({
    date: `2026-10-${String(12 + i).padStart(2, '0')}`,
    training: trainingDays.includes(i),
  }));
}

const total = (days: { kcal: number }[]) => days.reduce((a, d) => a + d.kcal, 0);

describe('redistribute', () => {
  // This is the property the whole feature exists to preserve: the measured-TDEE engine is only
  // honest while the week's total is untouched.
  it('leaves the week total exactly unchanged', () => {
    for (const pattern of [[0, 2, 4], [0, 1], [0, 2, 4, 5], [3], [0, 1, 2, 3, 4, 5]]) {
      const out = redistribute({ days: week(pattern), base: BASE, floor_kcal: 1500 });
      expect(total(out), `pattern ${pattern.join(',')}`).toBe(BASE.kcal * 7);
    }
  });

  it('holds the total whatever the requested difference', () => {
    for (const difference_kcal of [0, 50, 150, 300, 500, 800, 5000]) {
      const out = redistribute({
        days: week([0, 2, 4]),
        base: BASE,
        difference_kcal,
        floor_kcal: 1200,
      });
      expect(total(out), `difference ${difference_kcal}`).toBe(BASE.kcal * 7);
    }
  });

  it('gives training days more and rest days less', () => {
    const out = redistribute({ days: week([0, 2, 4]), base: BASE, floor_kcal: 1500 });
    for (const d of out) {
      if (d.training) expect(d.kcal).toBeGreaterThan(BASE.kcal);
      else expect(d.kcal).toBeLessThan(BASE.kcal);
    }
  });

  it('separates a training day from a rest day by about the requested amount', () => {
    const out = redistribute({
      days: week([0, 2, 4]),
      base: BASE,
      difference_kcal: 300,
      floor_kcal: 1500,
    });
    const training = out.find((d) => d.training)!;
    const rest = out.find((d) => !d.training)!;
    expect(training.kcal - rest.kcal).toBeGreaterThanOrEqual(299);
    expect(training.kcal - rest.kcal).toBeLessThanOrEqual(301);
  });

  it('keeps protein, fat and fibre flat; only carbohydrate moves', () => {
    const out = redistribute({ days: week([0, 2, 4]), base: BASE, floor_kcal: 1500 });
    for (const d of out) {
      expect(d.protein_g).toBe(BASE.protein_g);
      expect(d.fat_g).toBe(BASE.fat_g);
      expect(d.fiber_g).toBe(BASE.fiber_g);
    }
    expect(out.find((d) => d.training)!.carb_g).toBeGreaterThan(BASE.carb_g);
    expect(out.find((d) => !d.training)!.carb_g).toBeLessThan(BASE.carb_g);
  });

  it('never pushes a rest day under the floor', () => {
    const out = redistribute({
      days: week([0, 2, 4]),
      base: BASE,
      difference_kcal: 800,
      floor_kcal: 2100,
    });
    for (const d of out) expect(d.kcal).toBeGreaterThanOrEqual(2100);
    expect(total(out)).toBe(BASE.kcal * 7);
  });

  it('does nothing when the floor leaves no room', () => {
    const out = redistribute({ days: week([0, 2, 4]), base: BASE, floor_kcal: BASE.kcal });
    for (const d of out) expect(d.delta_kcal).toBe(0);
  });

  it('never drives carbohydrate negative', () => {
    const lowCarb: MacroTotals = { ...BASE, carb_g: 20 };
    const out = redistribute({
      days: week([0, 2, 4]),
      base: lowCarb,
      difference_kcal: 800,
      floor_kcal: 1000,
    });
    for (const d of out) expect(d.carb_g).toBeGreaterThanOrEqual(0);
    expect(total(out)).toBe(lowCarb.kcal * 7);
  });

  it('stays flat with no training days', () => {
    const out = redistribute({ days: week([]), base: BASE, floor_kcal: 1500 });
    for (const d of out) expect(d).toMatchObject({ delta_kcal: 0, kcal: BASE.kcal });
  });

  it('stays flat when every day is a training day, because there is nothing to take from', () => {
    const out = redistribute({ days: week([0, 1, 2, 3, 4, 5, 6]), base: BASE, floor_kcal: 1500 });
    for (const d of out) expect(d.delta_kcal).toBe(0);
  });

  it('stays flat when the difference is zero', () => {
    const out = redistribute({
      days: week([0, 2, 4]),
      base: BASE,
      difference_kcal: 0,
      floor_kcal: 1500,
    });
    for (const d of out) expect(d.delta_kcal).toBe(0);
  });

  it('caps an absurd request rather than obeying it', () => {
    const out = redistribute({
      days: week([0, 2, 4]),
      base: { ...BASE, kcal: 6000, carb_g: 900 },
      difference_kcal: 99_999,
      floor_kcal: 1000,
    });
    const training = out.find((d) => d.training)!;
    const rest = out.find((d) => !d.training)!;
    expect(training.kcal - rest.kcal).toBeLessThanOrEqual(MAX_DIFFERENCE_KCAL + 1);
  });

  it('handles a single day and an empty week without throwing', () => {
    expect(redistribute({ days: [], base: BASE, floor_kcal: 1500 })).toEqual([]);
    const one = redistribute({
      days: [{ date: '2026-10-12', training: true }],
      base: BASE,
      floor_kcal: 1500,
    });
    expect(one[0]!.delta_kcal).toBe(0);
  });

  it('defaults to the documented difference', () => {
    const a = redistribute({ days: week([0, 2, 4]), base: BASE, floor_kcal: 1500 });
    const b = redistribute({
      days: week([0, 2, 4]),
      base: BASE,
      difference_kcal: DEFAULT_DIFFERENCE_KCAL,
      floor_kcal: 1500,
    });
    expect(a).toEqual(b);
  });
});

describe('inferTrainingWeekdays', () => {
  const now = new Date('2026-10-14T12:00:00'); // a Wednesday

  /** Mondays, Wednesdays and Fridays for the last four weeks. */
  const regular = [
    '2026-09-16',
    '2026-09-18',
    '2026-09-21',
    '2026-09-23',
    '2026-09-25',
    '2026-09-28',
    '2026-09-30',
    '2026-10-02',
    '2026-10-05',
    '2026-10-07',
    '2026-10-09',
    '2026-10-12',
    '2026-10-14',
  ];

  it('finds the weekdays actually trained', () => {
    // 1 Monday, 3 Wednesday, 5 Friday.
    expect(inferTrainingWeekdays(regular, now)).toEqual([1, 3, 5]);
  });

  it('ignores a one-off', () => {
    expect(inferTrainingWeekdays([...regular, '2026-10-11'], now)).toEqual([1, 3, 5]);
  });

  it('says nothing from a single week, which is a sample of one', () => {
    expect(inferTrainingWeekdays(['2026-10-12', '2026-10-14'], now)).toEqual([]);
  });

  it('says nothing from no history at all', () => {
    expect(inferTrainingWeekdays([], now)).toEqual([]);
  });

  it('ignores dates outside the window', () => {
    expect(inferTrainingWeekdays(['2026-01-05', '2026-01-07'], now)).toEqual([]);
  });

  it('ignores malformed dates rather than throwing', () => {
    expect(() => inferTrainingWeekdays(['not-a-date', ...regular], now)).not.toThrow();
    expect(inferTrainingWeekdays(['not-a-date', ...regular], now)).toEqual([1, 3, 5]);
  });

  it('refuses a nonsensical window', () => {
    expect(inferTrainingWeekdays(regular, now, 0)).toEqual([]);
  });
});

describe('isTrainingDay', () => {
  const trained = new Set(['2026-10-12', '2026-10-14']);

  it('counts a day that actually had a session, pattern or not', () => {
    expect(isTrainingDay('2026-10-14', trained, [])).toBe(true);
  });

  it('counts a future day whose weekday is in the pattern', () => {
    // 16 Oct 2026 is a Friday.
    expect(isTrainingDay('2026-10-16', trained, [5])).toBe(true);
  });

  it('is false for a day that is neither', () => {
    expect(isTrainingDay('2026-10-17', trained, [1, 3, 5])).toBe(false);
  });

  it('what happened beats what was expected', () => {
    // A Sunday with a session counts even though Sunday is not in the pattern.
    expect(isTrainingDay('2026-10-18', new Set(['2026-10-18']), [1, 3, 5])).toBe(true);
  });

  it('handles a malformed date', () => {
    expect(isTrainingDay('nonsense', trained, [1])).toBe(false);
  });
});
