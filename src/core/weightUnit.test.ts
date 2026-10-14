import { describe, expect, it } from 'vitest';
import {
  displayValue,
  formatWeight,
  fromDisplay,
  isPlausibleLoad,
  KG_PER_LB,
  roundForDisplay,
  snapToIncrement,
  toDisplay,
} from './weightUnit';

describe('conversion', () => {
  it('uses the defined pound, not an approximation', () => {
    expect(KG_PER_LB).toBe(0.45359237);
    expect(toDisplay(100, 'lb')).toBeCloseTo(220.46226, 4);
  });

  it('leaves kilograms alone', () => {
    expect(toDisplay(82.5, 'kg')).toBe(82.5);
    expect(fromDisplay(82.5, 'kg')).toBe(82.5);
  });

  it('round-trips without drift, so a year of history stays addable', () => {
    for (const lb of [45, 135, 185, 225, 315, 405]) {
      expect(toDisplay(fromDisplay(lb, 'lb'), 'lb')).toBeCloseTo(lb, 10);
    }
  });
});

describe('display', () => {
  it('shows one decimal at most, because a loaded bar has no more', () => {
    expect(roundForDisplay(82.4732)).toBe(82.5);
    expect(roundForDisplay(100)).toBe(100);
  });

  it('drops a trailing .0 as noise', () => {
    expect(formatWeight(100, 'kg')).toBe('100 kg');
    expect(formatWeight(82.5, 'kg')).toBe('82.5 kg');
    expect(displayValue(100, 'kg')).toBe('100');
    expect(displayValue(82.5, 'kg')).toBe('82.5');
  });

  it('prints pounds as a gym would', () => {
    expect(formatWeight(fromDisplay(185, 'lb'), 'lb')).toBe('185 lb');
    expect(formatWeight(fromDisplay(187.5, 'lb'), 'lb')).toBe('187.5 lb');
  });

  it('shows zero rather than an empty string', () => {
    expect(formatWeight(0, 'kg')).toBe('0 kg');
    expect(displayValue(0, 'lb')).toBe('0');
  });
});

describe('snapToIncrement', () => {
  it('snaps kilograms to a pair of 1.25s', () => {
    expect(snapToIncrement(82.3, 'kg')).toBeCloseTo(82.5, 6);
    expect(snapToIncrement(81.2, 'kg')).toBeCloseTo(80, 6);
    expect(snapToIncrement(100, 'kg')).toBeCloseTo(100, 6);
  });

  it('snaps pounds to a pair of 2.5s, in pounds', () => {
    const kg = snapToIncrement(fromDisplay(183, 'lb'), 'lb');
    expect(toDisplay(kg, 'lb')).toBeCloseTo(185, 6);
  });

  it('never returns a weight the unit could not load', () => {
    for (const kg of [37.4, 61.1, 99.9, 142.6]) {
      const snapped = toDisplay(snapToIncrement(kg, 'kg'), 'kg');
      expect(snapped % 2.5).toBeCloseTo(0, 6);
    }
  });

  it('leaves zero at zero', () => {
    expect(snapToIncrement(0, 'kg')).toBe(0);
  });
});

describe('isPlausibleLoad', () => {
  it('accepts what a human lifts, including an unloaded bar', () => {
    expect(isPlausibleLoad(0)).toBe(true);
    expect(isPlausibleLoad(20)).toBe(true);
    expect(isPlausibleLoad(500)).toBe(true);
  });

  it('rejects the impossible and the malformed', () => {
    expect(isPlausibleLoad(-5)).toBe(false);
    expect(isPlausibleLoad(1000)).toBe(false);
    expect(isPlausibleLoad(Number.NaN)).toBe(false);
    expect(isPlausibleLoad(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
