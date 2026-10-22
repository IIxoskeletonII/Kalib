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
//
// **A cycle may name a routine twice** (§20.17). Push, pull, legs with two push days alternating
// is six slots over four routines: Chest & Tri, Back & Bi, Legs, Shoulders & Tri, Back & Bi,
// Legs. Knowing the last routine is then not enough to know where you are — Back & Bi is slot
// two or slot five — so the position is read from the run of sessions before it, which is what
// a person does when they remember "I did shoulders before that, so this is the second pull".
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

export interface CyclePosition {
  /** Index of the slot that comes next. */
  next: number;
  /** Index of the slot the most recent session filled, when one did. */
  last?: number;
  /** That session. */
  last_session?: WorkoutSession;
}

/**
 * Where a cycle has got to, from the sessions done in it.
 *
 * Sessions from an empty workout, from a routine not in the cycle (deleted, or left out of it),
 * or still running say nothing about the cycle and are skipped, so deleting a routine moves
 * "next" on to whatever followed it rather than back to the start.
 *
 * When the last routine appears in more than one slot, the slot is the one whose predecessors
 * best match the sessions before it, read back as far as one lap of the cycle; a tie goes to the
 * earliest slot. Done strictly in order, this finds the true position; done out of order, it
 * finds the nearest reading of what was done, and carries on from there — which is what the
 * person would do.
 */
export function cyclePosition(
  cycle: readonly string[],
  sessions: readonly WorkoutSession[],
): CyclePosition | undefined {
  const L = cycle.length;
  if (L === 0) return undefined;
  const inCycle = new Set(cycle);
  const history = sessions
    .filter(
      (s) =>
        s.ended_at != null && !s.deleted_at && s.routine_id != null && inCycle.has(s.routine_id),
    )
    .sort((a, b) => (a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0));
  const last_session = history[history.length - 1];
  if (!last_session) return { next: 0 };

  const ids = history.map((s) => s.routine_id!);
  const n = ids.length;
  let last = -1;
  let bestScore = -1;
  for (let i = 0; i < L; i++) {
    if (cycle[i] !== ids[n - 1]) continue;
    let score = 0;
    // One lap back at most: further than that the cycle repeats itself and proves nothing.
    for (let j = 1; j < L && j < n; j++) {
      if (cycle[(((i - j) % L) + L) % L] !== ids[n - 1 - j]) break;
      score++;
    }
    if (score > bestScore) {
      bestScore = score;
      last = i;
    }
  }
  return { next: (last + 1) % L, last, last_session };
}

/**
 * The routine after the one done most recently, in the cycle's order, wrapping round.
 *
 * `cycle` is the routines' ids in the order they come round (§20.17), and may repeat one. When
 * absent it is `routines` in the order given (the user's order), each once. Ids that no longer
 * name a routine are ignored.
 */
export function nextRoutine(
  routines: readonly Routine[],
  sessions: readonly WorkoutSession[],
  now: Date = new Date(),
  cycle?: readonly string[],
): NextRoutine | undefined {
  const byId = new Map(routines.map((r) => [r.id, r]));
  const slots = (cycle ?? routines.map((r) => r.id)).filter((id) => byId.has(id));
  const pos = cyclePosition(slots, sessions);
  if (!pos) return undefined;

  const routine = byId.get(slots[pos.next]!)!;
  if (pos.last == null || !pos.last_session) return { routine, trained_today: false };
  const after = byId.get(slots[pos.last]!)!;
  const after_date = toDateKey(new Date(pos.last_session.started_at));
  return { routine, after, after_date, trained_today: after_date === toDateKey(now) };
}
