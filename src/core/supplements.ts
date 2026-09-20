// SPEC §17.3 — supplement catalogue with personalised dose guidance. Pure: takes a person,
// returns a dose with its basis so the UI can say *why* (weight, sex and age band, or fixed).
//
// References (adult values): NIH Office of Dietary Supplements fact sheets for RDA / AI and
// tolerable upper intake levels; EFSA opinions for caffeine (2015) and EPA+DHA (2012); ISSN
// position stand on creatine (Kreider et al. 2017). General guidance, not medical advice.
import type { MicroKey, Sex, SupplementTiming, SupplementUnit } from './types';

export interface Person {
  sex: Sex;
  age: number;
  weight_kg?: number | undefined;
  height_cm?: number | undefined;
}

/** What the recommendation actually depends on, so the UI can be honest about it. */
export type DoseFactor = 'weight' | 'sex_age' | 'age' | 'fixed';

export interface DoseGuide {
  dose: number;
  unit: SupplementUnit;
  /** Sensible range for a healthy adult. */
  low: number;
  high: number;
  /** Tolerable upper intake level from supplements, when one is set. */
  upper?: number | undefined;
  /** One line: the figure it comes from and its source. */
  basis: string;
  factor: DoseFactor;
}

export interface CatalogueItem {
  id: string;
  name: string;
  /** What it is for, in a few words — the picker's subtitle. */
  tagline: string;
  unit: SupplementUnit;
  timing: SupplementTiming;
  /** Practical line: label reading, timing, absorption. */
  tip: string;
  /** Micronutrient it supplies, for the coach (§16). */
  nutrient?: MicroKey;
  /** Nutrient amount per 1 unit of dose, in MICRO_DEFS units (e.g. IU → µg for vitamin D). */
  nutrientPerUnit?: number;
  recommend(p: Person): DoseGuide;
}

function roundTo(x: number, step: number): number {
  return Math.round(x / step) * step;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function sexWord(sex: Sex): string {
  return sex === 'male' ? 'men' : 'women';
}

/** "19–30" / "31–50" / "51–70" / "71+" — the DRI age bands. */
function ageBand(age: number): string {
  if (age < 19) return 'adult reference';
  if (age <= 30) return '19–30';
  if (age <= 50) return '31–50';
  if (age <= 70) return '51–70';
  return '71+';
}

export const SUPPLEMENT_CATALOGUE: readonly CatalogueItem[] = [
  {
    id: 'creatine',
    name: 'Creatine monohydrate',
    tagline: 'Strength and training volume',
    unit: 'g',
    timing: 'any',
    tip: 'No loading phase needed. Any time of day, every day — consistency matters more than timing. A meal or shake helps it sit well.',
    recommend(p) {
      if (p.weight_kg == null) {
        return {
          dose: 5,
          unit: 'g',
          low: 3,
          high: 5,
          basis: '3–5 g/day maintenance (ISSN); add your weight for a per-kg figure',
          factor: 'weight',
        };
      }
      const dose = clamp(roundTo(0.045 * p.weight_kg, 0.5), 3, 5);
      return {
        dose,
        unit: 'g',
        low: 3,
        high: 5,
        basis: `0.03–0.05 g/kg at ${Math.round(p.weight_kg)} kg, within the 3–5 g/day maintenance range (ISSN)`,
        factor: 'weight',
      };
    },
  },
  {
    id: 'vitamin_d3',
    name: 'Vitamin D3',
    tagline: 'Bone, immune function, low winter sun',
    unit: 'IU',
    timing: 'with_food',
    tip: 'Fat-soluble — take with a meal that has some fat. 1,000–2,000 IU is the usual maintenance range; 40 IU = 1 µg.',
    nutrient: 'vit_d',
    nutrientPerUnit: 0.025,
    recommend(p) {
      const rda = p.age > 70 ? 800 : 600;
      return {
        dose: 1000,
        unit: 'IU',
        low: rda,
        high: 2000,
        upper: 4000,
        basis: `RDA ${rda} IU at ${ageBand(p.age)}; upper limit 4,000 IU/day (NIH)`,
        factor: 'age',
      };
    },
  },
  {
    id: 'magnesium',
    name: 'Magnesium',
    tagline: 'Muscle function, sleep, regularity',
    unit: 'mg',
    timing: 'evening',
    tip: 'Log the elemental amount on the label, not the compound weight. Glycinate or citrate absorb well; oxide much less. Evening suits most people.',
    nutrient: 'magnesium',
    nutrientPerUnit: 1,
    recommend(p) {
      const rda = p.sex === 'male' ? (p.age <= 30 ? 400 : 420) : p.age <= 30 ? 310 : 320;
      return {
        dose: 300,
        unit: 'mg',
        low: 200,
        high: 350,
        upper: 350,
        basis: `RDA ${rda} mg for ${sexWord(p.sex)} ${ageBand(p.age)}, most of it from food; supplement cap 350 mg (NIH)`,
        factor: 'sex_age',
      };
    },
  },
  {
    id: 'omega3',
    name: 'Omega-3 (EPA + DHA)',
    tagline: 'Heart and joint support',
    unit: 'mg',
    timing: 'with_food',
    tip: 'The dose is EPA + DHA combined, not the fish-oil weight — a 1,000 mg capsule is often only ~300 mg. With a meal.',
    recommend() {
      return {
        dose: 500,
        unit: 'mg',
        low: 250,
        high: 1000,
        upper: 5000,
        basis: '250–500 mg EPA+DHA/day; up to 5 g/day is considered safe (EFSA)',
        factor: 'fixed',
      };
    },
  },
  {
    id: 'zinc',
    name: 'Zinc',
    tagline: 'Immune function, recovery',
    unit: 'mg',
    timing: 'with_food',
    tip: 'Elemental zinc. With food if it upsets your stomach; keep it apart from iron and calcium doses. Long-term high zinc depletes copper.',
    nutrient: 'zinc',
    nutrientPerUnit: 1,
    recommend(p) {
      const rda = p.sex === 'male' ? 11 : 8;
      return {
        dose: rda,
        unit: 'mg',
        low: rda,
        high: 25,
        upper: 40,
        basis: `RDA ${rda} mg for ${sexWord(p.sex)}; upper limit 40 mg/day (NIH)`,
        factor: 'sex_age',
      };
    },
  },
  {
    id: 'vitamin_c',
    name: 'Vitamin C',
    tagline: 'Antioxidant, iron absorption',
    unit: 'mg',
    timing: 'any',
    tip: 'Absorption falls off above ~200 mg per dose, so split larger amounts. Helps iron absorb when taken together.',
    nutrient: 'vit_c',
    nutrientPerUnit: 1,
    recommend(p) {
      const rda = p.sex === 'male' ? 90 : 75;
      return {
        dose: 200,
        unit: 'mg',
        low: rda,
        high: 500,
        upper: 2000,
        basis: `RDA ${rda} mg for ${sexWord(p.sex)}; upper limit 2,000 mg/day (NIH)`,
        factor: 'sex_age',
      };
    },
  },
  {
    id: 'b12',
    name: 'Vitamin B12',
    tagline: 'Energy metabolism, plant-based diets',
    unit: 'µg',
    timing: 'morning',
    tip: 'Mainly worth it on a plant-based diet or with a low B12 on a blood test. Large doses are normal because only ~1–2% of them is absorbed.',
    nutrient: 'b12',
    nutrientPerUnit: 1,
    recommend() {
      return {
        dose: 500,
        unit: 'µg',
        low: 2.4,
        high: 1000,
        basis:
          'RDA 2.4 µg; supplements run 250–1,000 µg to cover passive absorption; no upper limit set (NIH)',
        factor: 'fixed',
      };
    },
  },
  {
    id: 'iron',
    name: 'Iron',
    tagline: 'Only with a confirmed low ferritin',
    unit: 'mg',
    timing: 'morning',
    tip: 'Test ferritin first — iron is the one supplement that harms when it is not needed. Elemental iron, away from calcium, coffee and tea; vitamin C helps.',
    nutrient: 'iron',
    nutrientPerUnit: 1,
    recommend(p) {
      const rda = p.sex === 'female' && p.age <= 50 ? 18 : 8;
      return {
        dose: rda,
        unit: 'mg',
        low: rda,
        high: 45,
        upper: 45,
        basis: `RDA ${rda} mg for ${sexWord(p.sex)} ${ageBand(p.age)}; upper limit 45 mg/day (NIH). Test ferritin first.`,
        factor: 'sex_age',
      };
    },
  },
  {
    id: 'calcium',
    name: 'Calcium',
    tagline: 'Bone; only the shortfall from food',
    unit: 'mg',
    timing: 'with_food',
    tip: 'Most people reach it from dairy and greens; supplement only the shortfall. 500 mg or less per dose absorbs best, with a meal, apart from iron and zinc.',
    nutrient: 'calcium',
    nutrientPerUnit: 1,
    recommend(p) {
      const rda =
        (p.sex === 'female' && p.age > 50) || (p.sex === 'male' && p.age > 70) ? 1200 : 1000;
      const upper = p.age > 50 ? 2000 : 2500;
      return {
        dose: 500,
        unit: 'mg',
        low: 500,
        high: 1000,
        upper,
        basis: `RDA ${rda.toLocaleString()} mg for ${sexWord(p.sex)} ${ageBand(p.age)}, mostly from food; upper limit ${upper.toLocaleString()} mg/day (NIH)`,
        factor: 'sex_age',
      };
    },
  },
  {
    id: 'folate',
    name: 'Folate',
    tagline: 'Cell division; before and during pregnancy',
    unit: 'µg',
    timing: 'any',
    tip: 'Folic acid or methylfolate. The 400 µg figure is the one recommended before and during pregnancy.',
    nutrient: 'folate',
    nutrientPerUnit: 1,
    recommend() {
      return {
        dose: 400,
        unit: 'µg',
        low: 400,
        high: 800,
        upper: 1000,
        basis: 'RDA 400 µg; upper limit 1,000 µg/day from fortified food and supplements (NIH)',
        factor: 'fixed',
      };
    },
  },
  {
    id: 'vitamin_k2',
    name: 'Vitamin K2 (MK-7)',
    tagline: 'Often paired with vitamin D',
    unit: 'µg',
    timing: 'with_food',
    tip: 'Fat-soluble, with a meal. Not with warfarin or similar anticoagulants without a doctor.',
    nutrient: 'vit_k',
    nutrientPerUnit: 1,
    recommend(p) {
      const ai = p.sex === 'male' ? 120 : 90;
      return {
        dose: 100,
        unit: 'µg',
        low: 90,
        high: 200,
        basis: `MK-7 supplements run 90–200 µg; adequate intake for all vitamin K is ${ai} µg for ${sexWord(p.sex)}, mostly K1 from food; no upper limit set (NIH)`,
        factor: 'sex_age',
      };
    },
  },
  {
    id: 'multivitamin',
    name: 'Multivitamin',
    tagline: 'Broad cover on thin days',
    unit: 'capsule',
    timing: 'morning',
    tip: 'With breakfast. Check it is not stacking iron or zinc on top of separate supplements.',
    recommend() {
      return {
        dose: 1,
        unit: 'capsule',
        low: 1,
        high: 1,
        basis: 'One serving as labelled',
        factor: 'fixed',
      };
    },
  },
  {
    id: 'caffeine',
    name: 'Caffeine (pre-workout)',
    tagline: 'Training performance',
    unit: 'mg',
    timing: 'any',
    tip: '30–60 minutes before training; not within about 8 hours of bed. A coffee is ~80–100 mg.',
    recommend(p) {
      if (p.weight_kg == null) {
        return {
          dose: 200,
          unit: 'mg',
          low: 100,
          high: 200,
          upper: 400,
          basis:
            '200 mg per dose and 400 mg/day are the safe limits (EFSA); add your weight for a per-kg figure',
          factor: 'weight',
        };
      }
      const low = roundTo(3 * p.weight_kg, 10);
      const dose = Math.min(200, low);
      return {
        dose,
        unit: 'mg',
        low: Math.min(low, 200),
        high: Math.min(roundTo(6 * p.weight_kg, 10), 200),
        upper: 400,
        basis: `3–6 mg/kg at ${Math.round(p.weight_kg)} kg, capped at the 200 mg single-dose and 400 mg/day safe limits (EFSA)`,
        factor: 'weight',
      };
    },
  },
  {
    id: 'psyllium',
    name: 'Psyllium husk',
    tagline: 'Fiber top-up; regularity',
    unit: 'g',
    timing: 'any',
    tip: 'Stir into 250 ml of water and drink straight away, then more water. ~4 g of fiber per 5 g. Start low and build up over a week.',
    recommend() {
      return {
        dose: 5,
        unit: 'g',
        low: 5,
        high: 10,
        basis: '5 g per dose, up to twice a day, always with plenty of water',
        factor: 'fixed',
      };
    },
  },
];

export function catalogueItem(id: string | undefined): CatalogueItem | undefined {
  return id ? SUPPLEMENT_CATALOGUE.find((c) => c.id === id) : undefined;
}

/** "5 g", "1,000 IU", "300 mg", "2 capsules". */
export function formatDose(dose: number, unit: SupplementUnit): string {
  const n = dose.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (unit === 'capsule') return `${n} ${dose === 1 ? 'capsule' : 'capsules'}`;
  return `${n} ${unit}`;
}

export const TIMING_LABEL: Record<SupplementTiming, string> = {
  morning: 'Morning',
  with_food: 'With food',
  evening: 'Evening',
  any: 'Any time',
};

export const UNIT_OPTIONS: readonly SupplementUnit[] = ['g', 'mg', 'µg', 'IU', 'capsule', 'ml'];

/** Plain-language reason the dose is what it is, for the editor's helper line. */
export function factorNote(factor: DoseFactor): string {
  switch (factor) {
    case 'weight':
      return 'Scales with body weight.';
    case 'sex_age':
      return 'Set by sex and age band; weight and height are not factors in the reference.';
    case 'age':
      return 'Set by age band; sex, weight and height are not factors in the reference.';
    case 'fixed':
      return 'Same for every adult; not personalised in the reference.';
  }
}

/** Above the upper limit, or far outside the usual range — a gentle flag, not a block. */
export function doseWarning(dose: number, guide: DoseGuide): string | undefined {
  if (guide.upper != null && dose > guide.upper)
    return `Above the ${formatDose(guide.upper, guide.unit)} upper limit.`;
  if (dose > guide.high * 2) return `Well above the usual ${formatDose(guide.high, guide.unit)}.`;
  return undefined;
}
