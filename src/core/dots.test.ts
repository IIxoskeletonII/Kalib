import { describe, expect, it } from 'vitest';
import { DOTS_BODYWEIGHT, dots, dotsCoefficient } from './dots';

describe('dots', () => {
  // Published results on OpenPowerlifting, which ranks by DOTS. Bodyweights there are shown to
  // one decimal, so the figures agree to that precision rather than to the last digit.
  it.each([
    // Ray Williams, 2025 meets (M).
    [143.5, 462.6, 251.8],
    [142.8, 453.5, 247.17],
    [143.0, 426.3, 232.26],
  ])('men: %f kg bodyweight, %f kg total → %f', (bw, total, published) => {
    expect(dots('male', bw, total)!).toBeCloseTo(published, 1);
  });

  it.each([
    // Amanda Lawrence, 2025–26 meets (F).
    [83.9, 648, 596.6],
    [88.7, 645, 578.77],
    [83.7, 627.5, 578.38],
    [83.7, 635, 585.23],
  ])('women: %f kg bodyweight, %f kg total → %f', (bw, total, published) => {
    // 0.1 rather than 0.05: a bodyweight of 83.74 is shown as 83.7.
    expect(Math.abs(dots('female', bw, total)! - published)).toBeLessThan(0.1);
  });

  it('matches a worked example to the hundredth: 185 lb, 1,150 lb total → 350.00', () => {
    expect(dots('male', 185 * 0.45359237, 1150 * 0.45359237)!).toBeCloseTo(350.0, 2);
  });

  it('scales linearly with the total', () => {
    const k = dotsCoefficient('male', 90)!;
    expect(dots('male', 90, 500)).toBeCloseTo(k * 500, 10);
    expect(dots('male', 90, 0)).toBe(0);
  });

  it('gives a lighter lifter more per kilogram, within the fitted range', () => {
    for (const sex of ['male', 'female'] as const) {
      let previous = Infinity;
      for (let bw = 45; bw <= DOTS_BODYWEIGHT[sex].max; bw += 5) {
        const k = dotsCoefficient(sex, bw)!;
        expect(k).toBeLessThan(previous);
        previous = k;
      }
    }
  });

  it('holds the bodyweight at the edges of the fitted range rather than extrapolating', () => {
    expect(dotsCoefficient('male', 250)).toBe(dotsCoefficient('male', 210));
    expect(dotsCoefficient('male', 30)).toBe(dotsCoefficient('male', 40));
    expect(dotsCoefficient('female', 170)).toBe(dotsCoefficient('female', 150));
    expect(dotsCoefficient('female', 35)).toBe(dotsCoefficient('female', 40));
    // Unclamped, the quartic would hand a 250 kg man about 3.4 points more per 1,000 kg.
    expect(dots('male', 250, 1000)!).toBeCloseTo(495.62, 1);
  });

  it('women score higher than men on the same total and bodyweight', () => {
    expect(dots('female', 70, 400)!).toBeGreaterThan(dots('male', 70, 400)!);
  });

  it('refuses what is not a bodyweight or a total', () => {
    for (const bw of [0, -70, Number.NaN, Infinity]) {
      expect(dotsCoefficient('male', bw)).toBeUndefined();
    }
    expect(dots('male', 80, -1)).toBeUndefined();
    expect(dots('male', 80, Number.NaN)).toBeUndefined();
  });
});
