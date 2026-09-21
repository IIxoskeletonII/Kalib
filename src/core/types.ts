// Domain types mirroring SPEC §6. Every persisted row carries SyncMeta so the v1
// Supabase sync (last-write-wins on updated_at, soft deletes) needs no migration.

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'heavy';
export type Mode = 'CUT' | 'MAINTAIN' | 'RECOMP';
export type FoodSource = 'usda_foundation' | 'usda_sr' | 'usda_fndds' | 'off' | 'custom' | 'photo';
export type EntryMethod = 'favourite' | 'search' | 'barcode' | 'batch' | 'photo' | 'manual';
export type Confidence = 'high' | 'medium' | 'low';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type TargetSource = 'formula' | 'measured';
export type WeighInSource = 'manual' | 'import';

export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export interface SyncMeta {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Profile extends SyncMeta {
  sex: Sex;
  birth_date: string; // YYYY-MM-DD
  height_cm: number;
  activity_level: ActivityLevel;
  mode: Mode;
  goal_rate_kg_per_week: number;
  bodyfat_pct?: number;
  target_weight_kg?: number;
}

export interface WeighIn extends SyncMeta {
  date: string; // YYYY-MM-DD, unique per user
  weight_kg: number;
  bodyfat_pct?: number;
  source: WeighInSource;
}

/** Label-level nutrients per 100 g (SPEC §6 `per_100g`). */
export interface Per100g {
  kcal: number;
  protein: number;
  carb: number;
  fat: number;
  fiber: number;
  sugar?: number;
  sodium?: number; // mg
  sat_fat?: number;
}

export type MicroKey =
  | 'vit_a'
  | 'vit_c'
  | 'vit_d'
  | 'vit_e'
  | 'vit_k'
  | 'b1'
  | 'b2'
  | 'b3'
  | 'b5'
  | 'b6'
  | 'folate'
  | 'b12'
  | 'choline'
  | 'calcium'
  | 'iron'
  | 'magnesium'
  | 'phosphorus'
  | 'potassium'
  | 'zinc'
  | 'copper'
  | 'manganese'
  | 'selenium';

export type Micros = Partial<Record<MicroKey, number>>;

export interface Portion {
  label: string;
  grams: number;
}

export interface Food extends SyncMeta {
  source: FoodSource;
  external_id?: string;
  name: string;
  brand?: string;
  barcode?: string;
  /** Source's food group (USDA category) — used to keep coach suggestions to real dishes. */
  category?: string;
  per_100g: Per100g;
  micros: Micros;
  /** 0–1: fraction of MICRO_KEYS present. */
  micro_coverage: number;
  portions: Portion[];
  density_g_per_ml?: number;
  verified: boolean;
  /** Set when this food is the materialised form of a recipe (SPEC §8.2). */
  recipe_id?: string;
}

export interface MacroTotals {
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  fiber_g: number;
}

export interface LogEntry extends SyncMeta, MacroTotals {
  logged_at: string; // ISO timestamp
  date: string; // YYYY-MM-DD (local day the entry belongs to)
  meal_slot: MealSlot;
  /** Denormalised display name — survives food edits and covers manual entries. */
  name: string;
  food_id?: string;
  batch_id?: string;
  recipe_id?: string;
  grams: number;
  servings: number;
  micros: Micros;
  entry_method: EntryMethod;
  confidence: Confidence;
  photo_url?: string;
  photo_assumptions?: Record<string, unknown>;
  corrected_from_id?: string;
}

export interface DailyTarget extends SyncMeta, MacroTotals {
  date: string;
  water_ml: number;
  banking_adjustment: number;
  source: TargetSource;
  provisional: boolean;
}

export interface TdeeEstimate extends SyncMeta {
  computed_on: string;
  tdee_kcal: number;
  ci_low: number;
  ci_high: number;
  window_days: number;
  logged_days: number;
  weighed_days: number;
  data_quality: number;
}

export interface Setting {
  key: string;
  user_id: string;
  value: unknown;
  updated_at: string;
}

// SPEC §17 — water and supplements.

export interface WaterLog extends SyncMeta {
  date: string; // YYYY-MM-DD
  logged_at: string; // ISO timestamp
  ml: number;
}

export type SupplementUnit = 'g' | 'mg' | 'µg' | 'IU' | 'capsule' | 'ml';
export type SupplementTiming = 'morning' | 'with_food' | 'evening' | 'any';

export interface Supplement extends SyncMeta {
  name: string;
  dose: number;
  unit: SupplementUnit;
  timing: SupplementTiming;
  /** Catalogue item this was created from, if any (SPEC §17.3). */
  catalogue_id?: string;
  /** Micronutrient it supplies, so the coach can count it (§17.2). */
  nutrient?: MicroKey;
  /** Amount of that nutrient per dose, in the nutrient's own unit (MICRO_DEFS). */
  nutrient_amount?: number;
  sort_order: number;
  active: boolean;
}

export interface SupplementLog extends SyncMeta {
  supplement_id: string;
  date: string; // YYYY-MM-DD
  taken_at: string; // ISO timestamp
  dose: number;
  unit: SupplementUnit;
}

// SPEC §8.2 — recipes and batches.

export interface RecipeItem {
  food_id: string;
  /** Denormalised for display; survives food edits. */
  name: string;
  grams: number;
}

export interface Recipe extends SyncMeta {
  name: string;
  items: RecipeItem[];
  /** Cooked weight in grams; absent until weighed (raw total stands in). */
  yield_g?: number;
  portions: number;
  /** The materialised custom food (foods.recipe_id points back). */
  food_id: string;
  notes?: string;
}

export interface Batch extends SyncMeta {
  recipe_id: string;
  cooked_on: string; // YYYY-MM-DD
  total_g: number;
  portions_total: number;
  portions_remaining: number;
}
