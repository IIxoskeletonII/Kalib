import { describe, expect, it } from 'vitest';
import { buildExerciseDoc, exerciseMatchQuality, searchExercises } from './exerciseSearch';
import type { Exercise, ExerciseCategory, Muscle } from './types';

function doc(
  name: string,
  o: {
    aliases?: string[];
    equipment?: string;
    primary_muscle?: Muscle;
    category?: ExerciseCategory;
    source?: Exercise['source'];
  } = {},
) {
  return buildExerciseDoc({
    id: name,
    name,
    aliases: o.aliases,
    equipment: o.equipment ?? 'barbell',
    primary_muscle: o.primary_muscle ?? 'chest',
    category: o.category ?? 'strength',
    source: o.source ?? 'library',
  });
}

const BENCHES = [
  doc('Barbell Bench Press', { aliases: ['bench', 'flat bench'] }),
  doc('Barbell Reverse Grip Decline Bench Press'),
  doc('Barbell Incline Bench Press', { aliases: ['incline bench'] }),
  doc('Dumbbell Bench Press', { equipment: 'dumbbell', aliases: ['db bench'] }),
  doc('Barbell Guillotine Bench Press'),
];

const names = (hits: { name: string }[]) => hits.map((h) => h.name);

describe('searchExercises', () => {
  it('puts the plain movement first, not the longest name that contains it', () => {
    expect(names(searchExercises(BENCHES, 'bench'))[0]).toBe('Barbell Bench Press');
  });

  it('still finds the qualified lift when the qualifier is typed', () => {
    expect(names(searchExercises(BENCHES, 'incline bench'))[0]).toBe('Barbell Incline Bench Press');
    expect(names(searchExercises(BENCHES, 'decline bench'))[0]).toBe(
      'Barbell Reverse Grip Decline Bench Press',
    );
  });

  it('requires every word to land somewhere', () => {
    expect(searchExercises(BENCHES, 'bench zugzwang')).toEqual([]);
  });

  it('finds by alias but shows the catalogue name', () => {
    const hits = searchExercises(BENCHES, 'db bench');
    expect(hits[0]!.name).toBe('Dumbbell Bench Press');
  });

  it('matches a plural against a singular name and the reverse', () => {
    const d = [
      doc('Barbell Lunge', { primary_muscle: 'quads' }),
      doc('Barbell Curl', { primary_muscle: 'biceps' }),
    ];
    expect(names(searchExercises(d, 'lunges'))).toContain('Barbell Lunge');
    expect(names(searchExercises(d, 'curl'))).toContain('Barbell Curl');
  });

  it("ranks the user's own exercise above a library one that matches as well", () => {
    const base = {
      name: 'Cable Fly',
      equipment: 'cable',
      primary_muscle: 'chest' as const,
      category: 'strength' as const,
    };
    // Identical names, so only the custom boost can break the tie.
    const hits = searchExercises(
      [
        buildExerciseDoc({ ...base, id: 'lib', source: 'library' }),
        buildExerciseDoc({ ...base, id: 'mine', source: 'custom' }),
      ],
      'cable fly',
    );
    expect(hits[0]!.id).toBe('mine');
  });

  it('prefers what you actually log', () => {
    const d = [
      doc('Barbell Squat', { primary_muscle: 'quads' }),
      doc('Barbell Squat Jump', { primary_muscle: 'quads' }),
    ];
    const usage = new Map([['Barbell Squat Jump', 40]]);
    expect(names(searchExercises(d, 'squat', usage))[0]).toBe('Barbell Squat Jump');
  });

  it('prefers strength over a stretch of the same name', () => {
    const d = [
      doc('Chest Stretch', { category: 'stretching' }),
      doc('Chest Press', { category: 'strength' }),
    ];
    expect(names(searchExercises(d, 'chest'))[0]).toBe('Chest Press');
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(searchExercises(BENCHES, '')).toEqual([]);
    expect(searchExercises(BENCHES, '   ')).toEqual([]);
  });

  it('respects the limit', () => {
    expect(searchExercises(BENCHES, 'bench', new Map(), 2)).toHaveLength(2);
  });
});

describe('exerciseMatchQuality', () => {
  it('is 3 for an exact full-name match', () => {
    expect(exerciseMatchQuality(doc('Barbell Bench Press'), 'barbell bench press')).toBeCloseTo(
      3 - (0.05 + 0.1) / 3,
      5,
    );
  });

  it('is 0 when any word misses, so grounding cannot half-match', () => {
    expect(exerciseMatchQuality(doc('Barbell Bench Press'), 'barbell zugzwang')).toBe(0);
    expect(exerciseMatchQuality(doc('Barbell Bench Press'), '')).toBe(0);
  });

  it('scores a match near the front of the name above the same word buried in it', () => {
    // The thing that decides a grounding: "bench" means the bench press, not the reverse-grip
    // decline variant that merely contains the word.
    expect(exerciseMatchQuality(doc('Barbell Bench Press'), 'bench')).toBeGreaterThan(
      exerciseMatchQuality(doc('Barbell Reverse Grip Decline Bench Press'), 'bench'),
    );
  });
});
