import { describe, expect, it } from 'vitest';
import {
  BODY_MAX_KG,
  BODY_MIN_KG,
  bodyUnit,
  bodyWeightValue,
  CM_PER_IN,
  cmToFeetInches,
  cookedWeightValue,
  decideGymChoice,
  decideUnitSystem,
  DEFAULT_GLASS_FL_OZ,
  defaultPackValue,
  entryText,
  feetInchesToCm,
  flOzToMl,
  foodMassUnit,
  foodValue,
  formatBodyGoal,
  formatBodyWeight,
  formatBulkMass,
  formatFoodMass,
  formatHeight,
  formatLength,
  formatRate,
  formatWaterAmount,
  formatWaterTotal,
  fromBodyUnit,
  fromFoodUnit,
  fromLengthUnit,
  G_PER_LB,
  G_PER_OZ,
  GLASS_CHOICES_FL_OZ,
  gymUnit,
  isGymUnitChoice,
  isPlausibleBodyWeight,
  isPlausibleHeight,
  isRateChoice,
  isUnitSystem,
  KG_PER_LB,
  lengthDecimals,
  lengthUnit,
  lengthValue,
  ML_PER_FL_OZ,
  mlToFlOz,
  packEntryGrams,
  parseDecimal,
  priceMassLabel,
  pricePerKgFrom,
  pricePerMassUnit,
  RATE_CHOICES,
  rateValue,
  signedBodyChange,
  signedLengthChange,
  toBodyUnit,
  toFoodUnit,
  toLengthUnit,
  WATER_ENTRY_MAX_ML,
  WATER_ENTRY_MIN_ML,
  WATER_PRESETS_FL_OZ,
  waterEntryMl,
  waterTotalValue,
  waterUnit,
  type UnitSystem,
} from './measure';

const BOTH: UnitSystem[] = ['metric', 'us'];

describe('the definitions', () => {
  it('are the exact legal ones, not rounded approximations', () => {
    expect(KG_PER_LB).toBe(0.45359237);
    expect(CM_PER_IN).toBe(2.54);
    // The avoirdupois ounce is a sixteenth of the pound: 28.349523125 g.
    expect(G_PER_OZ).toBeCloseTo(28.349523125, 12);
    expect(G_PER_LB).toBeCloseTo(453.59237, 10);
    // The US customary fluid ounce: 29.5735295625 ml.
    expect(ML_PER_FL_OZ).toBeCloseTo(29.5735295625, 10);
  });

  it('agree with each other', () => {
    expect(G_PER_OZ * 16).toBeCloseTo(G_PER_LB, 10);
    expect(ML_PER_FL_OZ * 128).toBeCloseTo(3785.411784, 6); // the US gallon
    expect(12 * CM_PER_IN).toBeCloseTo(30.48, 12); // the foot
  });
});

describe('isUnitSystem', () => {
  it('accepts the two systems and nothing else', () => {
    expect(isUnitSystem('metric')).toBe(true);
    expect(isUnitSystem('us')).toBe(true);
    for (const v of ['US', 'imperial', '', null, undefined, 1, {}, 'lb', 'kg']) {
      expect(isUnitSystem(v)).toBe(false);
    }
  });
});

describe('body weight', () => {
  it('names the unit', () => {
    expect(bodyUnit('metric')).toBe('kg');
    expect(bodyUnit('us')).toBe('lb');
  });

  it('leaves kilograms alone in metric', () => {
    for (const kg of [0, 20, 72.5, 81.6466266, 400]) {
      expect(toBodyUnit(kg, 'metric')).toBe(kg);
      expect(fromBodyUnit(kg, 'metric')).toBe(kg);
    }
  });

  it('converts by the defined pound', () => {
    expect(toBodyUnit(100, 'us')).toBeCloseTo(220.462262, 5);
    expect(fromBodyUnit(180, 'us')).toBeCloseTo(81.6466266, 7);
  });

  it('round-trips every whole and tenth pound a scale can show, 80–400 lb', () => {
    for (let tenths = 800; tenths <= 4000; tenths++) {
      const lb = tenths / 10;
      const kg = fromBodyUnit(lb, 'us');
      // What is stored reads back as exactly what was typed, at the precision shown.
      expect(bodyWeightValue(kg, 'us')).toBe(lb.toFixed(1));
      expect(entryText(toBodyUnit(kg, 'us'), 1)).toBe(String(lb));
    }
  });

  it('round-trips every tenth of a kilo, 20–400 kg', () => {
    for (let tenths = 200; tenths <= 4000; tenths++) {
      const kg = tenths / 10;
      expect(bodyWeightValue(kg, 'metric')).toBe(kg.toFixed(1));
    }
  });

  it('shows 180 lb as 180, not 179.9 — the case the unrounded store exists for', () => {
    const stored = fromBodyUnit(180, 'us');
    expect(formatBodyWeight(stored, 'us')).toBe('180.0 lb');
    expect(entryText(toBodyUnit(stored, 'us'), 1)).toBe('180');
    // Had storage rounded to a tenth of a kilo, this is what would have come back:
    expect(formatBodyWeight(Math.round(stored * 10) / 10, 'us')).toBe('179.9 lb');
  });

  it('prints with a decimal point whatever the locale, as body weights always have', () => {
    expect(bodyWeightValue(81.6, 'metric')).toBe('81.6');
    expect(formatBodyWeight(81.6, 'metric')).toBe('81.6 kg');
    expect(formatBodyWeight(81.6, 'us')).toBe('179.9 lb');
    expect(bodyWeightValue(81.6, 'metric', 2)).toBe('81.60');
  });

  it('shows a goal as it was typed, without a forced ".0"', () => {
    expect(formatBodyGoal(68, 'metric')).toBe('68 kg');
    expect(formatBodyGoal(68.5, 'metric')).toBe('68.5 kg');
    expect(formatBodyGoal(fromBodyUnit(150, 'us'), 'us')).toBe('150 lb');
    expect(formatBodyGoal(fromBodyUnit(150.5, 'us'), 'us')).toBe('150.5 lb');
    expect(formatBodyGoal(68, 'us')).toBe('149.9 lb');
  });

  it('signs a change, with no sign on nothing and no "-0.0"', () => {
    expect(signedBodyChange(0.25, 'metric', 2)).toBe('+0.25');
    expect(signedBodyChange(-1.1, 'metric')).toBe('-1.1');
    expect(signedBodyChange(0, 'metric')).toBe('0.0');
    expect(signedBodyChange(-0.04, 'metric')).toBe('0.0');
    expect(signedBodyChange(0.04, 'metric')).toBe('0.0');
    expect(signedBodyChange(-0.5, 'us')).toBe('-1.1');
    expect(signedBodyChange(fromBodyUnit(2, 'us'), 'us')).toBe('+2.0');
  });

  it('bounds a plausible body weight the same in either unit', () => {
    expect(isPlausibleBodyWeight(BODY_MIN_KG)).toBe(true);
    expect(isPlausibleBodyWeight(BODY_MAX_KG)).toBe(true);
    expect(isPlausibleBodyWeight(19.99)).toBe(false);
    expect(isPlausibleBodyWeight(400.01)).toBe(false);
    expect(isPlausibleBodyWeight(fromBodyUnit(44, 'us'))).toBe(false); // 19.96 kg
    expect(isPlausibleBodyWeight(fromBodyUnit(45, 'us'))).toBe(true);
    expect(isPlausibleBodyWeight(fromBodyUnit(881, 'us'))).toBe(true);
    expect(isPlausibleBodyWeight(fromBodyUnit(882, 'us'))).toBe(false);
    for (const v of [NaN, Infinity, -Infinity, -1, 0]) expect(isPlausibleBodyWeight(v)).toBe(false);
  });
});

describe('lengths', () => {
  it('names the unit and the decimals a tape is good for', () => {
    expect(lengthUnit('metric')).toBe('cm');
    expect(lengthUnit('us')).toBe('in');
    expect(lengthDecimals('metric')).toBe(0);
    expect(lengthDecimals('us')).toBe(1);
  });

  it('converts by the inch', () => {
    expect(toLengthUnit(254, 'us')).toBeCloseTo(100, 12);
    expect(fromLengthUnit(34, 'us')).toBeCloseTo(86.36, 12);
    expect(toLengthUnit(84, 'metric')).toBe(84);
  });

  it('round-trips every tenth of an inch on a waist tape, 16–98 in', () => {
    for (let tenths = 160; tenths <= 980; tenths++) {
      const inch = tenths / 10;
      const cm = fromLengthUnit(inch, 'us');
      expect(lengthValue(cm, 'us')).toBe(inch.toFixed(1));
    }
  });

  it('never prints more than the reading supports', () => {
    expect(formatLength(84.4, 'metric')).toBe('84 cm');
    expect(formatLength(84, 'us')).toBe('33.1 in');
    expect(formatLength(fromLengthUnit(33.25, 'us'), 'us')).toMatch(/^33\.[23] in$/);
  });

  it('signs a change', () => {
    expect(signedLengthChange(-2, 'metric')).toBe('-2');
    expect(signedLengthChange(2.54, 'us')).toBe('+1.0');
    expect(signedLengthChange(0.1, 'metric')).toBe('0');
  });
});

describe('height', () => {
  it('turns centimetres into whole feet and inches, carrying a 12th inch', () => {
    expect(cmToFeetInches(177.8)).toEqual({ feet: 5, inches: 10 });
    expect(cmToFeetInches(178)).toEqual({ feet: 5, inches: 10 });
    expect(cmToFeetInches(182.6)).toEqual({ feet: 6, inches: 0 }); // 71.9 in
    expect(cmToFeetInches(152.4)).toEqual({ feet: 5, inches: 0 });
  });

  it('round-trips every height from 4 ft 10 in to 7 ft 0 in', () => {
    for (let total = 58; total <= 84; total++) {
      const feet = Math.floor(total / 12);
      const inches = total % 12;
      const cm = feetInchesToCm(feet, inches);
      expect(cmToFeetInches(cm)).toEqual({ feet, inches });
      expect(formatHeight(cm, 'us')).toBe(`${feet} ft ${inches} in`);
      expect(isPlausibleHeight(cm)).toBe(true);
    }
  });

  it('accepts inches past 11 and fractions of one, as typed', () => {
    expect(feetInchesToCm(0, 70)).toBeCloseTo(177.8, 10);
    expect(feetInchesToCm(5, 9.5)).toBeCloseTo(176.53, 10);
  });

  it('prints centimetres as they were stored', () => {
    expect(formatHeight(178, 'metric')).toBe('178 cm');
    expect(formatHeight(178.5, 'metric')).toBe('178.5 cm');
  });

  it('bounds a plausible height the same in either unit', () => {
    expect(isPlausibleHeight(100)).toBe(true);
    expect(isPlausibleHeight(250)).toBe(true);
    expect(isPlausibleHeight(99.9)).toBe(false);
    expect(isPlausibleHeight(feetInchesToCm(8, 3))).toBe(false); // 251.5 cm
    expect(isPlausibleHeight(NaN)).toBe(false);
  });
});

describe('water', () => {
  it('names the unit', () => {
    expect(waterUnit('metric')).toBe('L');
    expect(waterUnit('us')).toBe('fl oz');
  });

  it('stores fluid ounces as whole millilitres that read back as the same ounces, 1–64', () => {
    for (let oz = 1; oz <= 64; oz++) {
      const ml = flOzToMl(oz);
      expect(Number.isInteger(ml)).toBe(true);
      expect(Math.abs(ml - oz * ML_PER_FL_OZ)).toBeLessThanOrEqual(0.5);
      expect(formatWaterAmount(ml, 'us')).toBe(`${oz} fl oz`);
      expect(Math.round(mlToFlOz(ml))).toBe(oz);
    }
  });

  it('keeps a sum of glasses honest: eight 8 oz cups are 64 fl oz, not 63', () => {
    const ml = 8 * flOzToMl(8);
    expect(formatWaterTotal(ml, 'us')).toBe('64 fl oz');
  });

  it('formats metric exactly as before: ml under a litre, litres to a tenth from there', () => {
    expect(formatWaterAmount(250, 'metric')).toBe('250 ml');
    expect(formatWaterAmount(999, 'metric')).toBe('999 ml');
    expect(formatWaterAmount(1000, 'metric')).toBe('1.0 L');
    expect(formatWaterAmount(1540, 'metric')).toBe('1.5 L');
    expect(waterTotalValue(2500, 'metric')).toBe('2.5');
    expect(formatWaterTotal(2500, 'metric')).toBe('2.5 L');
  });

  it('formats US totals in whole fluid ounces', () => {
    expect(waterTotalValue(2500, 'us')).toBe('85');
    expect(formatWaterTotal(0, 'us')).toBe('0 fl oz');
  });

  it('reads a typed custom amount in the units shown', () => {
    expect(waterEntryMl(250, 'metric')).toBe(250);
    expect(waterEntryMl(12, 'us')).toBe(355);
    expect(waterEntryMl(1, 'us')).toBeGreaterThanOrEqual(WATER_ENTRY_MIN_ML);
    expect(waterEntryMl(101, 'us')).toBeLessThanOrEqual(WATER_ENTRY_MAX_ML);
    expect(waterEntryMl(102, 'us')).toBeGreaterThan(WATER_ENTRY_MAX_ML);
  });

  it('offers US presets as the cup sizes they are sold in', () => {
    expect(WATER_PRESETS_FL_OZ).toEqual([8, 12, 16, 20, 24]);
    expect(GLASS_CHOICES_FL_OZ).toContain(DEFAULT_GLASS_FL_OZ);
    expect(flOzToMl(DEFAULT_GLASS_FL_OZ)).toBe(237);
  });
});

describe('food amounts', () => {
  it('names the unit', () => {
    expect(foodMassUnit('metric')).toBe('g');
    expect(foodMassUnit('us')).toBe('oz');
  });

  it('converts by the avoirdupois ounce', () => {
    expect(toFoodUnit(G_PER_OZ, 'us')).toBeCloseTo(1, 12);
    expect(fromFoodUnit(4, 'us')).toBeCloseTo(113.398, 3);
    expect(toFoodUnit(150, 'metric')).toBe(150);
  });

  it('formats grams exactly as before', () => {
    expect(formatFoodMass(150, 'metric')).toBe('150 g');
    expect(formatFoodMass(152.4, 'metric')).toBe('152 g');
    expect(foodValue(0, 'metric')).toBe('0');
  });

  it('formats ounces to a tenth below 100, dropping a ".0"', () => {
    expect(formatFoodMass(150, 'us')).toBe('5.3 oz');
    expect(formatFoodMass(G_PER_OZ, 'us')).toBe('1 oz');
    expect(formatFoodMass(4 * G_PER_OZ, 'us')).toBe('4 oz');
    expect(formatFoodMass(10, 'us')).toBe('0.4 oz');
    expect(formatFoodMass(99.9 * G_PER_OZ, 'us')).toBe('99.9 oz');
    expect(formatFoodMass(150 * G_PER_OZ, 'us')).toBe('150 oz');
  });

  it('round-trips every tenth of an ounce from 0.1 to 99.9', () => {
    for (let tenths = 1; tenths < 1000; tenths++) {
      const oz = tenths / 10;
      expect(foodValue(fromFoodUnit(oz, 'us'), 'us')).toBe(
        Number.isInteger(oz) ? String(oz) : oz.toFixed(1),
      );
    }
  });

  it('formats a shopping quantity in the units it is sold in', () => {
    expect(formatBulkMass(450, 'metric')).toBe('450 g');
    expect(formatBulkMass(1250, 'metric')).toBe('1.25 kg');
    expect(formatBulkMass(340, 'us')).toBe('12 oz');
    expect(formatBulkMass(G_PER_LB, 'us')).toBe('1 lb');
    expect(formatBulkMass(1100, 'us')).toBe('2.4 lb');
    expect(formatBulkMass(G_PER_LB - 1, 'us')).toBe('16 oz');
  });

  it('prices per kilo or per pound, and stores per kilo', () => {
    expect(priceMassLabel('metric')).toBe('kg');
    expect(priceMassLabel('us')).toBe('lb');
    expect(pricePerMassUnit(11, 'metric')).toBe(11);
    expect(pricePerMassUnit(11, 'us')).toBeCloseTo(4.9895, 4);
    expect(pricePerKgFrom(4.99, 'us')).toBeCloseTo(11.0011, 4);
  });

  it('round-trips every per-pound price to the cent through a per-kilo store kept to the cent', () => {
    for (let cents = 1; cents <= 3000; cents++) {
      const perLb = cents / 100;
      const stored = Math.round(pricePerKgFrom(perLb, 'us') * 100) / 100;
      expect(pricePerMassUnit(stored, 'us').toFixed(2)).toBe(perLb.toFixed(2));
    }
  });

  it('reads a pack weight in the units typed', () => {
    expect(packEntryGrams(500, 'metric')).toBe(500);
    expect(packEntryGrams(16, 'us')).toBeCloseTo(G_PER_LB, 9);
    expect(defaultPackValue('metric')).toBe('500');
    expect(defaultPackValue('us')).toBe('16');
  });

  it('gives a week of cooking in whole kilos or whole pounds', () => {
    expect(cookedWeightValue(4200, 'metric')).toEqual({ value: '4', unit: 'kg' });
    expect(cookedWeightValue(4200, 'us')).toEqual({ value: '9', unit: 'lb' });
  });
});

describe('goal rate', () => {
  it('offers chips in the units shown, whole and half pounds in US', () => {
    expect(RATE_CHOICES.metric.cut).toEqual([0.25, 0.5, 0.75, 1]);
    expect(RATE_CHOICES.us.cut).toEqual([0.5, 1, 1.5, 2]);
    expect(RATE_CHOICES.us.bulk).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it('recognises a stored rate as its chip, in either unit', () => {
    for (const s of BOTH) {
      for (const r of [...RATE_CHOICES[s].cut, ...RATE_CHOICES[s].bulk]) {
        expect(isRateChoice(fromBodyUnit(r, s), r, s)).toBe(true);
      }
    }
    // Half a kilo a week is not any of the pound chips.
    expect(RATE_CHOICES.us.cut.some((r) => isRateChoice(0.5, r, 'us'))).toBe(false);
  });

  it('prints a rate as the chip said it', () => {
    expect(formatRate(0.5, 'metric')).toBe('0.5 kg a week');
    expect(formatRate(0.125, 'metric')).toBe('0.125 kg a week');
    expect(formatRate(fromBodyUnit(1, 'us'), 'us')).toBe('1 lb a week');
    expect(formatRate(fromBodyUnit(0.25, 'us'), 'us')).toBe('0.25 lb a week');
    expect(formatRate(0.5, 'us')).toBe('1.1 lb a week');
    expect(rateValue(0, 'us')).toBe('0');
  });
});

describe('entry', () => {
  it('parses what a pad or a field can produce', () => {
    expect(parseDecimal('180')).toBe(180);
    expect(parseDecimal('72.5')).toBe(72.5);
    expect(parseDecimal('72,5')).toBe(72.5);
    expect(parseDecimal(' 5 ')).toBe(5);
    expect(parseDecimal('.5')).toBe(0.5);
    for (const t of ['', ' ', '.', 'abc', '1.2.3']) expect(parseDecimal(t)).toBeUndefined();
  });

  it('opens a stored value without trailing zeros or a minus zero', () => {
    expect(entryText(180.00001, 1)).toBe('180');
    expect(entryText(179.94, 1)).toBe('179.9');
    expect(entryText(-0.01, 1)).toBe('0');
  });
});

describe('choosing the system', () => {
  it('keeps a stored choice whatever the market', () => {
    expect(decideUnitSystem('metric', 'US')).toBe('metric');
    expect(decideUnitSystem('us', 'IT')).toBe('us');
  });

  it('guesses US only for the US market', () => {
    expect(decideUnitSystem(undefined, 'US')).toBe('us');
    for (const m of ['IT', 'OM', 'AE', 'SA', undefined]) {
      expect(decideUnitSystem(undefined, m)).toBe('metric');
    }
  });

  it('ignores a malformed stored value', () => {
    expect(decideUnitSystem('imperial', 'IT')).toBe('metric');
    expect(decideUnitSystem(42, 'US')).toBe('us');
  });
});

describe('the gym override', () => {
  it('follows the app unless told otherwise', () => {
    expect(gymUnit('metric', 'follow')).toBe('kg');
    expect(gymUnit('us', 'follow')).toBe('lb');
    expect(gymUnit('metric', 'lb')).toBe('lb');
    expect(gymUnit('us', 'kg')).toBe('kg');
  });

  it('keeps an old "pounds at the gym" choice, and lets an old "kg" follow', () => {
    expect(decideGymChoice(undefined, 'lb')).toBe('lb');
    expect(decideGymChoice(undefined, 'kg')).toBe('follow');
    expect(decideGymChoice(undefined, undefined)).toBe('follow');
    expect(decideGymChoice('follow', 'lb')).toBe('follow');
    expect(decideGymChoice('kg', 'lb')).toBe('kg');
    expect(decideGymChoice('stones', 'lb')).toBe('lb');
  });

  it('recognises its own choices only', () => {
    for (const v of ['follow', 'kg', 'lb']) expect(isGymUnitChoice(v)).toBe(true);
    for (const v of ['metric', 'us', '', undefined, null]) expect(isGymUnitChoice(v)).toBe(false);
  });
});
