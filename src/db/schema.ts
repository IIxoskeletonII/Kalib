// Dexie schema — the single source of truth for the client store and, in v1, for the
// Postgres migration. Index strings list indexed fields only; rows carry the full types.
import Dexie, { type EntityTable } from 'dexie';
import type {
  Batch,
  DailyTarget,
  Food,
  LogEntry,
  Profile,
  Recipe,
  Setting,
  Supplement,
  SupplementLog,
  TdeeEstimate,
  WaterLog,
  WeighIn,
} from '@/core/types';

export const DB_NAME = 'kalib';

/** v0 is single-user and offline; the v1 sync rewrites this to the authenticated user's id. */
export const LOCAL_USER_ID = 'local';

export class KalibDB extends Dexie {
  profiles!: EntityTable<Profile, 'id'>;
  weigh_ins!: EntityTable<WeighIn, 'id'>;
  foods!: EntityTable<Food, 'id'>;
  log_entries!: EntityTable<LogEntry, 'id'>;
  daily_targets!: EntityTable<DailyTarget, 'id'>;
  tdee_estimates!: EntityTable<TdeeEstimate, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  water_logs!: EntityTable<WaterLog, 'id'>;
  supplements!: EntityTable<Supplement, 'id'>;
  supplement_logs!: EntityTable<SupplementLog, 'id'>;
  recipes!: EntityTable<Recipe, 'id'>;
  batches!: EntityTable<Batch, 'id'>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({
      profiles: 'id, [user_id+created_at]',
      weigh_ins: 'id, &[user_id+date], date',
      foods: 'id, source, barcode, external_id',
      log_entries: 'id, [user_id+date], date, food_id, logged_at',
      daily_targets: 'id, &[user_id+date]',
      tdee_estimates: 'id, [user_id+computed_on]',
      settings: 'key',
    });
    // v2 (SPEC §17): water and supplements. Additive, so no upgrade function is needed.
    this.version(2).stores({
      water_logs: 'id, [user_id+date], date',
      supplements: 'id, [user_id+sort_order]',
      supplement_logs: 'id, [user_id+date], [supplement_id+date], date',
    });
    // v3 (SPEC §8.2): recipes and batches.
    this.version(3).stores({
      recipes: 'id, food_id',
      batches: 'id, recipe_id, cooked_on',
    });
  }
}
