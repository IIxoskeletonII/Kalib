import type { Batch, Recipe, SyncMeta } from '@/core/types';
import { db, isLive, LOCAL_USER_ID, newMeta, nowIso } from '../db';

export type RecipeInput = Omit<Recipe, keyof SyncMeta>;

export async function addRecipe(input: RecipeInput, id?: string): Promise<Recipe> {
  const row: Recipe = { ...newMeta(id), ...input };
  await db.recipes.add(row);
  return row;
}

export async function getRecipe(id: string): Promise<Recipe | undefined> {
  const row = await db.recipes.get(id);
  return row && isLive(row) ? row : undefined;
}

/** Live recipes, newest first. */
export async function listRecipes(): Promise<Recipe[]> {
  const rows = await db.recipes.toArray();
  return rows
    .filter((r) => r.user_id === LOCAL_USER_ID && isLive(r))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

/** Patch; a property set to `undefined` is removed from the row (Dexie semantics). */
export async function updateRecipe(
  id: string,
  patch: { [K in keyof RecipeInput]?: RecipeInput[K] | undefined },
): Promise<void> {
  // Dexie's UpdateSpec typing rejects explicit undefined although it means "delete the key".
  await db.recipes.update(id, { ...patch, updated_at: nowIso() } as Partial<Recipe>);
}

export async function deleteRecipe(id: string): Promise<void> {
  const ts = nowIso();
  await db.recipes.update(id, { deleted_at: ts, updated_at: ts });
}

export async function listAllRecipes(): Promise<Recipe[]> {
  return db.recipes.toArray();
}

export async function bulkPutRecipes(rows: readonly Recipe[]): Promise<void> {
  await db.recipes.bulkPut([...rows]);
}

// Batches

export type BatchInput = Omit<Batch, keyof SyncMeta>;

export async function addBatch(input: BatchInput): Promise<Batch> {
  const row: Batch = { ...newMeta(), ...input };
  await db.batches.add(row);
  return row;
}

export async function getBatch(id: string): Promise<Batch | undefined> {
  const row = await db.batches.get(id);
  return row && isLive(row) ? row : undefined;
}

/** Live batches with portions left, most recently cooked first. */
export async function listActiveBatches(): Promise<Batch[]> {
  const rows = await db.batches.toArray();
  return rows
    .filter((b) => b.user_id === LOCAL_USER_ID && isLive(b) && b.portions_remaining > 0)
    .sort((a, b) => (a.cooked_on < b.cooked_on ? 1 : -1));
}

export async function listBatchesForRecipe(recipe_id: string): Promise<Batch[]> {
  const rows = await db.batches.where('recipe_id').equals(recipe_id).toArray();
  return rows.filter(isLive).sort((a, b) => (a.cooked_on < b.cooked_on ? 1 : -1));
}

export async function updateBatch(id: string, patch: Partial<BatchInput>): Promise<void> {
  await db.batches.update(id, { ...patch, updated_at: nowIso() });
}

/** Atomically move portions_remaining by `delta` (negative when logging), clamped at 0. */
export async function adjustBatchPortions(id: string, delta: number): Promise<void> {
  await db.transaction('rw', db.batches, async () => {
    const b = await db.batches.get(id);
    if (!b) return;
    const next = Math.max(0, Math.round((b.portions_remaining + delta) * 4) / 4);
    await db.batches.update(id, { portions_remaining: next, updated_at: nowIso() });
  });
}

export async function deleteBatch(id: string): Promise<void> {
  const ts = nowIso();
  await db.batches.update(id, { deleted_at: ts, updated_at: ts });
}

export async function listAllBatches(): Promise<Batch[]> {
  return db.batches.toArray();
}

export async function bulkPutBatches(rows: readonly Batch[]): Promise<void> {
  await db.batches.bulkPut([...rows]);
}

export async function restoreBatch(id: string): Promise<void> {
  const ts = nowIso();
  await db.batches.update(id, { deleted_at: null, updated_at: ts });
}

export async function restoreRecipe(id: string): Promise<void> {
  const ts = nowIso();
  await db.recipes.update(id, { deleted_at: null, updated_at: ts });
}
