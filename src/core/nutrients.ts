import type { MicroKey, Micros, Per100g } from './types';

export interface NutrientDef {
  label: string;
  unit: 'mg' | 'µg' | 'g' | 'kcal';
  /** USDA FoodData Central nutrient ids, in order of preference. */
  fdc: number[];
  /** Adult (19–30) DRI, used by the v2 micronutrient panel. */
  rda?: { male: number; female: number };
}

export const MACRO_DEFS: Record<keyof Per100g, NutrientDef> = {
  kcal: { label: 'Energy', unit: 'kcal', fdc: [1008, 2048, 2047] },
  protein: { label: 'Protein', unit: 'g', fdc: [1003] },
  carb: { label: 'Carbohydrate', unit: 'g', fdc: [1005, 1050] },
  fat: { label: 'Fat', unit: 'g', fdc: [1004] },
  fiber: { label: 'Fiber', unit: 'g', fdc: [1079] },
  sugar: { label: 'Sugars', unit: 'g', fdc: [2000, 1063] },
  sodium: { label: 'Sodium', unit: 'mg', fdc: [1093] },
  sat_fat: { label: 'Saturated fat', unit: 'g', fdc: [1258] },
};

export const MICRO_DEFS: Record<MicroKey, NutrientDef> = {
  vit_a: { label: 'Vitamin A', unit: 'µg', fdc: [1106], rda: { male: 900, female: 700 } },
  vit_c: { label: 'Vitamin C', unit: 'mg', fdc: [1162], rda: { male: 90, female: 75 } },
  vit_d: { label: 'Vitamin D', unit: 'µg', fdc: [1114], rda: { male: 15, female: 15 } },
  vit_e: { label: 'Vitamin E', unit: 'mg', fdc: [1109], rda: { male: 15, female: 15 } },
  vit_k: { label: 'Vitamin K', unit: 'µg', fdc: [1185], rda: { male: 120, female: 90 } },
  b1: { label: 'Thiamin (B1)', unit: 'mg', fdc: [1165], rda: { male: 1.2, female: 1.1 } },
  b2: { label: 'Riboflavin (B2)', unit: 'mg', fdc: [1166], rda: { male: 1.3, female: 1.1 } },
  b3: { label: 'Niacin (B3)', unit: 'mg', fdc: [1167], rda: { male: 16, female: 14 } },
  b5: { label: 'Pantothenic acid (B5)', unit: 'mg', fdc: [1170], rda: { male: 5, female: 5 } },
  b6: { label: 'Vitamin B6', unit: 'mg', fdc: [1175], rda: { male: 1.3, female: 1.3 } },
  folate: { label: 'Folate', unit: 'µg', fdc: [1177, 1190], rda: { male: 400, female: 400 } },
  b12: { label: 'Vitamin B12', unit: 'µg', fdc: [1178], rda: { male: 2.4, female: 2.4 } },
  choline: { label: 'Choline', unit: 'mg', fdc: [1180], rda: { male: 550, female: 425 } },
  calcium: { label: 'Calcium', unit: 'mg', fdc: [1087], rda: { male: 1000, female: 1000 } },
  iron: { label: 'Iron', unit: 'mg', fdc: [1089], rda: { male: 8, female: 18 } },
  magnesium: { label: 'Magnesium', unit: 'mg', fdc: [1090], rda: { male: 400, female: 310 } },
  phosphorus: { label: 'Phosphorus', unit: 'mg', fdc: [1091], rda: { male: 700, female: 700 } },
  potassium: { label: 'Potassium', unit: 'mg', fdc: [1092], rda: { male: 3400, female: 2600 } },
  zinc: { label: 'Zinc', unit: 'mg', fdc: [1095], rda: { male: 11, female: 8 } },
  copper: { label: 'Copper', unit: 'mg', fdc: [1098], rda: { male: 0.9, female: 0.9 } },
  manganese: { label: 'Manganese', unit: 'mg', fdc: [1101], rda: { male: 2.3, female: 1.8 } },
  selenium: { label: 'Selenium', unit: 'µg', fdc: [1103], rda: { male: 55, female: 55 } },
};

export const MICRO_KEYS = Object.keys(MICRO_DEFS) as MicroKey[];

/** Fraction (0–1) of tracked micronutrients present on a food. */
export function microCoverageOf(micros: Micros): number {
  let n = 0;
  for (const k of MICRO_KEYS) if (typeof micros[k] === 'number') n++;
  return n / MICRO_KEYS.length;
}
