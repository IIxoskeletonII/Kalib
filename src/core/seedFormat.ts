// Shape of public/data/foods-*.json, produced by scripts/seed-usda.ts and loaded by db/seed.ts.
import type { FoodSource, Micros, Per100g, Portion } from './types';

export interface SeedFood {
  /** Deterministic id (`usda_foundation:<fdcId>`) so every device agrees on food ids. */
  id: string;
  external_id: string;
  name: string;
  category?: string;
  per_100g: Per100g;
  micros: Micros;
  micro_coverage: number;
  portions: Portion[];
}

export interface SeedFile {
  format: 1;
  source: FoodSource;
  generated_at: string;
  count: number;
  foods: SeedFood[];
}
