import type { FoodPrice, SyncMeta, WeekPlan } from '@/core/types';
import { db, isLive, LOCAL_USER_ID, newMeta, nowIso } from '../db';

export type WeekPlanInput = Omit<WeekPlan, keyof SyncMeta>;

export async function getPlan(week_start: string): Promise<WeekPlan | undefined> {
  const row = await db.week_plans
    .where('[user_id+week_start]')
    .equals([LOCAL_USER_ID, week_start])
    .first();
  return row && isLive(row) ? row : undefined;
}

export async function upsertPlan(input: WeekPlanInput): Promise<WeekPlan> {
  const existing = await db.week_plans
    .where('[user_id+week_start]')
    .equals([LOCAL_USER_ID, input.week_start])
    .first();
  if (existing) {
    const patch = { ...input, updated_at: nowIso(), deleted_at: null };
    await db.week_plans.update(existing.id, patch);
    return { ...existing, ...patch };
  }
  const row: WeekPlan = { ...newMeta(), ...input };
  await db.week_plans.add(row);
  return row;
}

export async function listAllPlans(): Promise<WeekPlan[]> {
  return db.week_plans.toArray();
}

export async function bulkPutPlans(rows: readonly WeekPlan[]): Promise<void> {
  await db.week_plans.bulkPut([...rows]);
}

// Prices

export async function listPrices(): Promise<FoodPrice[]> {
  const rows = await db.prices.toArray();
  return rows.filter((r) => r.user_id === LOCAL_USER_ID && isLive(r));
}

export async function setPrice(
  food_id: string,
  price_per_kg: number,
  currency: string,
): Promise<void> {
  const existing = await db.prices
    .where('[user_id+food_id]')
    .equals([LOCAL_USER_ID, food_id])
    .first();
  if (existing) {
    await db.prices.update(existing.id, {
      price_per_kg,
      currency,
      updated_at: nowIso(),
      deleted_at: null,
    });
    return;
  }
  const row: FoodPrice = { ...newMeta(), food_id, price_per_kg, currency };
  await db.prices.add(row);
}

export async function listAllPrices(): Promise<FoodPrice[]> {
  return db.prices.toArray();
}

export async function bulkPutPrices(rows: readonly FoodPrice[]): Promise<void> {
  await db.prices.bulkPut([...rows]);
}
