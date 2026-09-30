import { describe, expect, it } from 'vitest';
import {
  cycleDay,
  cycleLength,
  cyclePhaseLabel,
  cycleStartFor,
  DEFAULT_CYCLE_DAYS,
  MAX_PREDICTED_CYCLES,
  PEAK_SIGMA_SCALE,
  retentionLoad,
  retentionWindows,
  weightSigmaScale,
} from './cycle';
import { addDays } from './dates';

const S = '2026-09-01';

describe('cycleLength', () => {
  it('defaults to 28 days until two starts exist', () => {
    expect(cycleLength([])).toBe(DEFAULT_CYCLE_DAYS);
    expect(cycleLength([S])).toBe(DEFAULT_CYCLE_DAYS);
  });

  it('takes the median of the observed gaps', () => {
    expect(cycleLength([S, addDays(S, 30), addDays(S, 60)])).toBe(30);
    // Gaps of 27, 31 and 26 days: the median is 27.
    expect(cycleLength([S, addDays(S, 27), addDays(S, 58), addDays(S, 84)])).toBe(27);
  });

  it('ignores gaps outside the physiological range, so a missed log cannot skew it', () => {
    // 90 days is a forgotten log, not a cycle; the single 29-day gap is the only evidence.
    expect(cycleLength([S, addDays(S, 29), addDays(S, 119)])).toBe(29);
  });

  it('is order- and duplicate-insensitive', () => {
    expect(cycleLength([addDays(S, 30), S, S, addDays(S, 30)])).toBe(30);
  });
});

describe('cycleStartFor', () => {
  it('is undefined before the first logged start', () => {
    expect(cycleStartFor('2026-08-31', [S])).toBeUndefined();
    expect(cycleStartFor(S, [])).toBeUndefined();
  });

  it('holds the logged start for the whole cycle', () => {
    expect(cycleStartFor(S, [S])).toBe(S);
    expect(cycleStartFor(addDays(S, 27), [S])).toBe(S);
  });

  it('predicts the next starts from the median length', () => {
    expect(cycleStartFor(addDays(S, 28), [S])).toBe(addDays(S, 28));
    expect(cycleStartFor(addDays(S, 57), [S])).toBe(addDays(S, 56));
  });

  it('stops predicting once it is guessing too far ahead', () => {
    const tooFar = addDays(S, DEFAULT_CYCLE_DAYS * (MAX_PREDICTED_CYCLES + 1));
    expect(cycleStartFor(tooFar, [S])).toBeUndefined();
  });
});

describe('retentionLoad', () => {
  it('peaks on the first day of menses', () => {
    expect(retentionLoad(S, [S])).toBe(1);
    expect(cycleDay(S, [S])).toBe(1);
  });

  it('resolves over the days after it', () => {
    expect(retentionLoad(addDays(S, 1), [S])).toBeCloseTo(0.75, 10);
    expect(retentionLoad(addDays(S, 2), [S])).toBeCloseTo(0.5, 10);
    expect(retentionLoad(addDays(S, 3), [S])).toBeCloseTo(0.25, 10);
    expect(retentionLoad(addDays(S, 4), [S])).toBe(0);
  });

  it('builds over the days before the next one', () => {
    expect(retentionLoad(addDays(S, 22), [S])).toBe(0); // day 23
    expect(retentionLoad(addDays(S, 23), [S])).toBeCloseTo(1 / 3, 10); // day 24
    expect(retentionLoad(addDays(S, 27), [S])).toBe(1); // day 28, the eve of the next
  });

  it('is zero in mid-cycle and zero when no cycle is known', () => {
    expect(retentionLoad(addDays(S, 13), [S])).toBe(0);
    expect(retentionLoad(S, [])).toBe(0);
  });
});

describe('weightSigmaScale', () => {
  it('leaves an ordinary weigh-in untouched', () => {
    expect(weightSigmaScale(addDays(S, 13), [S])).toBe(1);
    expect(weightSigmaScale(addDays(S, 13), [])).toBe(1);
  });

  it('widens the filter to its peak on the day retention peaks', () => {
    expect(weightSigmaScale(S, [S])).toBe(PEAK_SIGMA_SCALE);
  });

  it('never leaves the 1..peak band', () => {
    for (let i = 0; i < 60; i++) {
      const s = weightSigmaScale(addDays(S, i), [S]);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(PEAK_SIGMA_SCALE);
    }
  });
});

describe('retentionWindows', () => {
  it('merges the tail of one cycle with the head of the next into one band', () => {
    const w = retentionWindows(addDays(S, 10), addDays(S, 40), [S]);
    // Day 24 of this cycle (S+23) through day 4 of the next (S+31).
    expect(w).toEqual([{ from: addDays(S, 23), to: addDays(S, 31) }]);
  });

  it('reports the opening band when the range starts inside one', () => {
    expect(retentionWindows(S, addDays(S, 5), [S])).toEqual([{ from: S, to: addDays(S, 3) }]);
  });

  it('is empty without a logged cycle or over an inverted range', () => {
    expect(retentionWindows(S, addDays(S, 30), [])).toEqual([]);
    expect(retentionWindows(addDays(S, 30), S, [S])).toEqual([]);
  });
});

describe('cyclePhaseLabel', () => {
  it('names the day and warns only inside the window', () => {
    expect(cyclePhaseLabel(addDays(S, 13), [S])).toBe('Day 14 of the cycle');
    expect(cyclePhaseLabel(S, [S])).toBe('Day 1 — water retention likely, the trend allows for it');
    expect(cyclePhaseLabel(S, [])).toBeUndefined();
  });
});
