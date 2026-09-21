// Building log entries from foods or manual macros (SPEC §6, §7.4 confidence).
import { mealSlotForTime, toDateKey } from '@/core/dates';
import { scaleFood } from '@/core/nutrition';
import type { EntryMethod, Food, LogEntry, MacroTotals, MealSlot } from '@/core/types';
import { addEntry, updateEntry, type LogEntryInput } from '@/db/repo/logEntries';

export interface FoodEntryOpts {
  food: Food;
  grams: number;
  meal_slot: MealSlot;
  date: string;
  entry_method: Extract<EntryMethod, 'search' | 'favourite' | 'barcode' | 'batch' | 'photo'>;
  now?: Date;
}

/** A weighed amount of a database food — high confidence (§7.4). */
export function foodEntryInput(o: FoodEntryOpts): LogEntryInput {
  const now = o.now ?? new Date();
  const scaled = scaleFood(o.food, o.grams);
  return {
    logged_at: now.toISOString(),
    date: o.date,
    meal_slot: o.meal_slot,
    name: o.food.name,
    food_id: o.food.id,
    grams: o.grams,
    servings: 1,
    ...scaled,
    entry_method: o.entry_method,
    confidence: o.food.source === 'photo' ? 'low' : 'high',
  };
}

export interface ManualEntryOpts extends MacroTotals {
  name: string;
  meal_slot: MealSlot;
  date: string;
  now?: Date;
}

/** Typed-in macros with no food behind them — medium confidence, no micros. */
export function manualEntryInput(o: ManualEntryOpts): LogEntryInput {
  const now = o.now ?? new Date();
  return {
    logged_at: now.toISOString(),
    date: o.date,
    meal_slot: o.meal_slot,
    name: o.name || 'Quick add',
    grams: 0,
    servings: 1,
    kcal: o.kcal,
    protein_g: o.protein_g,
    carb_g: o.carb_g,
    fat_g: o.fat_g,
    fiber_g: o.fiber_g,
    micros: {},
    entry_method: 'manual',
    confidence: 'medium',
  };
}

export async function logFood(o: FoodEntryOpts) {
  return addEntry(foodEntryInput(o));
}

export async function logManual(o: ManualEntryOpts) {
  return addEntry(manualEntryInput(o));
}

/** Re-scale an existing food entry to new grams / slot. */
export async function rescaleEntry(id: string, food: Food, grams: number, meal_slot: MealSlot) {
  await updateEntry(id, { grams, meal_slot, ...scaleFood(food, grams) });
}

export function todayFor(now: Date = new Date()): string {
  return toDateKey(now);
}

/** §8.1 — the same thing again, now: a copy of an entry into today's current meal slot. */
export async function repeatEntry(e: LogEntry, now: Date = new Date()): Promise<LogEntry> {
  const {
    id: _id,
    user_id: _u,
    created_at: _c,
    updated_at: _up,
    deleted_at: _d,
    batch_id: _b,
    ...rest
  } = e;
  void _id;
  void _u;
  void _c;
  void _up;
  void _d;
  void _b;
  return addEntry({
    ...rest,
    logged_at: now.toISOString(),
    date: toDateKey(now),
    meal_slot: mealSlotForTime(now),
    entry_method: e.food_id ? 'favourite' : 'manual',
  });
}
