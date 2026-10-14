// SPEC §20.5 — records, and the number you are actually trying to beat.
//
// None of this is stored. Records are derived from session history the same way TDEE and
// banking are, for the same reason: a stored record is a second source of truth that drifts
// the moment a session is edited or deleted, and it would need conflict resolution of its own
// when two phones disagree. Walking a year of sessions is a few hundred rows.
import { bestE1rm, e1rm, isWorkingSet } from './sets';
import type { WorkoutEntry, WorkoutSession, WorkoutSet } from './types';

/** Weights are snapped to loadable steps, so a cent-level key is more than enough. */
function weightKey(kg: number): number {
  return Math.round(kg * 100) / 100;
}

export interface ExercisePR {
  heaviest_kg?: number;
  heaviest_reps?: number;
  heaviest_at?: string;
  best_e1rm_kg?: number;
  best_e1rm_at?: string;
  /** Best single set by weight × reps; a different question from the heaviest single. */
  best_set_volume_kg?: number;
  best_set_volume_at?: string;
  best_session_volume_kg?: number;
  best_session_volume_at?: string;
  /** Most reps ever completed at each weight, for "you did 8 here last time". */
  reps_at_weight: Map<number, number>;
  /** Longest hold, for timed work, where none of the above means anything. */
  best_seconds?: number;
  best_seconds_at?: string;
}

function emptyPR(): ExercisePR {
  return { reps_at_weight: new Map() };
}

/** Every entry for one exercise across the given sessions, oldest first. */
function entriesFor(
  sessions: readonly WorkoutSession[],
  exercise_id: string,
): { session: WorkoutSession; entry: WorkoutEntry }[] {
  const out: { session: WorkoutSession; entry: WorkoutEntry }[] = [];
  for (const session of sessions) {
    for (const entry of session.entries) {
      if (entry.exercise_id === exercise_id) out.push({ session, entry });
    }
  }
  return out.sort((a, b) => (a.session.started_at < b.session.started_at ? -1 : 1));
}

/**
 * Records for one exercise over the sessions supplied. The caller decides the window — pass
 * everything for all-time, or a slice for "this year".
 */
export function personalRecords(
  sessions: readonly WorkoutSession[],
  exercise_id: string,
): ExercisePR {
  const pr = emptyPR();
  for (const { session, entry } of entriesFor(sessions, exercise_id)) {
    const at = session.started_at;
    let entryVolume = 0;

    for (const s of entry.sets) {
      if (!isWorkingSet(s)) continue;

      if (s.seconds != null && (pr.best_seconds == null || s.seconds > pr.best_seconds)) {
        pr.best_seconds = s.seconds;
        pr.best_seconds_at = at;
      }
      if (s.weight_kg == null || s.reps == null || s.reps <= 0) continue;

      // Heaviest wins on weight; reps only break a tie, so a heavy single still counts.
      if (
        pr.heaviest_kg == null ||
        s.weight_kg > pr.heaviest_kg ||
        (s.weight_kg === pr.heaviest_kg && s.reps > (pr.heaviest_reps ?? 0))
      ) {
        pr.heaviest_kg = s.weight_kg;
        pr.heaviest_reps = s.reps;
        pr.heaviest_at = at;
      }

      const vol = s.weight_kg * s.reps;
      entryVolume += vol;
      if (pr.best_set_volume_kg == null || vol > pr.best_set_volume_kg) {
        pr.best_set_volume_kg = vol;
        pr.best_set_volume_at = at;
      }

      const k = weightKey(s.weight_kg);
      if (s.reps > (pr.reps_at_weight.get(k) ?? 0)) pr.reps_at_weight.set(k, s.reps);
    }

    const est = bestE1rm(entry);
    if (est != null && (pr.best_e1rm_kg == null || est > pr.best_e1rm_kg)) {
      pr.best_e1rm_kg = est;
      pr.best_e1rm_at = at;
    }
    if (
      entryVolume > 0 &&
      (pr.best_session_volume_kg == null || entryVolume > pr.best_session_volume_kg)
    ) {
      pr.best_session_volume_kg = entryVolume;
      pr.best_session_volume_at = at;
    }
  }
  return pr;
}

export interface LastPerformance {
  session_id: string;
  started_at: string;
  /** The working sets as they were logged, in order, so set 2 can be shown against set 2. */
  sets: WorkoutSet[];
}

/**
 * The last time this exercise was trained, ignoring a session in progress. This is the number
 * that belongs next to every set: not a record, which may be years old and unreachable today,
 * but what you did last time, which is what you are trying to beat.
 */
export function lastPerformance(
  sessions: readonly WorkoutSession[],
  exercise_id: string,
  exclude_session_id?: string,
): LastPerformance | undefined {
  const all = entriesFor(sessions, exercise_id).filter(
    ({ session, entry }) =>
      session.id !== exclude_session_id && entry.sets.some((s) => isWorkingSet(s)),
  );
  const latest = all[all.length - 1];
  if (!latest) return undefined;
  return {
    session_id: latest.session.id,
    started_at: latest.session.started_at,
    sets: latest.entry.sets.filter((s) => isWorkingSet(s)),
  };
}

export type PRKind = 'weight' | 'e1rm' | 'set_volume' | 'reps' | 'seconds';

export interface PRHit {
  exercise_id: string;
  name: string;
  kind: PRKind;
  /** The new figure: kilograms, reps or seconds depending on `kind`. */
  value: number;
  /** What it beat. Always present: an exercise's first outing sets no records (see below). */
  previous: number;
}

/**
 * Records set by one session, judged against history that must NOT include it. The caller
 * passes the prior sessions; mixing the session in would have it beat itself.
 *
 * The first time an exercise is ever done is deliberately not a record. Everything would be a
 * PR on day one, which makes the idea worthless exactly when someone is most likely to look.
 */
export function newRecords(session: WorkoutSession, history: readonly WorkoutSession[]): PRHit[] {
  const out: PRHit[] = [];
  for (const entry of session.entries) {
    const prior = personalRecords(history, entry.exercise_id);
    const everDone =
      prior.heaviest_kg != null || prior.best_seconds != null || prior.reps_at_weight.size > 0;
    if (!everDone) continue;

    const add = (kind: PRKind, value: number, previous: number) =>
      out.push({ exercise_id: entry.exercise_id, name: entry.name, kind, value, previous });

    let heaviest: { kg: number; reps: number } | undefined;
    let bestVolume = 0;
    let bestSeconds = 0;
    const repsAt = new Map<number, number>();

    for (const s of entry.sets) {
      if (!isWorkingSet(s)) continue;
      if (s.seconds != null && s.seconds > bestSeconds) bestSeconds = s.seconds;
      if (s.weight_kg == null || s.reps == null || s.reps <= 0) continue;
      if (!heaviest || s.weight_kg > heaviest.kg) heaviest = { kg: s.weight_kg, reps: s.reps };
      bestVolume = Math.max(bestVolume, s.weight_kg * s.reps);
      const k = weightKey(s.weight_kg);
      if (s.reps > (repsAt.get(k) ?? 0)) repsAt.set(k, s.reps);
    }

    if (heaviest && prior.heaviest_kg != null && heaviest.kg > prior.heaviest_kg) {
      add('weight', heaviest.kg, prior.heaviest_kg);
    }
    const est = bestE1rm(entry);
    if (est != null && prior.best_e1rm_kg != null && est > prior.best_e1rm_kg) {
      add('e1rm', est, prior.best_e1rm_kg);
    }
    if (prior.best_set_volume_kg != null && bestVolume > prior.best_set_volume_kg) {
      add('set_volume', bestVolume, prior.best_set_volume_kg);
    }
    if (prior.best_seconds != null && bestSeconds > prior.best_seconds) {
      add('seconds', bestSeconds, prior.best_seconds);
    }
    // A rep record only counts at a weight that has been used before: more reps at a weight
    // never tried is not an improvement, it is simply new.
    for (const [kg, reps] of repsAt) {
      const was = prior.reps_at_weight.get(kg);
      if (was != null && reps > was) add('reps', reps, was);
    }
  }
  return out;
}

/** How a record reads in a toast or a list row. */
export function describePR(hit: PRHit): string {
  switch (hit.kind) {
    case 'weight':
      return 'Heaviest ever';
    case 'e1rm':
      return 'Best estimated 1RM';
    case 'set_volume':
      return 'Best set';
    case 'reps':
      return 'Most reps at this weight';
    case 'seconds':
      return 'Longest hold';
  }
}

/** Convenience for a screen that has one exercise and wants its best single. */
export function bestSingle(pr: ExercisePR): number | undefined {
  if (pr.heaviest_kg == null || pr.heaviest_reps == null) return undefined;
  return e1rm(pr.heaviest_kg, pr.heaviest_reps);
}
