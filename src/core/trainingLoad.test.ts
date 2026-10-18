import { describe, expect, it } from 'vitest';
import type { Muscle, WorkoutEntry, WorkoutSession, WorkoutSet } from './types';
import {
  MAX_SETS,
  MIN_SETS,
  SECONDARY_WEIGHT,
  musclesCovered,
  trainingLoad,
  type MuscleMap,
} from './trainingLoad';

const MONDAY = new Date(2026, 9, 12); // 12 Oct 2026 is a Monday

const done: WorkoutSet = { kind: 'normal', done: true, weight_kg: 60, reps: 8 };

function entry(exercise_id: string, sets: number): WorkoutEntry {
  return {
    exercise_id,
    name: exercise_id,
    load_type: 'weight_reps',
    sets: Array.from({ length: sets }, () => ({ ...done })),
  };
}

/** A finished session on a given day of the week, 0 being the Monday. */
function session(dayOffset: number, entries: WorkoutEntry[]): WorkoutSession {
  const start = new Date(MONDAY);
  start.setDate(start.getDate() + dayOffset);
  start.setHours(18, 0, 0, 0);
  const end = new Date(start);
  end.setHours(19, 0, 0, 0);
  return {
    id: `s${dayOffset}-${entries.map((e) => e.exercise_id).join('-')}`,
    user_id: 'u',
    created_at: start.toISOString(),
    updated_at: start.toISOString(),
    started_at: start.toISOString(),
    ended_at: end.toISOString(),
    name: 'session',
    entries,
  };
}

const CATALOGUE = new Map<string, MuscleMap>([
  ['bench', { primary_muscle: 'chest', secondary_muscles: ['triceps', 'shoulders'] }],
  ['row', { primary_muscle: 'lats', secondary_muscles: ['biceps', 'upper back'] }],
  ['squat', { primary_muscle: 'quads', secondary_muscles: ['glutes'] }],
  ['curl', { primary_muscle: 'biceps' }],
  ['run', { primary_muscle: 'cardio' }],
  ['selfie', { primary_muscle: 'chest', secondary_muscles: ['chest'] }],
]);

const load = (sessions: WorkoutSession[], expected?: Muscle[]) =>
  trainingLoad(sessions, CATALOGUE, { from: MONDAY, ...(expected ? { expected } : {}) });

describe('trainingLoad', () => {
  it('counts a primary muscle a whole set and an assisting one a half', () => {
    const r = load([session(0, [entry('bench', 4)])]);
    const chest = r.muscles.find((m) => m.muscle === 'chest');
    const triceps = r.muscles.find((m) => m.muscle === 'triceps');
    expect(chest?.sets).toBe(4);
    expect(chest?.direct_sets).toBe(4);
    expect(triceps?.sets).toBe(4 * SECONDARY_WEIGHT);
    // and the assisting muscle got no direct work at all, which is worth keeping separate
    expect(triceps?.direct_sets).toBe(0);
  });

  it('adds the same muscle across exercises and days', () => {
    const r = load([
      session(0, [entry('row', 4)]), // biceps 2 (secondary)
      session(3, [entry('curl', 3)]), // biceps 3 (primary)
    ]);
    const biceps = r.muscles.find((m) => m.muscle === 'biceps');
    expect(biceps?.sets).toBe(5);
    expect(biceps?.direct_sets).toBe(3);
    expect(biceps?.days).toBe(2);
  });

  it('counts a muscle once per day however many exercises hit it', () => {
    const r = load([session(0, [entry('bench', 3), entry('selfie', 3)])]);
    expect(r.muscles.find((m) => m.muscle === 'chest')?.days).toBe(1);
  });

  it('does not let an exercise count itself twice as its own assistant', () => {
    // A badly catalogued exercise listing its primary muscle again as secondary should not
    // get one and a half sets out of one.
    const r = load([session(0, [entry('selfie', 4)])]);
    expect(r.muscles.find((m) => m.muscle === 'chest')?.sets).toBe(4);
  });

  it('ignores warm-ups and sets that were never ticked', () => {
    const mixed: WorkoutEntry = {
      exercise_id: 'bench',
      name: 'bench',
      load_type: 'weight_reps',
      sets: [
        { kind: 'warmup', done: true, weight_kg: 40, reps: 10 },
        { kind: 'normal', done: false, weight_kg: 60, reps: 8 },
        { ...done },
      ],
    };
    expect(load([session(0, [mixed])]).muscles.find((m) => m.muscle === 'chest')?.sets).toBe(1);
  });

  it('leaves out a session still running', () => {
    const running = session(0, [entry('bench', 5)]);
    delete running.ended_at;
    expect(load([running]).muscles).toEqual([]);
  });

  it('leaves out sessions from before the week', () => {
    expect(load([session(-3, [entry('bench', 5)])]).muscles).toEqual([]);
  });

  it('reports work it cannot attribute rather than dropping it', () => {
    const r = load([session(0, [entry('bench', 3), entry('mystery-machine', 4)])]);
    expect(r.unknown_sets).toBe(4);
    expect(r.muscles.find((m) => m.muscle === 'chest')?.sets).toBe(3);
  });

  it('does not treat cardio as a muscle with a weekly dose', () => {
    const r = load([session(0, [entry('run', 6)])]);
    expect(r.muscles).toEqual([]);
    expect(r.under).toEqual([]);
  });

  it('orders muscles by how much work they got', () => {
    const r = load([session(0, [entry('squat', 6), entry('curl', 2)])]);
    expect(r.muscles[0]?.muscle).toBe('quads');
  });

  it('reports the Monday it counted from', () => {
    expect(load([]).from).toBe('2026-10-12');
  });
});

describe('coverage', () => {
  it('flags a muscle trained below the band', () => {
    const r = load([session(0, [entry('curl', 4)])]);
    expect(r.under).toContain('biceps');
    expect(r.over).toEqual([]);
  });

  it('does not flag a muscle inside the band', () => {
    const r = load([
      session(0, [entry('curl', MIN_SETS)]),
      session(2, [entry('curl', 1)]), // across two days, so not concentrated either
    ]);
    expect(r.under).not.toContain('biceps');
    expect(r.concentrated).not.toContain('biceps');
  });

  it('flags a muscle over the band', () => {
    const r = load([session(0, [entry('curl', MAX_SETS)]), session(2, [entry('curl', 2)])]);
    expect(r.over).toContain('biceps');
  });

  it('flags enough sets crammed into a single day', () => {
    const r = load([session(0, [entry('curl', MIN_SETS + 2)])]);
    expect(r.concentrated).toContain('biceps');
    // it is a frequency problem, not a volume one
    expect(r.under).not.toContain('biceps');
  });

  it('does not call a muscle concentrated when it is merely undertrained', () => {
    const r = load([session(0, [entry('curl', 3)])]);
    expect(r.concentrated).toEqual([]);
  });

  it('says nothing about untrained muscles unless asked what to expect', () => {
    expect(load([session(0, [entry('curl', 4)])]).untrained).toEqual([]);
  });

  it('names the expected muscles that got no work', () => {
    const r = load([session(0, [entry('curl', 4)])], ['biceps', 'quads', 'calves']);
    expect(r.untrained).toEqual(['quads', 'calves']);
  });

  it('never expects cardio', () => {
    expect(load([], ['cardio']).untrained).toEqual([]);
  });
});

describe('musclesCovered', () => {
  it('lists what a set of routines means to train', () => {
    expect(musclesCovered([{ exercise_id: 'bench' }, { exercise_id: 'squat' }], CATALOGUE)).toEqual(
      ['chest', 'quads'],
    );
  });

  it('skips cardio and anything the catalogue does not know', () => {
    expect(musclesCovered([{ exercise_id: 'run' }, { exercise_id: 'nope' }], CATALOGUE)).toEqual(
      [],
    );
  });
});
