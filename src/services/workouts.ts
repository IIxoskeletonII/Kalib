// SPEC §20.3 — running a session. Orchestration only: the maths lives in core/, the writes in
// db/repo/, and screens call these.
//
// Every edit rewrites the whole session row, because its sets are embedded. That is one write
// per tick of a checkbox, which sounds wasteful and is not: a session is a couple of kilobytes,
// IndexedDB writes are cheap, and it means a crash mid-set loses nothing and last-write-wins
// sync has exactly one row to reason about.
import { newRecords, type PRHit } from '@/core/pr';
import { sessionDuration, sessionVolume } from '@/core/sets';
import { startRest, type RestTimer } from '@/core/restTimer';
import { workoutEnergy, type WorkoutEnergyEstimate } from '@/core/workoutEnergy';
import type { Exercise, Routine, WorkoutEntry, WorkoutSession, WorkoutSet } from '@/core/types';
import { getExercises } from '@/db/repo/exercises';
import { latestWeighIn } from '@/db/repo/weighIns';
import { getSetting, setSetting } from '@/db/repo/settings';
import {
  addSession,
  deleteSession,
  getSession,
  listSessions,
  sessionsSince,
  updateSession,
  updateRoutine,
} from '@/db/repo/workouts';
import { todayKey } from '@/core/dates';

export const WEIGHT_UNIT_KEY = 'weight_unit';
export const REST_DEFAULT_KEY = 'rest_default_sec';
/** The live rest timer, kept in settings so it survives a reload and a locked screen. */
export const REST_TIMER_KEY = 'rest_timer';

function emptySet(prototype?: WorkoutSet): WorkoutSet {
  // A new set inherits the last one's load: you almost always do the same weight again, and
  // when you do not, the pad's first keypress replaces it anyway.
  const s: WorkoutSet = { kind: 'normal', done: false };
  if (prototype?.weight_kg != null) s.weight_kg = prototype.weight_kg;
  if (prototype?.reps != null) s.reps = prototype.reps;
  if (prototype?.seconds != null) s.seconds = prototype.seconds;
  return s;
}

export function entryFromExercise(e: Exercise, sets = 3, rest_sec?: number): WorkoutEntry {
  const entry: WorkoutEntry = {
    exercise_id: e.id,
    name: e.name,
    load_type: e.load_type,
    sets: Array.from({ length: Math.max(1, sets) }, () => emptySet()),
  };
  if (rest_sec != null) entry.rest_sec = rest_sec;
  return entry;
}

/**
 * Starts a session from a routine, or an empty one. Refuses when a session is already running:
 * two live sessions is not a state the UI can show honestly, and silently ending the first
 * would throw away work.
 */
export async function startSession(routine?: Routine): Promise<WorkoutSession> {
  const existing = await activeSessionOrThrow();
  if (existing) throw new Error('A workout is already running.');

  let entries: WorkoutEntry[] = [];
  if (routine) {
    const ex = await getExercises(routine.items.map((i) => i.exercise_id));
    entries = routine.items.map((i) => {
      const live = ex.get(i.exercise_id);
      const entry: WorkoutEntry = {
        exercise_id: i.exercise_id,
        // The routine's copy of the name is the fallback; the live exercise wins if it exists,
        // so a rename shows through.
        name: live?.name ?? i.name,
        load_type: live?.load_type ?? i.load_type,
        sets: Array.from({ length: Math.max(1, i.sets) }, () => emptySet()),
      };
      if (i.rest_sec != null) entry.rest_sec = i.rest_sec;
      if (i.superset != null) entry.superset = i.superset;
      if (i.note != null) entry.note = i.note;
      return entry;
    });
  }

  const input = {
    started_at: new Date().toISOString(),
    name: routine?.name ?? 'Workout',
    entries,
    ...(routine ? { routine_id: routine.id } : {}),
  };
  return addSession(input);
}

async function activeSessionOrThrow(): Promise<WorkoutSession | undefined> {
  const { activeSession } = await import('@/db/repo/workouts');
  return activeSession();
}

/** Reads the session, applies a change to its entries, writes it back. */
async function mutate(id: string, fn: (entries: WorkoutEntry[]) => WorkoutEntry[]): Promise<void> {
  const s = await getSession(id);
  if (!s) return;
  await updateSession(id, { entries: fn(structuredClone(s.entries)) });
}

export async function addExercise(session_id: string, e: Exercise): Promise<void> {
  await mutate(session_id, (entries) => [...entries, entryFromExercise(e)]);
}

export async function removeEntry(session_id: string, index: number): Promise<void> {
  await mutate(session_id, (entries) => entries.filter((_, i) => i !== index));
}

export async function addSet(session_id: string, index: number): Promise<void> {
  await mutate(session_id, (entries) => {
    const e = entries[index];
    if (e) e.sets.push(emptySet(e.sets[e.sets.length - 1]));
    return entries;
  });
}

export async function removeSet(
  session_id: string,
  index: number,
  setIndex: number,
): Promise<void> {
  await mutate(session_id, (entries) => {
    const e = entries[index];
    if (e) e.sets = e.sets.filter((_, i) => i !== setIndex);
    return entries;
  });
}

/** Replaces one entry's sets wholesale — for the warm-up ramp, which prepends several. */
export async function replaceSets(
  session_id: string,
  index: number,
  sets: WorkoutSet[],
): Promise<void> {
  await mutate(session_id, (entries) => {
    const e = entries[index];
    if (e) e.sets = sets;
    return entries;
  });
}

export async function updateSet(
  session_id: string,
  index: number,
  setIndex: number,
  patch: Partial<WorkoutSet>,
): Promise<void> {
  await mutate(session_id, (entries) => {
    const s = entries[index]?.sets[setIndex];
    if (s) Object.assign(s, patch);
    return entries;
  });
}

/**
 * Ticks or unticks a set. Ticking stamps the moment and starts the rest timer; unticking
 * clears the stamp, because an untick means it did not happen.
 */
export async function toggleSetDone(
  session_id: string,
  index: number,
  setIndex: number,
): Promise<{ done: boolean; rest?: RestTimer }> {
  const s = await getSession(session_id);
  const entry = s?.entries[index];
  const set = entry?.sets[setIndex];
  if (!s || !entry || !set) return { done: false };

  const done = !set.done;
  await mutate(session_id, (entries) => {
    const target = entries[index]?.sets[setIndex];
    if (target) {
      target.done = done;
      // Un-ticking removes the stamp rather than blanking it: the set did not happen, so there
      // is no moment to record. Assigning undefined would leave the key present.
      if (done) target.done_at = new Date().toISOString();
      else delete target.done_at;
    }
    return entries;
  });

  if (!done) return { done };
  const seconds = entry.rest_sec ?? (await defaultRestSec());
  if (seconds <= 0) return { done };
  const rest = startRest(seconds);
  await setSetting(REST_TIMER_KEY, rest);
  return { done, rest };
}

export async function defaultRestSec(): Promise<number> {
  return (await getSetting<number>(REST_DEFAULT_KEY)) ?? 120;
}

export async function clearRestTimer(): Promise<void> {
  await setSetting(REST_TIMER_KEY, null);
}

export async function setRestTimer(t: RestTimer | null): Promise<void> {
  await setSetting(REST_TIMER_KEY, t);
}

export interface FinishResult {
  session: WorkoutSession;
  records: PRHit[];
  volume_kg: number;
  duration_sec: number;
  energy_kcal?: number;
}

/**
 * Ends a session: drops sets never ticked, totals it, and works out which records it set.
 *
 * The totals are written onto the row so history lists never recompute a year of sessions, but
 * they are only ever a cache of what core/ would say — nothing reads them to make a decision.
 */
export async function finishSession(session_id: string): Promise<FinishResult | undefined> {
  const s = await getSession(session_id);
  if (!s) return undefined;

  // A set left unticked was not performed. Keeping it would put phantom work in the history,
  // and the whole entry goes if nothing in it was done.
  const entries = s.entries
    .map((e) => ({ ...e, sets: e.sets.filter((set) => set.done) }))
    .filter((e) => e.sets.length > 0);

  const ended_at = new Date().toISOString();
  const bodyweight = (await latestWeighIn())?.weight_kg;
  const finished: WorkoutSession = { ...s, entries, ended_at };
  const volume = sessionVolume(finished, bodyweight);
  const duration_sec = sessionDuration(finished);
  const energy_kcal = bodyweight
    ? workoutEnergy({ duration_sec, bodyweight_kg: bodyweight, entries }).kcal
    : undefined;

  // History must not include this session, or it would beat itself.
  const history = (await listSessions()).filter((h) => h.id !== session_id);
  const records = newRecords(finished, history);

  await updateSession(session_id, {
    entries,
    ended_at,
    volume_kg: volume.kg,
    duration_sec,
    ...(energy_kcal != null ? { energy_kcal } : {}),
  });
  await clearRestTimer();
  if (s.routine_id) {
    await updateRoutine(s.routine_id, { last_performed: todayKey() }).catch(() => {});
  }

  const out: FinishResult = {
    session: { ...finished, volume_kg: volume.kg, duration_sec },
    records,
    volume_kg: volume.kg,
    duration_sec,
  };
  if (energy_kcal != null) out.energy_kcal = energy_kcal;
  return out;
}

export interface SessionSummary {
  session: WorkoutSession;
  records: PRHit[];
  volume: ReturnType<typeof sessionVolume>;
  energy?: WorkoutEnergyEstimate;
}

/**
 * Everything a finished session has to say about itself. Recomputed rather than read off the
 * row, so the figures cannot drift from what core/ would say, and so the energy *range* is
 * available — the row stores only the midpoint.
 */
export async function summaryFor(session_id: string): Promise<SessionSummary | undefined> {
  const session = await getSession(session_id);
  if (!session) return undefined;
  const bodyweight = (await latestWeighIn())?.weight_kg;
  const volume = sessionVolume(session, bodyweight);
  // History must exclude this session, or it would beat itself.
  const history = (await listSessions()).filter((h) => h.id !== session_id);
  const out: SessionSummary = { session, records: newRecords(session, history), volume };
  if (bodyweight && session.ended_at) {
    out.energy = workoutEnergy({
      duration_sec: sessionDuration(session),
      bodyweight_kg: bodyweight,
      entries: session.entries,
    });
  }
  return out;
}

/** Throws the session away entirely — for one started by accident. */
export async function discardSession(session_id: string): Promise<void> {
  await deleteSession(session_id);
  await clearRestTimer();
}

/** Sessions from the last `days` days, oldest first: the window every derived figure wants. */
export async function recentSessions(days = 365): Promise<WorkoutSession[]> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  return sessionsSince(from);
}
