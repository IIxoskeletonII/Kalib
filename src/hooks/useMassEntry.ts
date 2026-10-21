// SPEC §22 — a food weight typed on the pad, in grams or ounces, handed back in grams.
//
// The recipe, cooking and estimate sheets each had the same pad: open on a stored weight, let
// the first key replace it, save grams. This is that pad's state once, with the units in it.
import { useState } from 'react';
import {
  foodMassUnit,
  fromFoodUnit,
  parseDecimal,
  toFoodUnit,
  type UnitSystem,
} from '@/core/measure';

/** How a stored weight opens on the pad: whole grams, or ounces to a tenth. */
export function massEntryText(grams: number, units: UnitSystem): string {
  if (grams <= 0) return '';
  if (units === 'metric') return String(Math.round(grams));
  return String(Math.round(toFoodUnit(grams, units) * 10) / 10);
}

export interface MassEntry {
  /** The text on the pad, in the units shown. */
  value: string;
  /** What it means, in grams. */
  grams: number;
  unit: 'g' | 'oz';
  /** Ounces need a decimal key; grams never did. */
  decimal: boolean;
  type: (u: (prev: string) => string) => void;
}

export function useMassEntry(initialGrams: number, units: UnitSystem): MassEntry {
  const [value, setValue] = useState(() => massEntryText(initialGrams, units));
  const [pristine, setPristine] = useState(initialGrams > 0);
  // The units may land after the pad opened; what is on it is re-said, not reinterpreted.
  const [shownIn, setShownIn] = useState(units);
  if (shownIn !== units) {
    setShownIn(units);
    const g = fromFoodUnit(parseDecimal(value) ?? 0, shownIn);
    setValue(pristine ? massEntryText(initialGrams, units) : massEntryText(g, units));
  }

  // An untouched pad in ounces saves the grams it opened on, not their rounded conversion. In
  // grams the pad always meant what it showed, rounding included, and still does.
  const grams =
    units === 'us' && pristine && initialGrams > 0
      ? initialGrams
      : fromFoodUnit(parseDecimal(value) ?? 0, units);

  return {
    value,
    grams,
    unit: foodMassUnit(units),
    decimal: units === 'us',
    type: (u) => {
      setValue((prev) => u(pristine ? '' : prev));
      setPristine(false);
    },
  };
}
