// SPEC §20.17 — live reads for the week's plan. `undefined` while loading, as elsewhere.
import { useLiveQuery } from 'dexie-react-hooks';
import type { TrainingPlan } from '@/core/schedule';
import { routinePreview, type RoutinePreview } from '@/services/routinePreview';
import { getPlan, schedule, type Schedule } from '@/services/schedule';

/** The days, the cycle, and the fortnight laid out from them. */
export function useSchedule(): Schedule | undefined {
  return useLiveQuery(() => schedule(), []);
}

export function usePlan(): TrainingPlan | undefined {
  return useLiveQuery(() => getPlan(), []);
}

/** `null` once loaded when there is no such routine (deleted, or a bad link). */
export function useRoutinePreview(id: string | undefined): RoutinePreview | null | undefined {
  return useLiveQuery(async () => (id ? ((await routinePreview(id)) ?? null) : null), [id]);
}
