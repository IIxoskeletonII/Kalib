import { describe, expect, it } from 'vitest';
import {
  addDays,
  ageOn,
  diffDays,
  eachDay,
  fromDateKey,
  mealSlotForTime,
  toDateKey,
} from './dates';

describe('date keys', () => {
  it('round-trips local dates', () => {
    const d = new Date(2026, 8, 21, 23, 59);
    expect(toDateKey(d)).toBe('2026-09-21');
    expect(fromDateKey('2026-09-21').getTime()).toBe(new Date(2026, 8, 21).getTime());
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('adds days across the EU DST change without drifting', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('diffDays is signed', () => {
    expect(diffDays('2026-09-21', '2026-10-12')).toBe(21);
    expect(diffDays('2026-10-12', '2026-09-21')).toBe(-21);
  });

  it('eachDay is inclusive', () => {
    expect(eachDay('2026-09-29', '2026-10-01')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
    expect(eachDay('2026-09-29', '2026-09-29')).toEqual(['2026-09-29']);
  });
});

describe('ageOn', () => {
  it('counts full years only', () => {
    expect(ageOn('2003-05-10', '2026-05-09')).toBe(22);
    expect(ageOn('2003-05-10', '2026-05-10')).toBe(23);
  });
});

describe('mealSlotForTime', () => {
  it('maps hours to slots', () => {
    expect(mealSlotForTime(new Date(2026, 0, 1, 7))).toBe('breakfast');
    expect(mealSlotForTime(new Date(2026, 0, 1, 12))).toBe('lunch');
    expect(mealSlotForTime(new Date(2026, 0, 1, 16))).toBe('snack');
    expect(mealSlotForTime(new Date(2026, 0, 1, 20))).toBe('dinner');
    expect(mealSlotForTime(new Date(2026, 0, 1, 23))).toBe('snack');
  });
});
