import { describe, expect, it } from 'vitest';
import {
  dayProteinDensity,
  ENERGY_DENSE_KCAL_PER_100G,
  energyDensity,
  fatEnergyShare,
  fiberDensity,
  proteinDensity,
  qualityNote,
  satietyBand,
  SATIETY_HIGH,
  SATIETY_MODERATE,
  satietyScore,
  SATIETY_WEIGHTS,
} from './quality';
import type { Per100g } from './types';

const food = (p: Partial<Per100g>): Per100g => ({
  kcal: 0,
  protein: 0,
  carb: 0,
  fat: 0,
  fiber: 0,
  ...p,
});

// USDA figures for the foods the satiety study used as landmarks.
const CHICKEN = food({ kcal: 165, protein: 31, fat: 3.6 });
const POTATO = food({ kcal: 87, protein: 2, carb: 20, fat: 0.1, fiber: 1.8 });
const WHITE_BREAD = food({ kcal: 265, protein: 9, carb: 49, fat: 3.2, fiber: 2.7 });
const CROISSANT = food({ kcal: 406, protein: 8, carb: 46, fat: 21, fiber: 2.6 });
const LENTILS = food({ kcal: 116, protein: 9, carb: 20, fat: 0.4, fiber: 7.9 });
const OLIVE_OIL = food({ kcal: 884, fat: 100 });

describe('densities', () => {
  it('reads protein per 100 kcal, not per 100 g', () => {
    expect(proteinDensity(CHICKEN)).toBeCloseTo(18.79, 2);
    expect(proteinDensity(WHITE_BREAD)).toBeCloseTo(3.4, 1);
  });

  it('reads fibre per 100 kcal', () => {
    expect(fiberDensity(LENTILS)).toBeCloseTo(6.81, 2);
  });

  it('reports energy density as the per-100 g calories', () => {
    expect(energyDensity(CROISSANT)).toBe(406);
  });

  it('reports the share of energy from fat', () => {
    expect(fatEnergyShare(OLIVE_OIL)).toBe(1);
    expect(fatEnergyShare(CHICKEN)).toBeCloseTo(0.196, 3);
  });

  it('says nothing rather than dividing by zero for a calorie-free food', () => {
    const water = food({ kcal: 0 });
    expect(proteinDensity(water)).toBe(0);
    expect(fiberDensity(water)).toBe(0);
    expect(fatEnergyShare(water)).toBe(0);
    expect(satietyScore(water)).toBe(0);
    expect(qualityNote(water)).toBeUndefined();
  });
});

describe('satietyScore', () => {
  it('puts the landmark foods in the order they were measured in', () => {
    expect(satietyScore(POTATO)).toBeGreaterThan(satietyScore(WHITE_BREAD));
    expect(satietyScore(WHITE_BREAD)).toBeGreaterThan(satietyScore(CROISSANT));
  });

  it('matches the calibration quoted in the source comment', () => {
    expect(satietyScore(CHICKEN)).toBe(61);
    expect(satietyScore(POTATO)).toBe(50);
    expect(satietyScore(WHITE_BREAD)).toBe(34);
    expect(satietyScore(CROISSANT)).toBe(14);
  });

  it('ranks pure fat at the bottom and a legume near the top', () => {
    expect(satietyScore(OLIVE_OIL)).toBe(0);
    expect(satietyScore(LENTILS)).toBeGreaterThan(satietyScore(POTATO));
  });

  it('stays within 0-100 for every plausible food', () => {
    for (const kcal of [1, 50, 200, 500, 900]) {
      for (const protein of [0, 10, 40]) {
        for (const fat of [0, 10, 50, 100]) {
          for (const fiber of [0, 5, 20]) {
            const s = satietyScore(food({ kcal, protein, fat, fiber }));
            expect(s).toBeGreaterThanOrEqual(0);
            expect(s).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });

  it('declares its weights, and they sum to one', () => {
    const sum = Object.values(SATIETY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('bands the score against the landmarks the study measured', () => {
    expect(satietyBand(satietyScore(POTATO))).toBe('high'); // the most filling food measured
    expect(satietyBand(satietyScore(WHITE_BREAD))).toBe('moderate'); // the 100 baseline
    expect(satietyBand(satietyScore(CROISSANT))).toBe('low'); // the least filling
    expect(satietyBand(SATIETY_HIGH)).toBe('high');
    expect(satietyBand(SATIETY_MODERATE - 1)).toBe('low');
  });
});

describe('qualityNote', () => {
  it('leads with protein density when it is the striking fact', () => {
    expect(qualityNote(CHICKEN)).toBe('19 g protein per 100 kcal');
  });

  it('calls out a filling food and a dense one', () => {
    expect(qualityNote(POTATO)).toBe('Filling for its calories');
    expect(qualityNote(CROISSANT)).toBe('Calorie-dense - weigh this one');
    expect(energyDensity(CROISSANT)).toBeGreaterThan(ENERGY_DENSE_KCAL_PER_100G);
  });

  it('stays quiet about an unremarkable food', () => {
    expect(qualityNote(WHITE_BREAD)).toBeUndefined();
  });
});

describe('dayProteinDensity', () => {
  it('expresses a whole day the same way', () => {
    expect(dayProteinDensity(2150, 160)).toBeCloseTo(7.44, 2);
    expect(dayProteinDensity(0, 160)).toBe(0);
  });
});
