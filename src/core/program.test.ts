import { describe, expect, it } from 'vitest';
import type { Muscle } from './types';
import {
  MAX_EXERCISES_PER_DAY,
  MAX_SETS_PER_EXERCISE,
  MIN_FREQUENCY,
  PROGRAMMED,
  SETS_PER_EXERCISE,
  WEEKLY_SETS,
  buildProgram,
  frequencyOf,
  type ProgramExercise,
} from './program';

/**
 * A catalogue shaped like a real one: the big compounds with their assisting muscles, plus an
 * isolation per muscle in three kinds of kit. A catalogue of nothing but isolations would make
 * the greedy look worse than it is, because carrying three muscles at once is the whole reason
 * a compound gets picked first.
 */
function catalogue(): ProgramExercise[] {
  const compound = (
    id: string,
    name: string,
    primary: Muscle,
    secondary: Muscle[],
    equipment = 'barbell',
  ): ProgramExercise => ({
    id,
    name,
    primary_muscle: primary,
    secondary_muscles: secondary,
    equipment,
    load_type: 'weight_reps',
    category: 'strength',
  });

  const out: ProgramExercise[] = [
    compound('squat', 'Barbell Squat', 'quads', ['glutes', 'hamstrings']),
    compound('deadlift', 'Barbell Deadlift', 'hamstrings', ['glutes', 'lats', 'upper back']),
    compound('bench', 'Barbell Bench Press', 'chest', ['triceps', 'shoulders']),
    compound('ohp', 'Overhead Press', 'shoulders', ['triceps']),
    compound('row', 'Barbell Row', 'upper back', ['lats', 'biceps']),
    compound('pullup', 'Pull-Up', 'lats', ['biceps', 'upper back'], 'body weight'),
    compound('lunge', 'Dumbbell Lunge', 'glutes', ['quads', 'hamstrings'], 'dumbbell'),
    compound('dip', 'Dip', 'triceps', ['chest', 'shoulders'], 'body weight'),
  ];

  let n = 0;
  for (const m of PROGRAMMED) {
    for (const kit of ['barbell', 'dumbbell', 'cable']) {
      n++;
      out.push({
        id: `iso${String(n).padStart(3, '0')}`,
        name: `${kit} ${m}`,
        primary_muscle: m,
        equipment: kit,
        load_type: 'weight_reps',
        category: 'strength',
      });
    }
  }
  return out;
}

const DAYS = [2, 3, 4, 5, 6] as const;

describe('the shape of the week', () => {
  it.each(DAYS)('%i days produces that many sessions', (days) => {
    expect(buildProgram(catalogue(), { days }).days).toHaveLength(days);
  });

  it.each(DAYS)('%i days trains every programmed muscle at least twice', (days) => {
    // The constraint the splits were built against. Three days is three full-body days for
    // exactly this reason: push/pull/legs over three days would be once each.
    const freq = frequencyOf(buildProgram(catalogue(), { days }));
    for (const m of PROGRAMMED) {
      expect(freq.get(m) ?? 0, `${m} on ${days} days`).toBeGreaterThanOrEqual(MIN_FREQUENCY);
    }
  });

  it('three days is full body, not push/pull/legs', () => {
    const p = buildProgram(catalogue(), { days: 3 });
    expect(p.days.map((d) => d.name)).toEqual(['Full body A', 'Full body B', 'Full body C']);
  });

  it('six days is push/pull/legs twice, because then it is twice', () => {
    expect(buildProgram(catalogue(), { days: 6 }).days.map((d) => d.name)).toEqual([
      'Push A',
      'Pull A',
      'Legs A',
      'Push B',
      'Pull B',
      'Legs B',
    ]);
  });

  it('does not letter a day that only happens once', () => {
    const names = buildProgram(catalogue(), { days: 5 }).days.map((d) => d.name);
    expect(names).toContain('Push');
    expect(names).toContain('Upper');
    expect(names.filter((n) => n.endsWith(' A'))).toEqual([]);
  });

  it('clamps a silly number of days into the range it knows', () => {
    expect(buildProgram(catalogue(), { days: 99 }).days).toHaveLength(6);
    expect(buildProgram(catalogue(), { days: 0 }).days).toHaveLength(2);
  });
});

describe('what lands in a session', () => {
  it('keeps a session to a sane length', () => {
    for (const day of buildProgram(catalogue(), { days: 2 }).days) {
      expect(day.items.length).toBeLessThanOrEqual(MAX_EXERCISES_PER_DAY);
      expect(day.items.length).toBeGreaterThan(0);
    }
  });

  it('never repeats an exercise inside one session', () => {
    for (const day of buildProgram(catalogue(), { days: 4 }).days) {
      const ids = day.items.map((i) => i.exercise_id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('starts every exercise at the standard sets and tops up only to the cap', () => {
    // Volume still owed after one movement per muscle becomes sets on what is already there,
    // which is why these are a range rather than a number.
    const p = buildProgram(catalogue(), { days: 3 });
    for (const d of p.days) {
      for (const i of d.items) {
        expect(i.sets).toBeGreaterThanOrEqual(SETS_PER_EXERCISE);
        expect(i.sets).toBeLessThanOrEqual(MAX_SETS_PER_EXERCISE);
      }
    }
  });

  it('gives each muscle one movement a day, not four variations of the same lift', () => {
    // A leg day of back squat, front squat, overhead squat and goblet squat was the first
    // thing this module produced, and it is the thing the rule exists to stop.
    const by = new Map<string, number>();
    for (const day of buildProgram(catalogue(), { days: 4 }).days) {
      by.clear();
      for (const it of day.items) {
        const e = catalogue().find((x) => x.id === it.exercise_id);
        if (!e) continue;
        by.set(e.primary_muscle, (by.get(e.primary_muscle) ?? 0) + 1);
      }
      for (const [m, n] of by) expect(n, `${m} in ${day.name}`).toBe(1);
    }
  });

  it('asks fewer reps and longer rest of a compound than an isolation', () => {
    const p = buildProgram(catalogue(), { days: 6 });
    const all = p.days.flatMap((d) => d.items);
    const squat = all.find((i) => i.exercise_id === 'squat');
    const iso = all.find((i) => i.exercise_id.startsWith('iso'));
    expect(squat?.rep_high).toBe(10);
    expect(squat?.rest_sec).toBe(180);
    expect(iso?.rep_high).toBe(15);
    expect(iso?.rest_sec).toBe(90);
  });

  it('prefers the compound, because it closes more of the day at once', () => {
    const p = buildProgram(catalogue(), { days: 6 });
    const legs = p.days.find((d) => d.name === 'Legs A');
    // A squat or a lunge carries three leg muscles at once; an isolation carries one, so it
    // cannot be what a leg day opens with. Which compound wins is a tie broken on id, and
    // asserting that would be asserting the tie-break rather than the rule.
    expect(legs?.items[0]?.exercise_id.startsWith('iso')).toBe(false);
    expect(legs?.items[0]?.exercise_id).toBe('lunge');
  });

  it('varies the second instance of a day from the first', () => {
    const p = buildProgram(catalogue(), { days: 4 });
    const a = p.days.find((d) => d.name === 'Upper A')?.items.map((i) => i.exercise_id) ?? [];
    const b = p.days.find((d) => d.name === 'Upper B')?.items.map((i) => i.exercise_id) ?? [];
    expect(a.length).toBeGreaterThan(0);
    // Not required to be disjoint — a catalogue may be thin — but it must not be identical.
    expect(b).not.toEqual(a);
  });
});

describe('volume', () => {
  it('lands every muscle inside a sane weekly range', () => {
    const p = buildProgram(catalogue(), { days: 4 });
    const by = new Map(p.weekly.map((w) => [w.muscle, w.sets]));
    for (const m of PROGRAMMED) {
      const sets = by.get(m) ?? 0;
      expect(sets, `${m}`).toBeGreaterThan(0);
      // Generous on the top: assisting work legitimately pushes a muscle past its own target.
      expect(sets, `${m}`).toBeLessThanOrEqual(WEEKLY_SETS * 2.5);
    }
  });

  it('respects a smaller weekly target by programming less', () => {
    const big = buildProgram(catalogue(), { days: 3, weeklySets: 18 });
    const small = buildProgram(catalogue(), { days: 3, weeklySets: 6 });
    const total = (p: typeof big) => p.days.reduce((n, d) => n + d.items.length, 0);
    expect(total(small)).toBeLessThan(total(big));
  });
});

describe('what it will not pretend to cover', () => {
  it('uses only the equipment allowed', () => {
    const p = buildProgram(catalogue(), { days: 3, equipment: ['dumbbell'] });
    const names = p.days.flatMap((d) => d.items.map((i) => i.name));
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n === 'Dumbbell Lunge' || n.startsWith('dumbbell')).toBe(true);
  });

  it('names the muscles it could not cover rather than quietly dropping them', () => {
    // A catalogue of nothing but a bench press cannot train legs, and says so.
    const thin: ProgramExercise[] = [
      {
        id: 'bench',
        name: 'Barbell Bench Press',
        primary_muscle: 'chest',
        secondary_muscles: ['triceps'],
        equipment: 'barbell',
        load_type: 'weight_reps',
        category: 'strength',
      },
    ];
    const p = buildProgram(thin, { days: 3 });
    expect(p.uncovered).toContain('quads');
    expect(p.uncovered).toContain('lats');
    expect(p.uncovered).not.toContain('chest');
    expect(p.uncovered).not.toContain('triceps');
  });

  it('reports everything uncovered when nothing matches the equipment', () => {
    const p = buildProgram(catalogue(), { days: 3, equipment: ['spoon'] });
    expect(p.uncovered.sort()).toEqual([...PROGRAMMED].sort());
    for (const d of p.days) expect(d.items).toEqual([]);
  });

  it('will not program a stretch in place of a set', () => {
    const stretches: ProgramExercise[] = PROGRAMMED.map((m, i) => ({
      id: `s${i}`,
      name: `${m} stretch`,
      primary_muscle: m,
      equipment: 'body weight',
      load_type: 'time',
      category: 'stretching',
    }));
    const p = buildProgram(stretches, { days: 3 });
    expect(p.days.flatMap((d) => d.items)).toEqual([]);
    expect(p.uncovered.sort()).toEqual([...PROGRAMMED].sort());
  });

  it('does not count cardio or neck as something it owes you', () => {
    const p = buildProgram(catalogue(), { days: 3 });
    expect(p.uncovered).not.toContain('cardio' as Muscle);
    expect(p.uncovered).not.toContain('neck' as Muscle);
  });
});

describe('determinism', () => {
  it('builds the same program twice, so regenerating does not reshuffle your training', () => {
    const a = buildProgram(catalogue(), { days: 5 });
    const b = buildProgram(catalogue(), { days: 5 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not depend on the order the catalogue arrives in', () => {
    const forward = buildProgram(catalogue(), { days: 4 });
    const backward = buildProgram(catalogue().reverse(), { days: 4 });
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
  });
});

describe('what it chooses from', () => {
  it('leaves out movements the library calls advanced', () => {
    const hard: ProgramExercise[] = PROGRAMMED.map((m, i) => ({
      id: `adv${i}`,
      name: `${m} heroics`,
      primary_muscle: m,
      equipment: 'barbell',
      load_type: 'weight_reps',
      category: 'strength',
      difficulty: 'advanced',
    }));
    expect(buildProgram(hard, { days: 3 }).days.flatMap((d) => d.items)).toEqual([]);
    // ...unless asked for
    expect(
      buildProgram(hard, { days: 3, advanced: true }).days.flatMap((d) => d.items).length,
    ).toBeGreaterThan(0);
  });

  it('ignores equipment a gym is unlikely to have, unless asked', () => {
    const odd: ProgramExercise[] = PROGRAMMED.map((m, i) => ({
      id: `tyre${i}`,
      name: `${m} tyre flip`,
      primary_muscle: m,
      equipment: 'tire',
      load_type: 'weight_reps',
      category: 'strength',
    }));
    expect(buildProgram(odd, { days: 3 }).uncovered.sort()).toEqual([...PROGRAMMED].sort());
    expect(buildProgram(odd, { days: 3, equipment: ['tire'] }).uncovered).toEqual([]);
  });

  it('prefers a named movement over one that merely scores well', () => {
    // The staple claims one assisting muscle; the impostor claims three and would otherwise
    // win on points. This is the whole reason the list exists.
    const rival: ProgramExercise[] = [
      {
        id: 'staple',
        name: 'Barbell Bench Press',
        primary_muscle: 'chest',
        secondary_muscles: ['triceps'],
        equipment: 'barbell',
        load_type: 'weight_reps',
        category: 'strength',
      },
      {
        id: 'impostor',
        name: 'Clap Push Up To Box Jump',
        primary_muscle: 'chest',
        secondary_muscles: ['triceps', 'shoulders', 'abs'],
        equipment: 'body weight',
        load_type: 'weight_reps',
        category: 'strength',
      },
    ];
    const p = buildProgram(rival, { days: 3 });
    const ids = p.days.flatMap((d) => d.items.map((i) => i.exercise_id));
    expect(ids).toContain('staple');
    expect(ids).not.toContain('impostor');
  });

  it('does not pay an exercise for more than two assisting muscles', () => {
    // A strongman car flip lists six. Paid in full it outranks a bench press, which is
    // exactly what it used to do.
    const greedy: ProgramExercise = {
      id: 'flip',
      name: 'Strongman Car Flip',
      primary_muscle: 'glutes',
      secondary_muscles: ['hamstrings', 'quads', 'calves', 'upper back', 'biceps', 'abs'],
      equipment: 'barbell',
      load_type: 'weight_reps',
      category: 'strength',
    };
    const p = buildProgram([...catalogue(), greedy], { days: 3 });
    const freq = frequencyOf(p);
    // Whatever it picks, nothing may end up trained only by that one movement's generosity.
    for (const m of PROGRAMMED) expect(freq.get(m) ?? 0).toBeGreaterThanOrEqual(MIN_FREQUENCY);
  });
});
