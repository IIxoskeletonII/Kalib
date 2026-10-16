// Shape of public/data/foods-*.json, produced by scripts/seed-usda.ts and loaded by db/seed.ts.
import type { Market } from './market';
import type { FoodSource, Micros, Per100g, Portion } from './types';

export interface SeedFood {
  /** Deterministic id (`usda_foundation:<fdcId>`) so every device agrees on food ids. */
  id: string;
  external_id: string;
  name: string;
  /**
   * Other names the same food goes by, from FDC's "Additional Description" attributes: a
   * chickpea is also `garbanzos` and `ceci`. Searched, never displayed.
   */
  aliases?: string[];
  category?: string;
  /** Which published table a value came from, when the source is a compiled one (§7.1b). */
  source_ref?: string;
  /** Chain menus only (§21): which country's menu, and whose. */
  market?: Market;
  chain?: string;
  per_100g?: Per100g;
  /** For a food sold as an item and published without a weight (§21). */
  per_item?: Per100g;
  item_label?: string;
  micros: Micros;
  micro_coverage: number;
  portions: Portion[];
}

export interface SeedFile {
  format: 1;
  source: FoodSource;
  /**
   * The terms the data is served under, for the sources that are not public domain.
   *
   * The app is offline-first, so a seed file has to reach the device to work, and anyone can
   * fetch it. Being downloadable is not a licence; this says so in the file itself rather than
   * only in LICENSE-DATA.md, where whoever downloads it would never look.
   */
  terms?: { holder: string; licence: string; note: string };
  generated_at: string;
  count: number;
  foods: SeedFood[];
}
