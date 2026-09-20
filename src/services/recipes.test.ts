import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { addFood, getFood } from '@/db/repo/foods';
import { getEntry, listEntriesForDate } from '@/db/repo/logEntries';
import { getBatch, getRecipe, listActiveBatches } from '@/db/repo/recipes';
import {
  addRecipeItem,
  cookBatch,
  createRecipe,
  deleteRecipe,
  logBatchPortion,
  removeEntry,
  removeRecipeItem,
  setRecipeYield,
} from './recipes';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function chickenAndRice() {
  const chicken = await addFood({
    source: 'usda_foundation',
    name: 'Chicken breast, raw',
    per_100g: { kcal: 120, protein: 22.5, carb: 0, fat: 2.6, fiber: 0 },
    micros: { iron: 0.4 },
    micro_coverage: 1 / 22,
    portions: [],
    verified: true,
  });
  const rice = await addFood({
    source: 'usda_sr',
    name: 'Rice, white, raw',
    per_100g: { kcal: 360, protein: 7, carb: 79, fat: 0.6, fiber: 1.3 },
    micros: {},
    micro_coverage: 0,
    portions: [],
    verified: true,
  });
  const recipe = await createRecipe('Chicken & rice');
  await addRecipeItem(recipe.id, chicken, 1000);
  await addRecipeItem(recipe.id, rice, 400);
  return { recipe: (await getRecipe(recipe.id))!, chicken, rice };
}

describe('recipe ↔ food', () => {
  it('materialises a custom food that tracks the ingredients and yield', async () => {
    const { recipe } = await chickenAndRice();
    let food = (await getFood(recipe.food_id))!;
    expect(food.source).toBe('custom');
    expect(food.recipe_id).toBe(recipe.id);
    expect(food.name).toBe('Chicken & rice');
    // raw weight 1,400 g stands in: 2,640 kcal / 14
    expect(food.per_100g.kcal).toBeCloseTo(188.57, 1);
    expect(food.portions).toEqual([{ label: '1 portion', grams: 350 }]);

    await setRecipeYield(recipe.id, 2200);
    food = (await getFood(recipe.food_id))!;
    expect(food.per_100g.kcal).toBeCloseTo(120, 0);
    expect(food.portions[0]!.grams).toBe(550);

    await removeRecipeItem(recipe.id, 1);
    food = (await getFood(recipe.food_id))!;
    expect(food.per_100g.kcal).toBeCloseTo(1200 / 22, 1);
  });

  it('deleting the recipe soft-deletes its food too', async () => {
    const { recipe } = await chickenAndRice();
    await deleteRecipe(recipe.id);
    expect(await getRecipe(recipe.id)).toBeUndefined();
    expect(await getFood(recipe.food_id)).toBeUndefined();
  });
});

describe('batches', () => {
  it('cooking sets the yield; logging takes portions off; deleting the entry gives them back', async () => {
    const { recipe } = await chickenAndRice();
    const batch = await cookBatch(recipe, 2200, 4, '2026-09-20');
    expect(batch.portions_remaining).toBe(4);
    expect((await getRecipe(recipe.id))!.yield_g).toBe(2200);
    expect((await getFood(recipe.food_id))!.portions[0]!.grams).toBe(550);

    const fresh = (await getRecipe(recipe.id))!;
    const e = await logBatchPortion({
      batch,
      recipe: fresh,
      grams: 550,
      meal_slot: 'lunch',
      date: '2026-09-21',
    });
    expect(e.entry_method).toBe('batch');
    expect(e.batch_id).toBe(batch.id);
    expect(e.recipe_id).toBe(recipe.id);
    expect(e.servings).toBe(1);
    expect(e.kcal).toBeCloseTo(660, 0);
    expect((await getBatch(batch.id))!.portions_remaining).toBe(3);

    const half = await logBatchPortion({
      batch,
      recipe: fresh,
      grams: 275,
      meal_slot: 'dinner',
      date: '2026-09-21',
    });
    expect(half.servings).toBe(0.5);
    expect((await getBatch(batch.id))!.portions_remaining).toBe(2.5);

    await removeEntry(e.id);
    expect(await getEntry(e.id)).toBeUndefined();
    expect((await getBatch(batch.id))!.portions_remaining).toBe(3.5);
    expect((await listEntriesForDate('2026-09-21')).length).toBe(1);
  });

  it('a batch leaves the active list at zero and never goes negative', async () => {
    const { recipe } = await chickenAndRice();
    const batch = await cookBatch(recipe, 1000, 2);
    const fresh = (await getRecipe(recipe.id))!;
    for (let i = 0; i < 3; i++) {
      await logBatchPortion({
        batch,
        recipe: fresh,
        grams: 500,
        meal_slot: 'lunch',
        date: '2026-09-21',
      });
    }
    expect((await getBatch(batch.id))!.portions_remaining).toBe(0);
    expect(await listActiveBatches()).toEqual([]);
  });
});
