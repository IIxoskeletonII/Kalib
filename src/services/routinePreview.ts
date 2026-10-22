// SPEC §20.17 — a routine, read before it is started.
//
// Everything the page shows is already known somewhere: the plan in the routine, the last time
// each lift was done and its records in the sessions, the next prescription in §20.8, and when
// the routine next comes round in the schedule. This only gathers it.
import { todayKey } from '@/core/dates';
import { lastPerformance, personalRecords, type ExercisePR, type LastPerformance } from '@/core/pr';
import type { Prescription } from '@/core/progression';
import { estimateMinutes, routineMuscles, totalSets } from '@/core/routineSummary';
import type { Exercise, Muscle, Routine } from '@/core/types';
import { getExercises } from '@/db/repo/exercises';
import { getRoutine } from '@/db/repo/workouts';
import { schedule } from './schedule';
import { prescriptionsFor } from './training';
import { defaultRestSec, recentSessions } from './workouts';

export interface PreviewItem {
  exercise?: Exercise;
  last?: LastPerformance;
  records: ExercisePR;
  prescription?: Prescription;
}

export interface RoutinePreview {
  routine: Routine;
  /** One per item, in the routine's order. */
  items: PreviewItem[];
  muscles: { muscle: Muscle; sets: number }[];
  sets: number;
  minutes: number;
  /** The next day this routine is laid on, in the fortnight shown on Train. */
  next_on?: string;
  /** Whether it is the one up next in the cycle, whatever the day. */
  is_next: boolean;
  last_done?: string;
}

export async function routinePreview(
  id: string,
  today = todayKey(),
): Promise<RoutinePreview | undefined> {
  const routine = await getRoutine(id);
  if (!routine) return undefined;
  const [exercises, history, rest, plan] = await Promise.all([
    getExercises(routine.items.map((i) => i.exercise_id)),
    recentSessions(),
    defaultRestSec(),
    schedule(today),
  ]);
  const prescriptions = await prescriptionsFor({
    id: `preview:${routine.id}`,
    routine_id: routine.id,
    started_at: new Date(`${today}T12:00:00`).toISOString(),
    entries: routine.items.map((i) => ({
      exercise_id: i.exercise_id,
      name: i.name,
      load_type: i.load_type,
      sets: [],
    })),
  });

  const items: PreviewItem[] = routine.items.map((i) => {
    const exercise = exercises.get(i.exercise_id);
    const last = lastPerformance(history, i.exercise_id);
    const prescription = prescriptions.get(i.exercise_id);
    return {
      ...(exercise ? { exercise } : {}),
      ...(last ? { last } : {}),
      records: personalRecords(history, i.exercise_id),
      ...(prescription ? { prescription } : {}),
    };
  });

  const next_on = plan.days.find((d) => d.date >= today && d.slot?.routine_id === routine.id)?.date;
  const last_done = plan.facts[routine.id]?.last_done;
  return {
    routine,
    items,
    muscles: routineMuscles(routine.items, (x) => exercises.get(x)?.primary_muscle),
    sets: totalSets(routine.items),
    minutes: estimateMinutes(routine.items, rest),
    ...(next_on ? { next_on } : {}),
    is_next: plan.next?.routine.id === routine.id,
    ...(last_done ? { last_done } : {}),
  };
}
