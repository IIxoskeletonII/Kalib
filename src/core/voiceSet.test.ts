import { describe, expect, it } from 'vitest';
import { describeSpokenSet, parseSpokenSet, wordsToNumbers } from './voiceSet';

describe('wordsToNumbers', () => {
  it('reads the numbers people say in a gym', () => {
    expect(wordsToNumbers('eighty for eight')).toBe('80 for 8');
    expect(wordsToNumbers('one hundred for five')).toBe('100 for 5');
    expect(wordsToNumbers('a hundred and five')).toBe('105');
    expect(wordsToNumbers('twelve')).toBe('12');
    expect(wordsToNumbers('ninety five')).toBe('95');
    expect(wordsToNumbers('two hundred and twenty five')).toBe('225');
  });

  it('leaves words that are not numbers alone', () => {
    expect(wordsToNumbers('bench press for eight')).toBe('bench press for 8');
  });

  it('handles an empty string', () => {
    expect(wordsToNumbers('')).toBe('');
  });
});

describe('parseSpokenSet', () => {
  const p = parseSpokenSet;

  it('understands the usual order, spoken or in digits', () => {
    for (const said of ['eighty for eight', '80 for 8', '80 by 8', '80 x 8', '80 times 8']) {
      expect(p(said), said).toEqual({ weight: 80, reps: 8 });
    }
  });

  it('understands reps first when the word "reps" makes it unambiguous', () => {
    expect(p('eight reps at eighty')).toEqual({ weight: 80, reps: 8 });
    expect(p('5 reps with 100')).toEqual({ weight: 100, reps: 5 });
  });

  it('keeps the unit when one is spoken', () => {
    expect(p('100 kilos for 5')).toEqual({ weight: 100, reps: 5, unit: 'kg' });
    expect(p('225 pounds for 5')).toEqual({ weight: 225, reps: 5, unit: 'lb' });
    expect(p('80 for 8')?.unit).toBeUndefined();
  });

  it('takes reps alone, for bodyweight work', () => {
    expect(p('twelve reps')).toEqual({ reps: 12 });
    expect(p('15 reps')).toEqual({ reps: 15 });
  });

  it('takes a weight alone when the unit is said', () => {
    expect(p('60 kilos')).toEqual({ weight: 60, unit: 'kg' });
  });

  it('takes a hold in seconds', () => {
    expect(p('45 seconds')).toEqual({ seconds: 45 });
    expect(p('ninety secs')).toEqual({ seconds: 90 });
  });

  it('reads reps in reserve without mistaking it for reps', () => {
    expect(p('80 for 8 rir 2')).toEqual({ weight: 80, reps: 8, rir: 2 });
    expect(p('100 for 5 two in reserve')).toEqual({ weight: 100, reps: 5, rir: 2 });
  });

  it('accepts two bare numbers as weight then reps', () => {
    expect(p('80 8')).toEqual({ weight: 80, reps: 8 });
  });

  it('accepts a decimal weight either way it is transcribed', () => {
    expect(p('82.5 for 6')).toEqual({ weight: 82.5, reps: 6 });
    expect(p('82,5 for 6')).toEqual({ weight: 82.5, reps: 6 });
  });

  it('ignores the words around the numbers', () => {
    expect(p('that was 80 for 8 mate')).toEqual({ weight: 80, reps: 8 });
  });

  it('refuses rather than guessing when it cannot be sure', () => {
    // A wrong number written silently becomes next week's target, which is worse than a retry.
    expect(p('')).toBeUndefined();
    expect(p('   ')).toBeUndefined();
    expect(p('heavy')).toBeUndefined();
    expect(p('pretty good set')).toBeUndefined();
    expect(p('eighty')).toBeUndefined(); // weight or reps? unknowable
  });

  it('refuses physically impossible figures', () => {
    expect(p('8000 for 8')).toBeUndefined();
    expect(p('80 for 900')).toBeUndefined();
    expect(p('0 for 8')).toBeUndefined();
    expect(p('80 for 0')).toBeUndefined();
  });

  it('never returns an empty object that would log a blank set', () => {
    for (const said of ['kilos', 'reps', 'rir 2', 'for', 'x']) {
      const r = p(said);
      if (r) expect(Object.keys(r).filter((k) => k !== 'unit').length).toBeGreaterThan(0);
    }
  });
});

describe('describeSpokenSet', () => {
  it('reads back what it understood, so it can be checked', () => {
    expect(describeSpokenSet({ weight: 80, reps: 8 }, 'kg')).toBe('80 kg · 8 reps');
    expect(describeSpokenSet({ weight: 225, reps: 5, unit: 'lb' }, 'kg')).toBe('225 lb · 5 reps');
    expect(describeSpokenSet({ reps: 12 }, 'kg')).toBe('12 reps');
    expect(describeSpokenSet({ seconds: 45 }, 'kg')).toBe('45s');
    expect(describeSpokenSet({ weight: 80, reps: 8, rir: 2 }, 'kg')).toBe('80 kg · 8 reps · RIR 2');
  });
});
