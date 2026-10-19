// SPEC §20.10 — which routine is next.
//
// A week written by §20.9, or by hand, is a list of days meant to be done in order. Nothing on
// Train said which of them was today's, so a person with Full body A, B and C in front of them
// had to remember where they had got to. The app already knows: every session records the
// routine it came from.
//
// **It is a rotation, not a calendar.** Missing Wednesday does not mean Wednesday's session is
// skipped; it means it is still next. That is how a rotation-based program is run, and it is
// the only rule that never asks someone to do two sessions to catch up or to drop one they
// have not done.
import { toDateKey } from './dates';
import type { Routine, WorkoutSession } from './types';

export interface NextRoutine {
  routine: Routine;
  /** The routine done most recently, when there is one; what "next" is next after. */
  after?: Routine;
  /** Local day `after` was last done, `YYYY-MM-DD`. */
  after_date?: string;
  /** A routine session already finished today: the suggestion is for next time, not now. */
  trained_today: boolean;
}

/**
 * The routine after the one done most recently, in the list's own order, wrapping round.
 *
 * `routines` is taken in the order given (the user's order). Sessions from an empty workout,
 * from a routine since deleted, or still running say nothing about the rotation and are
 * skipped, so deleting a routine moves "next" on to whatever followed it rather than back to
 * the start.
 */
export function nextRoutine(
  routines: readonly Routine[],
  sessions: readonly WorkoutSession[],
  now: Date = new Date(),
): NextRoutine | undefined {
  const first = routines[0];
  if (!first) return undefined;

  const index = new Map(routines.map((r, i) => [r.id, i]));
  let last: WorkoutSession | undefined;
  for (const s of sessions) {
    if (s.ended_at == null || s.routine_id == null || !index.has(s.routine_id)) continue;
    if (!last || s.started_at > last.started_at) last = s;
  }
  if (!last) return { routine: first, trained_today: false };

  const i = index.get(last.routine_id!)!;
  const after = routines[i]!;
  const routine = routines[(i + 1) % routines.length]!;
  const after_date = toDateKey(new Date(last.started_at));
  return { routine, after, after_date, trained_today: after_date === toDateKey(now) };
}
