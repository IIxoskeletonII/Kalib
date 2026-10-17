// SPEC §21.2 — the chain menus on this device, and what to order from one.
//
// core/chainOrder.ts does the thinking and knows nothing about storage; this is the part that
// reads the foods and turns each one into a serving. A chain publishes either a weight, in
// which case the serving is its first portion, or nothing, in which case the row is already
// per item — a slice, a piece, a sandwich.
import { bestOrders, type MenuItem, type Order } from '@/core/chainOrder';
import type { Market } from '@/core/market';
import type { Food, MacroTotals } from '@/core/types';
import { listChainFoods } from '@/db/repo/foods';
import { foodItemEntryInput, foodEntryInput } from './logging';
import { addEntry } from '@/db/repo/logEntries';
import type { Weighable } from '@/core/nutrition';

export interface ChainSummary {
  chain: string;
  market: Market;
  /** How many servings are known, so a thin menu can say so rather than look complete. */
  items: number;
}

/** One serving of a food, however the chain happens to sell it. */
function serving(f: Food): MenuItem | null {
  const name = f.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (f.per_item) {
    return {
      id: f.id,
      name,
      kcal: f.per_item.kcal,
      protein_g: f.per_item.protein,
      carb_g: f.per_item.carb,
      fat_g: f.per_item.fat,
      fiber_g: f.per_item.fiber,
    };
  }
  const grams = f.portions[0]?.grams;
  if (!grams || !f.per_100g) return null;
  const k = grams / 100;
  return {
    id: f.id,
    name,
    kcal: f.per_100g.kcal * k,
    protein_g: f.per_100g.protein * k,
    carb_g: f.per_100g.carb * k,
    fat_g: f.per_100g.fat * k,
    fiber_g: f.per_100g.fiber * k,
  };
}

/**
 * The chains with data for the markets you are in, most complete first.
 *
 * One entry per chain, not per chain per market. Domino's trades in both Oman and the
 * Emirates and the menus are the same menu, so two identical chips would be two spellings of
 * one answer. The market recorded is the nearest one that has it.
 */
export async function chainsFor(markets: readonly Market[]): Promise<ChainSummary[]> {
  const foods = await listChainFoods(markets);
  const byChain = new Map<string, ChainSummary>();
  for (const f of foods) {
    if (!f.chain || !f.market) continue;
    const row = byChain.get(f.chain);
    if (!row) {
      byChain.set(f.chain, { chain: f.chain, market: f.market, items: 1 });
      continue;
    }
    row.items += 1;
    if (markets.indexOf(f.market) < markets.indexOf(row.market)) row.market = f.market;
  }
  return [...byChain.values()].sort((a, b) => b.items - a.items || a.chain.localeCompare(b.chain));
}

/** The orders worth offering at one chain, given what is left of the day. */
export async function ordersAt(
  chain: string,
  markets: readonly Market[],
  remaining: MacroTotals,
): Promise<Order[]> {
  const foods = await listChainFoods(markets);
  // One serving per dish, not one per country. The same Margerita slice is published in both
  // the Omani and the Emirati tables — identically, which is why the region is grouped at all
  // — and leaving both in would offer an order of the same slice twice over. The nearest
  // market wins, in the order `marketsFor` returned.
  const rank = (f: Food) => (f.market ? markets.indexOf(f.market) : markets.length);
  const nearest = new Map<string, Food>();
  for (const f of foods) {
    if (f.chain !== chain) continue;
    const key = f.name.toLowerCase();
    const held = nearest.get(key);
    if (!held || rank(f) < rank(held)) nearest.set(key, f);
  }
  const menu = [...nearest.values()].map(serving).filter((m): m is MenuItem => m !== null);
  return bestOrders(menu, remaining);
}

/**
 * Logs every line of an order.
 *
 * Each line is logged as the food it is, by weight or by the item, so the day's entries read
 * as what was eaten rather than as one lump called "order".
 */
export async function logOrder(
  order: Order,
  markets: readonly Market[],
  date: string,
  meal_slot: 'breakfast' | 'lunch' | 'dinner' | 'snack',
): Promise<void> {
  const foods = await listChainFoods(markets);
  const byId = new Map(foods.map((f) => [f.id, f]));
  for (const line of order.lines) {
    const food = byId.get(line.item.id);
    if (!food) continue;
    if (food.per_item) {
      await addEntry(
        foodItemEntryInput({
          food: food as Food & { per_item: NonNullable<Food['per_item']> },
          items: line.count,
          meal_slot,
          date,
          entry_method: 'search',
        }),
      );
      continue;
    }
    const grams = (food.portions[0]?.grams ?? 0) * line.count;
    if (!grams || !food.per_100g) continue;
    await addEntry(
      foodEntryInput({
        food: food as Weighable<Food>,
        grams,
        meal_slot,
        date,
        entry_method: 'search',
      }),
    );
  }
}
