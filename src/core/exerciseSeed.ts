// Shape of public/data/exercises.json, produced by scripts/seed-exercises.ts and loaded by
// db/seed.ts. Mirrors core/seedFormat.ts, which does the same job for food.
import type { Exercise } from './types';

/** An exercise as it ships: everything but the sync metadata and the source, added on load. */
export type SeedExercise = Omit<
  Exercise,
  'user_id' | 'created_at' | 'updated_at' | 'deleted_at' | 'source'
>;

export interface ExerciseSeedFile {
  format: 1;
  generated_at: string;
  count: number;
  /** Where the library came from and under what terms, so attribution travels with the data. */
  source_ref: string;
  exercises: SeedExercise[];
}
