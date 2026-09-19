import { buildSearchDoc, type SearchDoc } from '@/core/search';
import type { Food, SyncMeta } from '@/core/types';
import { db, isLive, newMeta } from '../db';

export async function getFood(id: string): Promise<Food | undefined> {
  const row = await db.foods.get(id);
  return row && isLive(row) ? row : undefined;
}

export async function getFoods(ids: readonly string[]): Promise<Map<string, Food>> {
  const rows = await db.foods.bulkGet([...ids]);
  const out = new Map<string, Food>();
  for (const r of rows) if (r && isLive(r)) out.set(r.id, r);
  return out;
}

/** Bulk insert/replace; used by the USDA seed loader. Chunked so a phone stays responsive. */
export async function bulkPutFoods(foods: readonly Food[], chunk = 500): Promise<void> {
  for (let i = 0; i < foods.length; i += chunk) {
    await db.foods.bulkPut(foods.slice(i, i + chunk));
  }
}

export async function countFoods(): Promise<number> {
  return db.foods.count();
}

/** Projection of every live food for the in-memory search index. */
export async function listSearchDocs(): Promise<SearchDoc[]> {
  const docs: SearchDoc[] = [];
  await db.foods.each((f) => {
    if (isLive(f)) docs.push(buildSearchDoc(f));
  });
  return docs;
}

export type FoodInput = Omit<Food, keyof SyncMeta>;

export async function addFood(input: FoodInput, id?: string): Promise<Food> {
  const row: Food = { ...newMeta(id), ...input };
  await db.foods.add(row);
  return row;
}
