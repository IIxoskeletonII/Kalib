// SPEC §8.1 — custom foods: the user's real rotation, entered once, logged in one tap.
// Stored per 100 g like every other food; the serving the user typed becomes its first portion.
import type { Food } from '@/core/types';
import { addFood, updateFood } from '@/db/repo/foods';

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
  const out: CustomFoodInput = {
    name: food.name,
    serving_g: serving,
    kcal: round(food.per_100g.kcal * f),
    protein_g: round(food.per_100g.protein * f),
    carb_g: round(food.per_100g.carb * f),
    fat_g: round(food.per_100g.fat * f),
    fiber_g: round(food.per_100g.fiber * f),
  };
  if (food.brand) out.brand = food.brand;
  return out;
}

export async function createCustomFood(i: CustomFoodInput): Promise<Food> {
  return addFood({ source: 'custom', ...toFoodFields(i) });
}

export async function updateCustomFood(id: string, i: CustomFoodInput): Promise<void> {
  await updateFood(id, toFoodFields(i));
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
