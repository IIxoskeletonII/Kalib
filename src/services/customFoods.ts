// SPEC §8.1 — custom foods: the user's real rotation, entered once, logged in one tap.
// Stored per 100 g like every other food; the serving the user typed becomes its first portion.
import type { Weighable } from '@/core/nutrition';
import type { Food } from '@/core/types';
import { addFood, updateFood } from '@/db/repo/foods';

const EMPTY_PER_100G = { kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0 };

export interface CustomFoodInput {
  name: string;
  brand?: string | undefined;
  /** Grams in the serving the macros below describe. */
  serving_g: number;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  fiber_g: number;
}

export function toFoodFields(i: CustomFoodInput) {
  const f = 100 / i.serving_g;
  const fields: Omit<Food, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'source'> = {
    name: i.name.trim(),
    per_100g: {
      kcal: round(i.kcal * f),
      protein: round(i.protein_g * f),
      carb: round(i.carb_g * f),
      fat: round(i.fat_g * f),
      fiber: round(i.fiber_g * f),
    },
    micros: {},
    micro_coverage: 0,
    portions: [{ label: '1 serving', grams: i.serving_g }],
    verified: false,
  };
  if (i.brand?.trim()) fields.brand = i.brand.trim();
  return fields;
}

/** Per-serving values back out of a stored food, for the editor. */
export function fromFood(food: Food): CustomFoodInput {
  const serving = food.portions[0]?.grams ?? 100;
  const f = serving / 100;
  // The editor is a per-serving form in grams. A food with no weight has nothing to put in
  // it, and §21 items are not user-editable anyway.
  const per = food.per_100g ?? food.per_item ?? EMPTY_PER_100G;
  const out: CustomFoodInput = {
    name: food.name,
    serving_g: serving,
    kcal: round(per.kcal * f),
    protein_g: round(per.protein * f),
    carb_g: round(per.carb * f),
    fat_g: round(per.fat * f),
    fiber_g: round(per.fiber * f),
  };
  if (food.brand) out.brand = food.brand;
  return out;
}

/** Always weighable: the editor is a per-serving form in grams, so there is always one. */
export async function createCustomFood(i: CustomFoodInput): Promise<Weighable<Food>> {
  return (await addFood({ source: 'custom', ...toFoodFields(i) })) as Weighable<Food>;
}

export async function updateCustomFood(id: string, i: CustomFoodInput): Promise<void> {
  await updateFood(id, toFoodFields(i));
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
