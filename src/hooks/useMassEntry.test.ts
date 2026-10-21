import { describe, expect, it } from 'vitest';
import { fromFoodUnit, G_PER_OZ } from '@/core/measure';
import { massEntryText } from './useMassEntry';

describe('massEntryText (§22)', () => {
  it('opens a stored weight in whole grams, as the pad always has', () => {
    expect(massEntryText(152.4, 'metric')).toBe('152');
    expect(massEntryText(150, 'metric')).toBe('150');
  });

  it('opens it in ounces to a tenth, without a trailing ".0"', () => {
    expect(massEntryText(150, 'us')).toBe('5.3');
    expect(massEntryText(4 * G_PER_OZ, 'us')).toBe('4');
    expect(massEntryText(1000, 'us')).toBe('35.3');
  });

  it('opens on nothing for nothing', () => {
    expect(massEntryText(0, 'metric')).toBe('');
    expect(massEntryText(0, 'us')).toBe('');
    expect(massEntryText(-5, 'us')).toBe('');
  });

  it('reads back as the ounces it showed', () => {
    for (let tenths = 1; tenths <= 999; tenths++) {
      const oz = tenths / 10;
      expect(Number(massEntryText(fromFoodUnit(oz, 'us'), 'us'))).toBe(oz);
    }
  });
});
