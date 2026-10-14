import { describe, expect, it } from 'vitest';
import { MUSCLE_LABEL, MUSCLE_REGIONS, normaliseMuscle, normaliseMuscles } from './muscles';
import { MUSCLES, type Muscle } from './types';

describe('normaliseMuscle', () => {
  it('maps the library synonyms onto one muscle', () => {
    for (const same of [
      ['quads', 'quadriceps'],
      ['delts', 'deltoids', 'shoulders', 'rear deltoids'],
      ['traps', 'trapezius', 'upper trapezius'],
      ['abs', 'abdominals', 'core', 'lower abs'],
      ['lats', 'latissimus dorsi'],
      ['calves', 'gastrocnemius', 'soleus'],
      ['pectorals', 'chest', 'upper chest'],
    ]) {
      const resolved = same.map(normaliseMuscle);
      expect(new Set(resolved).size, `${same.join(' / ')} disagreed: ${resolved.join(', ')}`).toBe(
        1,
      );
      expect(resolved[0]).toBeDefined();
    }
  });

  it('ignores case and surrounding space', () => {
    expect(normaliseMuscle('  QUADRICEPS ')).toBe('quads');
  });

  it('returns undefined for something it does not count, rather than guessing', () => {
    expect(normaliseMuscle('mitochondria')).toBeUndefined();
    expect(normaliseMuscle('')).toBeUndefined();
  });

  // The 19 values the library uses for a primary target. If it ever adds a twentieth, the
  // exercise would silently lose its muscle, so this list is the tripwire.
  it('resolves every primary target the library uses', () => {
    const targets = [
      'abs',
      'pectorals',
      'glutes',
      'biceps',
      'delts',
      'triceps',
      'upper back',
      'lats',
      'calves',
      'quads',
      'cardiovascular system',
      'forearms',
      'hamstrings',
      'spine',
      'traps',
      'levator scapulae',
      'abductors',
      'adductors',
      'serratus anterior',
    ];
    const missed = targets.filter((t) => normaliseMuscle(t) == null);
    expect(missed, `unmapped primary targets: ${missed.join(', ')}`).toEqual([]);
  });

  it('resolves the secondary muscles that appear more than ten times', () => {
    const common = [
      'shoulders',
      'hamstrings',
      'forearms',
      'triceps',
      'biceps',
      'calves',
      'glutes',
      'quadriceps',
      'core',
      'chest',
      'hip flexors',
      'obliques',
      'lower back',
      'rhomboids',
      'traps',
      'upper back',
      'trapezius',
      'abs',
      'deltoids',
      'quads',
      'rear deltoids',
      'adductors',
      'brachialis',
      'delts',
      'ankles',
      'abductors',
      'back',
    ];
    const missed = common.filter((t) => normaliseMuscle(t) == null);
    expect(missed, `unmapped secondary muscles: ${missed.join(', ')}`).toEqual([]);
  });
});

describe('normaliseMuscles', () => {
  it('drops unknowns and duplicates but keeps the order', () => {
    expect(normaliseMuscles(['quadriceps', 'mitochondria', 'quads', 'glutes'])).toEqual([
      'quads',
      'glutes',
    ]);
  });

  it('is empty for an empty list', () => {
    expect(normaliseMuscles([])).toEqual([]);
  });
});

describe('labels and regions', () => {
  it('names every muscle', () => {
    for (const m of MUSCLES) {
      expect(MUSCLE_LABEL[m], `no label for ${m}`).toBeTruthy();
    }
  });

  it('only groups real muscles, and never the same one twice', () => {
    const seen = new Set<Muscle>();
    for (const r of MUSCLE_REGIONS) {
      for (const m of r.muscles) {
        expect(MUSCLES).toContain(m);
        expect(seen.has(m), `${m} is in two regions`).toBe(false);
        seen.add(m);
      }
    }
  });

  it('leaves out only cardio and neck, which belong to no split', () => {
    const grouped = new Set(MUSCLE_REGIONS.flatMap((r) => r.muscles));
    expect(MUSCLES.filter((m) => !grouped.has(m)).sort()).toEqual(['cardio', 'neck']);
  });
});
