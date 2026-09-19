// SPEC §12 — full JSON backup and restore. Everything the user created; never the USDA seed.
// Restore is a merge: rows with the same id are overwritten, nothing else is touched.
import type { DailyTarget, Food, LogEntry, Profile, Setting, WeighIn } from '@/core/types';
import { bulkPutDailyTargets, listDailyTargets } from '@/db/repo/dailyTargets';
import { bulkPutFoods, listUserFoods } from '@/db/repo/foods';
import { bulkPutEntries, listAllEntries } from '@/db/repo/logEntries';
import { bulkPutProfiles, listProfiles } from '@/db/repo/profiles';
import { bulkPutSettings, listSettings } from '@/db/repo/settings';
import { bulkPutWeighIns, listWeighIns } from '@/db/repo/weighIns';
import { exportFiles } from '@/platform/exportFile';

export interface Backup {
  app: 'kalib';
  format: 2;
  exported_at: string;
  profiles: Profile[];
  foods: Food[];
  weigh_ins: WeighIn[];
  log_entries: LogEntry[];
  daily_targets: DailyTarget[];
  settings: Setting[];
}

// Format 1 (first v0 builds) carried a single `profile` and no foods or settings; parseBackup
// upgrades it in place.

/** Device-specific keys that must not travel between installs. */
const LOCAL_ONLY_SETTING = /^seed_version:/;

export async function buildBackup(): Promise<Backup> {
  const [profiles, foods, weigh_ins, log_entries, daily_targets, settings] = await Promise.all([
    listProfiles(),
    listUserFoods(),
    listWeighIns(),
    listAllEntries(),
    listDailyTargets(),
    listSettings(),
  ]);
  return {
    app: 'kalib',
    format: 2,
    exported_at: new Date().toISOString(),
    profiles,
    foods,
    weigh_ins,
    log_entries,
    daily_targets,
    settings: settings.filter((s) => !LOCAL_ONLY_SETTING.test(s.key)),
  };
}

export async function exportBackup(): Promise<'shared' | 'downloaded'> {
  const backup = await buildBackup();
  const stamp = backup.exported_at.slice(0, 10);
  return exportFiles([
    {
      name: `kalib-backup-${stamp}.json`,
      mime: 'application/json',
      content: JSON.stringify(backup),
    },
  ]);
}

export interface BackupSummary {
  exported_at: string;
  profiles: number;
  foods: number;
  weigh_ins: number;
  log_entries: number;
  daily_targets: number;
}

function isArray<T>(v: unknown): v is T[] {
  return Array.isArray(v);
}

/** Validates and normalises a parsed backup file; throws with a plain-language reason. */
export function parseBackup(raw: unknown): Backup {
  if (!raw || typeof raw !== 'object') throw new Error('Not a Kalib backup file.');
  // `Backup & BackupV1` collapses to never (format 1 vs 2), so type the loose shape by hand.
  const b = raw as {
    app?: unknown;
    format?: unknown;
    exported_at?: unknown;
    profile?: Profile | null;
    profiles?: unknown;
    foods?: unknown;
    weigh_ins?: unknown;
    log_entries?: unknown;
    daily_targets?: unknown;
    settings?: unknown;
  };
  if (b.app !== 'kalib') throw new Error('Not a Kalib backup file.');
  if (!isArray<WeighIn>(b.weigh_ins) || !isArray<LogEntry>(b.log_entries)) {
    throw new Error('Backup is missing its weigh-ins or log entries.');
  }
  const daily_targets = isArray<DailyTarget>(b.daily_targets) ? b.daily_targets : [];
  if (b.format === 1) {
    return {
      app: 'kalib',
      format: 2,
      exported_at: typeof b.exported_at === 'string' ? b.exported_at : '',
      profiles: b.profile ? [b.profile] : [],
      foods: [],
      weigh_ins: b.weigh_ins,
      log_entries: b.log_entries,
      daily_targets,
      settings: [],
    };
  }
  if (b.format !== 2) throw new Error(`Backup format ${String(b.format)} is newer than this app.`);
  return {
    app: 'kalib',
    format: 2,
    exported_at: typeof b.exported_at === 'string' ? b.exported_at : '',
    profiles: isArray<Profile>(b.profiles) ? b.profiles : [],
    foods: isArray<Food>(b.foods) ? b.foods : [],
    weigh_ins: b.weigh_ins,
    log_entries: b.log_entries,
    daily_targets,
    settings: isArray<Setting>(b.settings)
      ? b.settings.filter((s) => !LOCAL_ONLY_SETTING.test(s.key))
      : [],
  };
}

export function summarize(b: Backup): BackupSummary {
  return {
    exported_at: b.exported_at,
    profiles: b.profiles.length,
    foods: b.foods.length,
    weigh_ins: b.weigh_ins.length,
    log_entries: b.log_entries.length,
    daily_targets: b.daily_targets.length,
  };
}

/** Merge a backup into the local store. Ids are preserved, so re-importing is idempotent. */
export async function restoreBackup(b: Backup): Promise<void> {
  await bulkPutProfiles(b.profiles);
  await bulkPutFoods(b.foods);
  await bulkPutWeighIns(b.weigh_ins);
  await bulkPutEntries(b.log_entries);
  await bulkPutDailyTargets(b.daily_targets);
  await bulkPutSettings(b.settings);
}
