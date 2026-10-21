// SPEC §20.14 — a finished workout, as text someone else can read.
//
// Plain text, on purpose. It goes wherever the share sheet sends it — a chat, a note, a group
// of friends — and every one of those renders text the same way, where an image would be a
// picture of numbers nobody can copy and a link would need a server to resolve. Nothing here
// leaves the phone except through the person's own share sheet.
//
// Each exercise gets one line: its working sets and the single set that says most about it. For
// a lift that is the heaviest set, because that is what people ask about; for bodyweight work it
// is the most reps, for a hold the longest, for a carry or a row the furthest.
import { describePR, type PRHit } from './pr';
import { formatClock, formatDuration } from './restTimer';
import { isWorkingSet } from './sets';
import type { WeightUnit, WorkoutEntry, WorkoutSession, WorkoutSet } from './types';
import { formatWeight, toDisplay, UNIT_LABEL } from './weightUnit';

/** "1.2 km", "800 m" — a rower's split is in metres, a run is in kilometres. */
export function formatDistance(m: number): string {
  if (m >= 1000) {
    const km = Math.round(m / 100) / 10;
    return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
  }
  return `${Math.round(m)} m`;
}

function working(e: WorkoutEntry): WorkoutSet[] {
  return e.sets.filter(isWorkingSet);
}

/**
 * The one set worth quoting for an exercise, as text, or undefined when nothing in it was
 * done. Ties go to the earlier set: it was done first, and choosing between equals by anything
 * else would be arbitrary.
 */
export function bestSetText(e: WorkoutEntry, unit: WeightUnit): string | undefined {
  const sets = working(e);
  if (sets.length === 0) return undefined;

  switch (e.load_type) {
    case 'weight_reps': {
      let best: WorkoutSet | undefined;
      for (const s of sets) {
        if (s.weight_kg == null) continue;
        if (
          !best ||
          s.weight_kg > (best.weight_kg ?? 0) ||
          (s.weight_kg === best.weight_kg && (s.reps ?? 0) > (best.reps ?? 0))
        ) {
          best = s;
        }
      }
      if (best?.weight_kg == null) return mostReps(sets);
      return best.reps != null
        ? `${formatWeight(best.weight_kg, unit)} × ${best.reps}`
        : formatWeight(best.weight_kg, unit);
    }
    case 'weighted_bodyweight': {
      // The belt is the figure that moves; reps break a tie. A set with no belt at all reads as
      // plain bodyweight reps, not as "+ 0 kg".
      let best: WorkoutSet | undefined;
      for (const s of sets) {
        const add = s.weight_kg ?? 0;
        const bestAdd = best?.weight_kg ?? 0;
        if (!best || add > bestAdd || (add === bestAdd && (s.reps ?? 0) > (best.reps ?? 0))) {
          best = s;
        }
      }
      const add = best?.weight_kg ?? 0;
      if (add <= 0) return mostReps(sets);
      return `bodyweight + ${formatWeight(add, unit)}${best?.reps != null ? ` × ${best.reps}` : ''}`;
    }
    case 'bodyweight_reps':
      return mostReps(sets);
    case 'time': {
      const longest = Math.max(0, ...sets.map((s) => s.seconds ?? 0));
      return longest > 0 ? formatClock(longest) : undefined;
    }
    case 'distance_time': {
      let best: WorkoutSet | undefined;
      for (const s of sets) {
        if (!best || (s.distance_m ?? 0) > (best.distance_m ?? 0)) best = s;
      }
      const m = best?.distance_m ?? 0;
      const sec = best?.seconds ?? 0;
      if (m > 0 && sec > 0) return `${formatDistance(m)} in ${formatClock(sec)}`;
      if (m > 0) return formatDistance(m);
      if (sec > 0) return formatClock(sec);
      return undefined;
    }
  }
}

function mostReps(sets: readonly WorkoutSet[]): string | undefined {
  const top = Math.max(0, ...sets.map((s) => s.reps ?? 0));
  return top > 0 ? `${top} ${top === 1 ? 'rep' : 'reps'}` : undefined;
}

/** "3 sets · 82.5 kg × 8", or "3 sets" when no single set says anything more. */
export function exerciseLine(e: WorkoutEntry, unit: WeightUnit): string | undefined {
  const n = working(e).length;
  if (n === 0) return undefined;
  const best = bestSetText(e, unit);
  const sets = `${n} ${n === 1 ? 'set' : 'sets'}`;
  return `${e.name} — ${best ? `${sets}, best ${best}` : sets}`;
}

/**
 * Records grouped by exercise, in the order the exercises were done: "Bench press: heaviest
 * ever, best set". One line per exercise rather than per record, since a heavy set usually
 * breaks two or three at once and listing each would bury the point.
 */
export function recordLines(records: readonly PRHit[]): string[] {
  const order: string[] = [];
  const byExercise = new Map<string, { name: string; kinds: string[] }>();
  for (const r of records) {
    let row = byExercise.get(r.exercise_id);
    if (!row) {
      row = { name: r.name, kinds: [] };
      byExercise.set(r.exercise_id, row);
      order.push(r.exercise_id);
    }
    // Lower-case the first letter only, so "1RM" survives.
    const said = describePR(r);
    const label = said.charAt(0).toLowerCase() + said.slice(1);
    if (!row.kinds.includes(label)) row.kinds.push(label);
  }
  return order.map((id) => {
    const row = byExercise.get(id)!;
    return `${row.name}: ${row.kinds.join(', ')}`;
  });
}

export interface WorkoutShareInput {
  session: Pick<WorkoutSession, 'name' | 'entries' | 'duration_sec'>;
  records: readonly PRHit[];
  unit: WeightUnit;
  /** Already formatted for the reader's locale; the screen knows the locale, this does not. */
  date: string;
  /** Tonnage, when it is known and worth quoting. Omitted for a session of holds and runs. */
  volume_kg?: number;
}

/** Thousands grouped with commas, whole units: "6,240". A share is read, not computed with. */
function grouped(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The whole message. */
export function describeWorkout(i: WorkoutShareInput): string {
  const lines = i.session.entries
    .map((e) => exerciseLine(e, i.unit))
    .filter((l): l is string => l != null);
  const sets = i.session.entries.reduce((n, e) => n + working(e).length, 0);

  const facts: string[] = [];
  if (i.session.duration_sec != null && i.session.duration_sec > 0) {
    facts.push(formatDuration(i.session.duration_sec));
  }
  facts.push(`${sets} ${sets === 1 ? 'set' : 'sets'}`);
  if (i.volume_kg != null && i.volume_kg > 0) {
    facts.push(`${grouped(toDisplay(i.volume_kg, i.unit))} ${UNIT_LABEL[i.unit]} lifted`);
  }

  const out = [`${i.session.name} — ${i.date}`, facts.join(' · ')];
  if (lines.length > 0) out.push('', ...lines);
  const records = recordLines(i.records);
  if (records.length > 0) {
    // Counted per record, as the summary screen counts them, though listed per exercise.
    out.push('', i.records.length === 1 ? 'A record' : `${i.records.length} records`);
    out.push(...records.map((r) => `★ ${r}`));
  }
  out.push('', 'Logged with Kalib');
  return out.join('\n');
}
