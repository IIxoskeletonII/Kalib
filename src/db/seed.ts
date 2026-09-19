import type { SeedFile } from '@/core/seedFormat';
import type { Food, FoodSource } from '@/core/types';
import { LOCAL_USER_ID, nowIso } from './db';
import { bulkPutFoods } from './repo/foods';
import { getSetting, setSetting } from './repo/settings';

/** Bump when public/data/*.json is regenerated with different content. */
export const SEED_VERSION = 2;

export const SEED_FILES: { source: FoodSource; url: string }[] = [
  { source: 'usda_foundation', url: '/data/foods-foundation.json' },
  { source: 'usda_sr', url: '/data/foods-sr.json' },
];

export interface SeedProgress {
  source: FoodSource;
  done: boolean;
}

function seedKey(source: FoodSource): string {
  return `seed_version:${source}`;
}

export async function isSeeded(source: FoodSource): Promise<boolean> {
  return (await getSetting<number>(seedKey(source))) === SEED_VERSION;
}

/**
 * Loads any seed file not yet at SEED_VERSION. Foundation first (small, highest quality),
 * SR Legacy second. Safe to call on every launch; resumes if a previous run was interrupted.
 */
export async function ensureSeeded(onProgress?: (p: SeedProgress) => void): Promise<void> {
  for (const f of SEED_FILES) {
    if (await isSeeded(f.source)) continue;
    onProgress?.({ source: f.source, done: false });
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`Seed fetch failed: ${f.url} (${res.status})`);
    const data = (await res.json()) as SeedFile;
    if (data.format !== 1 || data.source !== f.source) {
      throw new Error(`Unexpected seed file at ${f.url}`);
    }
    const ts = nowIso();
    const rows: Food[] = data.foods.map((sf) => ({
      ...sf,
      user_id: LOCAL_USER_ID,
      source: data.source,
      verified: true,
      created_at: ts,
      updated_at: ts,
    }));
    await bulkPutFoods(rows);
    await setSetting(seedKey(f.source), SEED_VERSION);
    onProgress?.({ source: f.source, done: true });
  }
}
