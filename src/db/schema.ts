// Dexie schema — the single source of truth for the client store and, in v1, for the
// Postgres migration. Index strings list indexed fields only; rows carry the full types.
import Dexie, { type EntityTable } from 'dexie';
import type {
  DailyTarget,
  Food,
  LogEntry,
  Profile,
  Setting,
  TdeeEstimate,
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
  }
}
