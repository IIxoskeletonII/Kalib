// SPEC §8.2 — recipes and batches. Every write to a recipe rewrites its materialised food so
// the rest of the app (search, favourites, coach, amount sheet) only ever sees a food.
import { todayKey } from '@/core/dates';
import { encodeShare, packRecipe, type SharedRecipe } from '@/core/recipeShare';
import { portionGrams, recipeFoodFields, servingsOf } from '@/core/recipes';
import type { Batch, Food, MealSlot, Recipe, RecipeItem } from '@/core/types';
import { addFood, getFood, getFoods, restoreFood, updateFood, deleteFood } from '@/db/repo/foods';
import { addEntry, deleteEntry, getEntry, restoreEntry } from '@/db/repo/logEntries';
import {
  addBatch,
  addRecipe,
  adjustBatchPortions,
  getRecipe,
  restoreRecipe as restoreRecipeRow,
  updateRecipe,
  deleteRecipe as deleteRecipeRow,
} from '@/db/repo/recipes';
import { newId } from '@/db/db';
import { foodEntryInput } from './logging';

async function foodsFor(items: readonly RecipeItem[]): Promise<Map<string, Food>> {
  return getFoods(items.map((i) => i.food_id));
}

/** Rewrites the recipe's food from its current items and yield. */
async function materialise(recipe: Recipe): Promise<void> {
  const foods = await foodsFor(recipe.items);
  await updateFood(recipe.food_id, recipeFoodFields(recipe, foods));
}

export async function createRecipe(name: string): Promise<Recipe> {
  const recipeId = newId();
  const food = await addFood({
    source: 'custom',
    recipe_id: recipeId,
    ...recipeFoodFields({ name, items: [], portions: 4 }, new Map()),
  });
  return addRecipe(
    { name: name.trim() || 'Recipe', items: [], portions: 4, food_id: food.id },
    recipeId,
  );
}

async function patchRecipe(id: string, patch: Partial<Omit<Recipe, 'id'>>): Promise<void> {
  const current = await getRecipe(id);
  if (!current) return;
  await updateRecipe(id, patch);
  await materialise({ ...current, ...patch });
}

export async function renameRecipe(id: string, name: string): Promise<void> {
  await patchRecipe(id, { name: name.trim() || 'Recipe' });
}

export async function setRecipeYield(id: string, yield_g: number | undefined): Promise<void> {
  const current = await getRecipe(id);
  if (!current) return;
  const next = { ...current };
  if (yield_g && yield_g > 0) next.yield_g = yield_g;
  else delete next.yield_g;
  await updateRecipe(id, { yield_g: next.yield_g });
  await materialise(next);
}

export async function setRecipeSteps(id: string, steps: string[]): Promise<void> {
  const clean = steps.map((x) => x.trim()).filter(Boolean);
  await updateRecipe(id, { steps: clean.length ? clean : undefined });
}

export async function setRecipePortions(id: string, portions: number): Promise<void> {
  await patchRecipe(id, { portions: Math.max(1, Math.round(portions)) });
}

export async function addRecipeItem(id: string, food: Food, grams: number): Promise<void> {
  const current = await getRecipe(id);
  if (!current) return;
  const items = [...current.items, { food_id: food.id, name: food.name, grams }];
  await patchRecipe(id, { items });
}

export async function setRecipeItemGrams(id: string, index: number, grams: number) {
  const current = await getRecipe(id);
  if (!current || !current.items[index]) return;
  const items = current.items.map((it, i) => (i === index ? { ...it, grams } : it));
  await patchRecipe(id, { items });
}

export async function removeRecipeItem(id: string, index: number): Promise<void> {
  const current = await getRecipe(id);
  if (!current) return;
  await patchRecipe(id, { items: current.items.filter((_, i) => i !== index) });
}

/** Soft-deletes the recipe and its food; past log entries keep their denormalised values. */
export async function deleteRecipe(id: string): Promise<void> {
  const current = await getRecipe(id);
  if (!current) return;
  await deleteRecipeRow(id);
  await deleteFood(current.food_id);
}

/**
 * A cooked instance. The weighed pot becomes the recipe's yield as well, so the per-100 g
 * figure tracks the last real measurement.
 */
export async function cookBatch(
  recipe: Recipe,
  total_g: number,
  portions: number,
  cooked_on: string = todayKey(),
): Promise<Batch> {
  const p = Math.max(1, Math.round(portions));
  await updateRecipe(recipe.id, { yield_g: total_g, portions: p });
  await materialise({ ...recipe, yield_g: total_g, portions: p });
  return addBatch({
    recipe_id: recipe.id,
    cooked_on,
    total_g,
    portions_total: p,
    portions_remaining: p,
  });
}

export interface BatchPortionOpts {
  batch: Batch;
  recipe: Recipe;
  grams: number;
  meal_slot: MealSlot;
  date: string;
}

/** Logs `grams` of a batch and takes the matching share off its remaining portions. */
export async function logBatchPortion(o: BatchPortionOpts) {
  const food = await getFood(o.recipe.food_id);
  if (!food) throw new Error('This recipe’s food is missing.');
  const portion = o.batch.total_g / o.batch.portions_total;
  const servings = servingsOf(o.grams, portion);
  const entry = await addEntry({
    ...foodEntryInput({
      food,
      grams: o.grams,
      meal_slot: o.meal_slot,
      date: o.date,
      entry_method: 'batch',
    }),
    servings,
    batch_id: o.batch.id,
    recipe_id: o.recipe.id,
  });
  await adjustBatchPortions(o.batch.id, -servings);
  return entry;
}

/** Deleting a batch entry gives its portions back. Use this instead of the repo delete. */
export async function removeEntry(id: string): Promise<void> {
  const e = await getEntry(id);
  if (!e) return;
  await deleteEntry(id);
  if (e.batch_id) await adjustBatchPortions(e.batch_id, e.servings);
}

/** Undo of removeEntry: the entry returns and its batch portion is taken again. */
export async function undoRemoveEntry(id: string): Promise<void> {
  await restoreEntry(id);
  const e = await getEntry(id);
  if (e?.batch_id) await adjustBatchPortions(e.batch_id, -e.servings);
}

/** Undo of deleteRecipe: recipe and its food come back together. */
export async function undoDeleteRecipe(recipeId: string, foodId: string): Promise<void> {
  await restoreRecipeRow(recipeId);
  await restoreFood(foodId);
}

/** Grams of one portion for the amount sheet, from the batch when there is one. */
export function batchPortionGrams(batch: Batch | undefined, recipe: Recipe): number {
  return batch ? batch.total_g / batch.portions_total : portionGrams(recipe);
}

/** A share code for this recipe (§8.2 household sharing): seed foods by id, own foods embedded. */
export async function shareCodeFor(recipe: Recipe): Promise<string> {
  const foods = await foodsFor(recipe.items);
  return encodeShare(packRecipe(recipe, foods));
}

export interface ImportPreview {
  shared: SharedRecipe;
  /** Per ingredient: found in this database, will be created as an own food, or unknown. */
  status: ('found' | 'embedded' | 'missing')[];
}

export async function previewImport(shared: SharedRecipe): Promise<ImportPreview> {
  const ids = shared.items.map((i) => i.id).filter((id): id is string => id != null);
  const have = await getFoods(ids);
  return {
    shared,
    status: shared.items.map((i) =>
      i.id && have.has(i.id) ? 'found' : i.f ? 'embedded' : 'missing',
    ),
  };
}

/** Creates the recipe locally; embedded own foods become this account's custom foods. */
export async function importRecipe(shared: SharedRecipe): Promise<Recipe> {
  const recipe = await createRecipe(shared.name);
  const ids = shared.items.map((i) => i.id).filter((id): id is string => id != null);
  const have = await getFoods(ids);
  for (const it of shared.items) {
    let food: Food | undefined = it.id ? have.get(it.id) : undefined;
    if (!food && it.f) {
      food = await addFood({
        source: 'custom',
        name: it.f.name,
        ...(it.f.brand ? { brand: it.f.brand } : {}),
        ...(it.f.barcode ? { barcode: it.f.barcode } : {}),
        per_100g: it.f.per_100g,
        micros: it.f.micros ?? {},
        micro_coverage: 0,
        portions: [{ label: '1 serving', grams: 100 }],
        verified: false,
      });
    }
    if (food) await addRecipeItem(recipe.id, food, it.g);
  }
  await updateRecipe(recipe.id, { portions: shared.portions, yield_g: shared.yield_g });
  const fresh = await getRecipe(recipe.id);
  if (fresh) await materialise(fresh);
  return fresh ?? recipe;
}
