import { describe, expect, it } from 'vitest';
import type { PRHit } from './pr';
import type { LoadType, WorkoutEntry, WorkoutSet } from './types';
import { KG_PER_LB } from './weightUnit';
import {
  bestSetText,
  describeWorkout,
  exerciseLine,
  formatDistance,
  recordLines,
} from './workoutShare';

const set = (p: Partial<WorkoutSet>): WorkoutSet => ({ kind: 'normal', done: true, ...p });

function entry(name: string, load_type: LoadType, sets: WorkoutSet[], id = name): WorkoutEntry {
  return { exercise_id: id, name, load_type, sets };
}

const hit = (p: Partial<PRHit>): PRHit => ({
  exercise_id: 'bench',
  name: 'Bench press',
  kind: 'weight',
  value: 100,
  previous: 95,
  ...p,
});

describe('formatDistance', () => {
  it('reads metres below a kilometre and kilometres above', () => {
    expect(formatDistance(800)).toBe('800 m');
    expect(formatDistance(999.6)).toBe('1000 m');
    expect(formatDistance(1000)).toBe('1 km');
    expect(formatDistance(1250)).toBe('1.3 km');
    expect(formatDistance(5000)).toBe('5 km');
    expect(formatDistance(21097)).toBe('21.1 km');
  });
});

describe('bestSetText — weight and reps', () => {
  it('quotes the heaviest set', () => {
    const e = entry('Bench press', 'weight_reps', [
      set({ weight_kg: 80, reps: 10 }),
      set({ weight_kg: 85, reps: 6 }),
      set({ weight_kg: 82.5, reps: 8 }),
    ]);
    expect(bestSetText(e, 'kg')).toBe('85 kg × 6');
  });

  it('breaks a tie on weight with reps', () => {
    const e = entry('Bench press', 'weight_reps', [
      set({ weight_kg: 85, reps: 5 }),
      set({ weight_kg: 85, reps: 7 }),
      set({ weight_kg: 85, reps: 6 }),
    ]);
    expect(bestSetText(e, 'kg')).toBe('85 kg × 7');
  });

  it('keeps the half kilo a bar can hold', () => {
    const e = entry('Bench press', 'weight_reps', [set({ weight_kg: 82.5, reps: 8 })]);
    expect(bestSetText(e, 'kg')).toBe('82.5 kg × 8');
  });

  it('speaks pounds when the phone does', () => {
    const e = entry('Squat', 'weight_reps', [set({ weight_kg: 225 * KG_PER_LB, reps: 5 })]);
    expect(bestSetText(e, 'lb')).toBe('225 lb × 5');
  });

  it('ignores warm-ups and sets never ticked', () => {
    const e = entry('Squat', 'weight_reps', [
      set({ kind: 'warmup', weight_kg: 140, reps: 1 }),
      set({ weight_kg: 150, reps: 3, done: false }),
      set({ weight_kg: 120, reps: 5 }),
    ]);
    expect(bestSetText(e, 'kg')).toBe('120 kg × 5');
  });

  it('falls back to reps when no weight was entered', () => {
    const e = entry('Cable fly', 'weight_reps', [set({ reps: 12 }), set({ reps: 15 })]);
    expect(bestSetText(e, 'kg')).toBe('15 reps');
  });

  it('prints a weight alone when reps were never filled in', () => {
    const e = entry('Farmer hold', 'weight_reps', [set({ weight_kg: 40 })]);
    expect(bestSetText(e, 'kg')).toBe('40 kg');
  });

  it('says nothing when nothing was done', () => {
    const e = entry('Bench press', 'weight_reps', [set({ weight_kg: 80, reps: 8, done: false })]);
    expect(bestSetText(e, 'kg')).toBeUndefined();
    expect(bestSetText(entry('Empty', 'weight_reps', []), 'kg')).toBeUndefined();
  });
});

describe('bestSetText — bodyweight', () => {
  it('quotes the most reps for bodyweight work', () => {
    const e = entry('Pull-up', 'bodyweight_reps', [
      set({ reps: 8 }),
      set({ reps: 10 }),
      set({ reps: 7 }),
    ]);
    expect(bestSetText(e, 'kg')).toBe('10 reps');
  });

  it('says rep, not reps, for one', () => {
    expect(bestSetText(entry('Muscle-up', 'bodyweight_reps', [set({ reps: 1 })]), 'kg')).toBe(
      '1 rep',
    );
  });

  it('never quotes a body weight it does not know', () => {
    // bodyweight_reps carries no load; even a stray weight on the row must not be printed.
    const e = entry('Push-up', 'bodyweight_reps', [set({ reps: 20, weight_kg: 80 })]);
    expect(bestSetText(e, 'kg')).toBe('20 reps');
  });

  it('quotes the belt for weighted bodyweight work', () => {
    const e = entry('Dip', 'weighted_bodyweight', [
      set({ weight_kg: 10, reps: 8 }),
      set({ weight_kg: 15, reps: 5 }),
      set({ weight_kg: 15, reps: 6 }),
    ]);
    expect(bestSetText(e, 'kg')).toBe('bodyweight + 15 kg × 6');
  });

  it('reads an unbelted weighted-bodyweight session as plain reps', () => {
    const e = entry('Chin-up', 'weighted_bodyweight', [
      set({ reps: 9 }),
      set({ weight_kg: 0, reps: 11 }),
    ]);
    expect(bestSetText(e, 'kg')).toBe('11 reps');
  });

  it('prefers a belted set over more reps without one', () => {
    const e = entry('Chin-up', 'weighted_bodyweight', [
      set({ reps: 12 }),
      set({ weight_kg: 5, reps: 6 }),
    ]);
    expect(bestSetText(e, 'lb')).toBe('bodyweight + 11 lb × 6');
  });
});

describe('bestSetText — time and distance', () => {
  it('quotes the longest hold', () => {
    const e = entry('Plank', 'time', [set({ seconds: 60 }), set({ seconds: 95 })]);
    expect(bestSetText(e, 'kg')).toBe('1:35');
  });

  it('says nothing for a hold with no time', () => {
    expect(bestSetText(entry('Plank', 'time', [set({})]), 'kg')).toBeUndefined();
  });

  it('quotes the furthest effort with its time', () => {
    const e = entry('Row', 'distance_time', [
      set({ distance_m: 500, seconds: 100 }),
      set({ distance_m: 2000, seconds: 470 }),
    ]);
    expect(bestSetText(e, 'kg')).toBe('2 km in 7:50');
  });

  it('copes with distance or time alone', () => {
    expect(bestSetText(entry('Walk', 'distance_time', [set({ distance_m: 800 })]), 'kg')).toBe(
      '800 m',
    );
    expect(bestSetText(entry('Bike', 'distance_time', [set({ seconds: 600 })]), 'kg')).toBe(
      '10:00',
    );
    expect(bestSetText(entry('Bike', 'distance_time', [set({})]), 'kg')).toBeUndefined();
  });
});

describe('exerciseLine', () => {
  it('counts working sets and quotes the best', () => {
    const e = entry('Bench press', 'weight_reps', [
      set({ kind: 'warmup', weight_kg: 40, reps: 10 }),
      set({ weight_kg: 80, reps: 8 }),
      set({ weight_kg: 80, reps: 7 }),
    ]);
    expect(exerciseLine(e, 'kg')).toBe('Bench press — 2 sets, best 80 kg × 8');
  });

  it('says set, not sets, for one', () => {
    const e = entry('Deadlift', 'weight_reps', [set({ weight_kg: 180, reps: 3 })]);
    expect(exerciseLine(e, 'kg')).toBe('Deadlift — 1 set, best 180 kg × 3');
  });

  it('counts sets even when none says anything more', () => {
    const e = entry('Plank', 'time', [set({}), set({})]);
    expect(exerciseLine(e, 'kg')).toBe('Plank — 2 sets');
  });

  it('leaves out an exercise nothing was done on', () => {
    const e = entry('Bench press', 'weight_reps', [set({ weight_kg: 80, reps: 8, done: false })]);
    expect(exerciseLine(e, 'kg')).toBeUndefined();
  });
});

describe('recordLines', () => {
  it('groups records by exercise in the order they were set', () => {
    const lines = recordLines([
      hit({ exercise_id: 'squat', name: 'Squat', kind: 'weight' }),
      hit({ kind: 'weight' }),
      hit({ exercise_id: 'squat', name: 'Squat', kind: 'e1rm' }),
      hit({ kind: 'set_volume' }),
    ]);
    expect(lines).toEqual([
      'Squat: heaviest ever, best estimated 1RM',
      'Bench press: heaviest ever, best set',
    ]);
  });

  it('names a repeated kind once', () => {
    // Two rep records at two different weights are both "most reps at this weight".
    const lines = recordLines([
      hit({ kind: 'reps', value: 9, previous: 8 }),
      hit({ kind: 'reps', value: 6, previous: 5 }),
    ]);
    expect(lines).toEqual(['Bench press: most reps at this weight']);
  });

  it('is empty without records', () => {
    expect(recordLines([])).toEqual([]);
  });
});

describe('describeWorkout', () => {
  const session = {
    name: 'Push A',
    duration_sec: 52 * 60,
    entries: [
      entry('Bench press', 'weight_reps', [
        set({ weight_kg: 80, reps: 8 }),
        set({ weight_kg: 82.5, reps: 6 }),
      ]),
      entry('Dip', 'bodyweight_reps', [set({ reps: 12 }), set({ reps: 10 })]),
      entry('Plank', 'time', [set({ seconds: 75 })]),
    ],
  };

  it('writes the whole message', () => {
    const text = describeWorkout({
      session,
      records: [hit({ kind: 'weight' })],
      unit: 'kg',
      date: 'Tuesday 21 October',
      volume_kg: 6240,
    });
    expect(text).toBe(
      [
        'Push A — Tuesday 21 October',
        '52m · 5 sets · 6,240 kg lifted',
        '',
        'Bench press — 2 sets, best 82.5 kg × 6',
        'Dip — 2 sets, best 12 reps',
        'Plank — 1 set, best 1:15',
        '',
        'A record',
        '★ Bench press: heaviest ever',
        '',
        'Logged with Kalib',
      ].join('\n'),
    );
  });

  it('counts every record but lists one line per exercise', () => {
    const text = describeWorkout({
      session,
      records: [hit({ kind: 'weight' }), hit({ kind: 'e1rm' })],
      unit: 'kg',
      date: 'Tue',
    });
    expect(text).toContain('2 records\n★ Bench press: heaviest ever, best estimated 1RM');
  });

  it('leaves out the records block when there are none', () => {
    const text = describeWorkout({ session, records: [], unit: 'kg', date: 'Tue' });
    expect(text).not.toContain('record');
    expect(text).not.toContain('★');
  });

  it('converts the tonnage to pounds', () => {
    const text = describeWorkout({
      session,
      records: [],
      unit: 'lb',
      date: 'Tue',
      volume_kg: 1000,
    });
    expect(text).toContain('2,205 lb lifted');
    expect(text).toContain('Bench press — 2 sets, best 181.9 lb × 6');
  });

  it('leaves out a tonnage of nothing, as a session of holds would have', () => {
    const text = describeWorkout({
      session: { ...session, entries: [session.entries[2]!] },
      records: [],
      unit: 'kg',
      date: 'Tue',
      volume_kg: 0,
    });
    expect(text.split('\n')[1]).toBe('52m · 1 set');
  });

  it('leaves out a duration it does not have', () => {
    const noDuration = { name: session.name, entries: session.entries };
    const text = describeWorkout({ session: noDuration, records: [], unit: 'kg', date: 'Tue' });
    expect(text.split('\n')[1]).toBe('5 sets');
  });

  it('still makes sense for a session where nothing was ticked', () => {
    const text = describeWorkout({
      session: { name: 'Legs', entries: [entry('Squat', 'weight_reps', [set({ done: false })])] },
      records: [],
      unit: 'kg',
      date: 'Tue',
    });
    expect(text).toBe(['Legs — Tue', '0 sets', '', 'Logged with Kalib'].join('\n'));
  });

  it('groups large tonnages', () => {
    const text = describeWorkout({
      session,
      records: [],
      unit: 'kg',
      date: 'Tue',
      volume_kg: 1234567.4,
    });
    expect(text).toContain('1,234,567 kg lifted');
  });
});
