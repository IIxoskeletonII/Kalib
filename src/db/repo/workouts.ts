// SPEC §20.3 — routines (what you plan to do) and sessions (what you actually did).
//
// A session's sets live inside its row, so a set is edited by writing the whole session back.
// That is deliberate: see the note on WorkoutSession in core/types.ts. It also means every
// write touches one row, so last-write-wins sync behaves sensibly — two phones editing the
// same live session is not a case worth splitting rows for.
import type { Routine, SyncMeta, WorkoutSession } from '@/core/types';
import { db, isLive, LOCAL_USER_ID, newMeta, nowIso } from '../db';

// ---------------------------------------------------------------------------------- routines

export type RoutineInput = Omit<Routine, keyof SyncMeta>;

export async function addRoutine(input: RoutineInput, id?: string): Promise<Routine> {
  const row: Routine = { ...newMeta(id), ...input };
  await db.routines.add(row);
  return row;
}

export async function getRoutine(id: string): Promise<Routine | undefined> {
  const row = await db.routines.get(id);
  return row && isLive(row) ? row : undefined;
}

/** Live routines in the user's chosen order. */
export async function listRoutines(): Promise<Routine[]> {
  const rows = await db.routines.toArray();
  return rows
    .filter((r) => r.user_id === LOCAL_USER_ID && isLive(r))
    .sort((a, b) => a.sort_order - b.sort_order || (a.name < b.name ? -1 : 1));
}

export async function updateRoutine(
  id: string,
  patch: { [K in keyof RoutineInput]?: RoutineInput[K] | undefined },
): Promise<void> {
  await db.routines.update(id, { ...patch, updated_at: nowIso() } as Partial<Routine>);
}

export async function deleteRoutine(id: string): Promise<void> {
  const ts = nowIso();
  await db.routines.update(id, { deleted_at: ts, updated_at: ts });
}

export async function restoreRoutine(id: string): Promise<void> {
  await db.routines.update(id, { deleted_at: null, updated_at: nowIso() });
}

/** Writes a whole new order in one transaction, so a reorder cannot half-apply. */
export async function reorderRoutines(idsInOrder: readonly string[]): Promise<void> {
  const ts = nowIso();
  await db.transaction('rw', db.routines, async () => {
    for (const [i, id] of idsInOrder.entries()) {
      await db.routines.update(id, { sort_order: i, updated_at: ts });
    }
  });
}

/** The next free slot, so a new routine lands at the end rather than fighting for position 0. */
export async function nextRoutineOrder(): Promise<number> {
  const rows = await listRoutines();
  return rows.reduce((max, r) => Math.max(max, r.sort_order + 1), 0);
}

export async function listAllRoutines(): Promise<Routine[]> {
  return db.routines.toArray();
}

export async function bulkPutRoutines(rows: readonly Routine[]): Promise<void> {
  await db.routines.bulkPut([...rows]);
}

// ---------------------------------------------------------------------------------- sessions

export type WorkoutSessionInput = Omit<WorkoutSession, keyof SyncMeta>;

export async function addSession(input: WorkoutSessionInput, id?: string): Promise<WorkoutSession> {
  const row: WorkoutSession = { ...newMeta(id), ...input };
  await db.workout_sessions.add(row);
  return row;
}

export async function getSession(id: string): Promise<WorkoutSession | undefined> {
  const row = await db.workout_sessions.get(id);
  return row && isLive(row) ? row : undefined;
}

/**
 * The session still running, if there is one. A session with no `ended_at` is live; there is
 * meant to be at most one, and if a crash ever left two the newest is the real one.
 */
export async function activeSession(): Promise<WorkoutSession | undefined> {
  const rows = await db.workout_sessions.toArray();
  return rows
    .filter((s) => s.user_id === LOCAL_USER_ID && isLive(s) && s.ended_at == null)
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0];
}

/** Finished sessions, newest first. `limit` caps what a history list has to render. */
export async function listSessions(limit?: number): Promise<WorkoutSession[]> {
  const rows = await db.workout_sessions.toArray();
  const live = rows
    .filter((s) => s.user_id === LOCAL_USER_ID && isLive(s) && s.ended_at != null)
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  return limit == null ? live : live.slice(0, limit);
}

/** Finished sessions from `from` (an ISO timestamp) onward, oldest first: the shape every
 *  derived figure wants — PRs, weekly volume, streaks. */
export async function sessionsSince(from: string): Promise<WorkoutSession[]> {
  const rows = await db.workout_sessions.toArray();
  return rows
    .filter(
      (s) => s.user_id === LOCAL_USER_ID && isLive(s) && s.ended_at != null && s.started_at >= from,
    )
    .sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
}

export async function updateSession(
  id: string,
  patch: { [K in keyof WorkoutSessionInput]?: WorkoutSessionInput[K] | undefined },
): Promise<void> {
  await db.workout_sessions.update(id, {
    ...patch,
    updated_at: nowIso(),
  } as Partial<WorkoutSession>);
}

export async function deleteSession(id: string): Promise<void> {
  const ts = nowIso();
  await db.workout_sessions.update(id, { deleted_at: ts, updated_at: ts });
}

export async function restoreSession(id: string): Promise<void> {
  await db.workout_sessions.update(id, { deleted_at: null, updated_at: nowIso() });
}

export async function listAllSessions(): Promise<WorkoutSession[]> {
  return db.workout_sessions.toArray();
}

export async function bulkPutSessions(rows: readonly WorkoutSession[]): Promise<void> {
  await db.workout_sessions.bulkPut([...rows]);
}
