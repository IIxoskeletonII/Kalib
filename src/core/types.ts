// Domain types mirroring SPEC §6. Every persisted row carries SyncMeta so the v1
// Supabase sync (last-write-wins on updated_at, soft deletes) needs no migration.

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'heavy';
export type Mode = 'CUT' | 'MAINTAIN' | 'RECOMP' | 'BULK';
import type { Market } from './market';

export type FoodSource =
  | 'usda_foundation'
  | 'usda_sr'
  | 'usda_fndds'
  /** ANSES Ciqual, the French national table (§7.1a) — European foods USDA does not carry. */
  | 'ciqual'
  /** Middle Eastern dishes transcribed from published lab analyses (§7.1b). */
  | 'mena'
  /** Restaurant chain menus, per market (§21). Licensed separately — see LICENSE-DATA.md. */
  | 'chain'
  | 'off'
  | 'custom'
  | 'photo';
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
  /**
   * Waist circumference in cm (§14: "verify by waist measurement"). Feeds the RFM body-fat
   * estimate in `core/body.ts`, and is the progress signal that keeps moving when the scale
   * does not.
   */
  waist_cm?: number | null;
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
  /** Other names this food is searched by (§7.1). Not shown in the UI. */
  aliases?: string[];
  /** The published table a compiled value came from, for §7.4 provenance. */
  source_ref?: string;
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
  /**
   * Which country's menu this is, for `source: 'chain'` only (§21). A Big Mac is three
   * different sandwiches in Italy, Oman and the United States, and a search that returned all
   * three would be worse than returning none. Absent on every other source: a national food
   * table is not a menu.
   */
  market?: Market;
  /** The chain whose menu it is, denormalised so a result reads without a second lookup. */
  chain?: string;
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
  /** Cooking steps for the §18.4 cooking mode. */
  steps?: string[];
  /** §18.6 — set when the recipe came from a suggestion. */
  blurb?: string;
  tags?: string[];
  time_min?: number;
  oven_c?: number;
  /** How the recipe came to exist. */
  source?: 'own' | 'suggested' | 'imported';
  /** The page an imported recipe came from, kept so the credit stays with the publisher. */
  source_url?: string;
}

export interface Batch extends SyncMeta {
  recipe_id: string;
  cooked_on: string; // YYYY-MM-DD
  total_g: number;
  portions_total: number;
  portions_remaining: number;
}

// SPEC §18 — meal planner.

export interface WeekPlanItem {
  recipe_id: string;
  portions: number;
  pinned?: boolean;
}

export interface WeekPlan extends SyncMeta {
  week_start: string; // YYYY-MM-DD (Monday)
  days: number;
  allowance_kcal: number;
  allowance_protein_g: number;
  items: WeekPlanItem[];
  /** Shopping list lines ticked off, by food id. */
  checked: string[];
  /** §18.6 weekly grocery budget in the user's currency; absent or 0 = none. */
  budget?: number;
}

export interface FoodPrice extends SyncMeta {
  food_id: string;
  price_per_kg: number;
  currency: string;
  /** §18.6 — a model's typical price, shown as ≈ until the user enters a real one. */
  estimated?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Training (§20). Sets live inside their session row rather than in a table of their own: the sync
// engine rescans every table on each run, and a set-per-row design would reach tens of thousands
// of rows within a year. A twenty-set session is about two kilobytes of JSON.

/**
 * The muscles weekly volume is counted against. The source library names 75 overlapping things
 * (`quads` and `quadriceps`, `delts` and `deltoids` and `shoulders`), which would make "sets per
 * muscle this week" meaningless; everything is normalised onto these.
 */
export type Muscle =
  | 'chest'
  | 'lats'
  | 'upper back'
  | 'traps'
  | 'lower back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'adductors'
  | 'abductors'
  | 'abs'
  | 'obliques'
  | 'neck'
  | 'cardio';

export const MUSCLES: readonly Muscle[] = [
  'chest',
  'lats',
  'upper back',
  'traps',
  'lower back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'adductors',
  'abductors',
  'abs',
  'obliques',
  'neck',
  'cardio',
];

export type ExerciseCategory =
  'strength' | 'stretching' | 'cardio' | 'mobility' | 'plyometrics' | 'rehabilitation' | 'balance';

export type ExerciseDifficulty = 'beginner' | 'intermediate' | 'advanced';

/** Library exercises are seeded and never sync; only the user's own travel between devices. */
export type ExerciseSource = 'library' | 'custom';

/**
 * What a set of this exercise is made of, which decides what the pad asks for and how volume is
 * counted. A plank has no reps and a pull-up has no weight until you hang a belt off it.
 */
export type LoadType =
  'weight_reps' | 'bodyweight_reps' | 'weighted_bodyweight' | 'time' | 'distance_time';

export interface Exercise extends SyncMeta {
  source: ExerciseSource;
  /** Id in the open library, so a re-seed updates rather than duplicates. */
  external_id?: string;
  name: string;
  /** What people actually type: `bb row`, `RDL`, `skullcrusher`. Searched, never displayed. */
  aliases?: string[];
  /**
   * Hand-written shorthand, a subset of `aliases`. Typing one of these is taken as naming this
   * exercise outright, so only a human may add one: the derived aliases strip the equipment word
   * and would have four different exercises all claiming to be "squat".
   */
  shorthand?: string[];
  category: ExerciseCategory;
  difficulty?: ExerciseDifficulty;
  primary_muscle: Muscle;
  secondary_muscles: Muscle[];
  equipment: string;
  load_type: LoadType;
  instructions?: string[];
  /** Basename of the looping demo under /exercises; absent for the user's own exercises. */
  media?: string;
}

/** Warm-ups and drop sets are logged but excluded from working volume and from PRs. */
export type SetKind = 'normal' | 'warmup' | 'drop' | 'failure';

export interface WorkoutSet {
  kind: SetKind;
  weight_kg?: number;
  reps?: number;
  /** Reps left in the tank, 0 to 5. Drives progression (§20.4). */
  rir?: number;
  seconds?: number;
  distance_m?: number;
  done: boolean;
  /** Stamped when ticked, so real rest between sets is known rather than assumed. */
  done_at?: string;
}

export interface WorkoutEntry {
  exercise_id: string;
  /** Copied in, so the row still reads correctly after the exercise is renamed or deleted. */
  name: string;
  load_type: LoadType;
  /** Shared letter groups a superset; absent means a straight set. */
  superset?: string;
  rest_sec?: number;
  note?: string;
  sets: WorkoutSet[];
}

export interface WorkoutSession extends SyncMeta {
  started_at: string;
  /** Absent while the session is still running; there is at most one of those. */
  ended_at?: string;
  routine_id?: string;
  name: string;
  note?: string;
  entries: WorkoutEntry[];
  /** Denormalised on finish so history lists never recompute a year of sessions. */
  volume_kg?: number;
  duration_sec?: number;
  /** MET-based and openly approximate (§20.6); never spent against the day's food budget. */
  energy_kcal?: number;
}

export interface RoutineItem {
  exercise_id: string;
  name: string;
  load_type: LoadType;
  sets: number;
  rep_low?: number;
  rep_high?: number;
  rest_sec?: number;
  superset?: string;
  note?: string;
}

export interface Routine extends SyncMeta {
  name: string;
  note?: string;
  items: RoutineItem[];
  sort_order: number;
  source: 'own' | 'library' | 'shared';
  last_performed?: string; // YYYY-MM-DD
}

/** Storage is always kilograms; this only changes what the pad asks for and what is shown. */
export type WeightUnit = 'kg' | 'lb';
