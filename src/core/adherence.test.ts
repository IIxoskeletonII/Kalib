import { describe, expect, it } from 'vitest';
import {
  consistency,
  consistencyLine,
  CONSISTENT_DAYS_PER_WEEK,
  currentRun,
  freshStartLandmark,
  freshStartNudge,
  LAPSED_DAYS,
  loggedInWindow,
  quietDays,
  type LoggedDay,
} from './adherence';
import { addDays } from './dates';

const TODAY = '2026-09-30'; // a Wednesday

/** `pattern` reads oldest-to-newest ending on `today`: 1 logged, 0 missed. */
function days(pattern: string, today = TODAY): LoggedDay[] {
  const n = pattern.length;
  return [...pattern].map((c, i) => ({
    date: addDays(today, -(n - 1 - i)),
    logged: c === '1',
  }));
}

describe('loggedInWindow', () => {
  it('counts only inside the window, today included', () => {
    expect(loggedInWindow(days('1111111'), TODAY, 7)).toBe(7);
    expect(loggedInWindow(days('0000011'), TODAY, 7)).toBe(2);
    // The eighth day back is outside a seven-day window.
    expect(loggedInWindow(days('10000000'), TODAY, 7)).toBe(0);
  });

  it('treats absent days as unlogged rather than throwing', () => {
    expect(loggedInWindow([], TODAY, 7)).toBe(0);
  });
});

describe('currentRun', () => {
  it('counts an unbroken run', () => {
    expect(currentRun(days('11111'), TODAY)).toEqual({
      days: 5,
      logged: 5,
      missed: 0,
      from: addDays(TODAY, -4),
    });
  });

  it('forgives one missed day in the middle', () => {
    const r = currentRun(days('111011'), TODAY);
    expect(r.days).toBe(6);
    expect(r.logged).toBe(5);
    expect(r.missed).toBe(1);
  });

  it('ends on two missed days in a row', () => {
    const r = currentRun(days('111100' + '11'), TODAY);
    expect(r.days).toBe(2);
    expect(r.logged).toBe(2);
    expect(r.missed).toBe(0);
  });

  it('does not count an unlogged today as a miss — the day is not over', () => {
    const r = currentRun(days('11110'), TODAY);
    expect(r.logged).toBe(4);
    expect(r.days).toBe(4);
    expect(r.missed).toBe(0);
  });

  it('survives an unlogged today after a forgiven gap', () => {
    // ...logged, missed, unlogged-today: the run holds at three days.
    const r = currentRun(days('11101' + '0'), TODAY);
    expect(r.logged).toBe(4);
    expect(r.missed).toBe(1);
  });

  it('holds when today is still open and yesterday is the one forgiven miss', () => {
    const r = currentRun(days('111100'), TODAY);
    expect(r.logged).toBe(4);
    expect(r.missed).toBe(1);
  });

  it('breaks once two finished days in a row are blank', () => {
    // Today open, then two genuinely missed days behind it.
    expect(currentRun(days('111000'), TODAY)).toEqual({ days: 0, logged: 0, missed: 0 });
  });

  it('never begins with a gap', () => {
    const r = currentRun(days('0111'), TODAY);
    expect(r.days).toBe(3);
    expect(r.missed).toBe(0);
    expect(r.from).toBe(addDays(TODAY, -2));
  });

  it('has nothing to report on an empty or never-logged record', () => {
    expect(currentRun([], TODAY)).toEqual({ days: 0, logged: 0, missed: 0 });
    expect(currentRun(days('0000'), TODAY)).toEqual({ days: 0, logged: 0, missed: 0 });
  });
});

describe('quietDays', () => {
  it('is zero on a logged day and counts up after that', () => {
    expect(quietDays(days('111'), TODAY)).toBe(0);
    expect(quietDays(days('1100'), TODAY)).toBe(2);
  });

  it('is undefined when nothing was ever logged', () => {
    expect(quietDays(days('000'), TODAY)).toBeUndefined();
    expect(quietDays([], TODAY)).toBeUndefined();
  });
});

describe('consistency', () => {
  it('reports both windows and judges against the evidence thresholds', () => {
    const c = consistency(days('1'.repeat(28)), TODAY);
    expect(c.week).toBe(7);
    expect(c.month).toBe(28);
    expect(c.share).toBe(1);
    expect(c.consistent).toBe(true);
  });

  it('needs both a weekly floor and a monthly share', () => {
    // Seven straight days after three empty weeks: the week is fine, the month is not.
    const c = consistency(days('0'.repeat(21) + '1111111'), TODAY);
    expect(c.week).toBe(CONSISTENT_DAYS_PER_WEEK + 4);
    expect(c.consistent).toBe(false);
    // Every other day for four weeks: half the days, and enough of this week.
    const d = consistency(days('10'.repeat(14)), TODAY);
    expect(d.share).toBeGreaterThanOrEqual(0.5);
    expect(d.consistent).toBe(true);
  });

  it('leads with the run once there is one, and never scolds', () => {
    expect(consistencyLine(consistency(days('1111'), TODAY))).toBe('4 of the last 4 days.');
    expect(consistencyLine(consistency(days('111011'), TODAY))).toBe(
      '5 of the last 6 days (1 day off, which is fine).',
    );
    expect(consistencyLine(consistency(days('11'), TODAY))).toBe('2 of the last 7 days.');
    expect(consistencyLine(consistency(days('0'.repeat(28)), TODAY))).toBe(
      'Nothing logged yet this month.',
    );
  });
});

describe('freshStartLandmark', () => {
  it('finds new years, new months and Mondays, in that order', () => {
    expect(freshStartLandmark('2027-01-01')).toBe('year');
    expect(freshStartLandmark('2026-10-01')).toBe('month');
    expect(freshStartLandmark('2026-10-05')).toBe('week'); // a Monday
    expect(freshStartLandmark('2026-09-30')).toBeUndefined();
  });
});

describe('freshStartNudge', () => {
  it('only speaks on a landmark, and only after a real gap', () => {
    expect(freshStartNudge('2026-10-05', LAPSED_DAYS)).toContain('New week');
    expect(freshStartNudge('2026-10-01', LAPSED_DAYS)).toContain('New month');
    expect(freshStartNudge('2027-01-01', LAPSED_DAYS)).toContain('New year');
    expect(freshStartNudge('2026-10-05', LAPSED_DAYS - 1)).toBeUndefined();
    expect(freshStartNudge('2026-09-30', 30)).toBeUndefined();
  });

  it('offers a beginning without naming the lapse', () => {
    const line = freshStartNudge('2026-10-05', 40)!;
    expect(line).not.toMatch(/40|days since|missed|failed/);
    expect(line).toContain('clean first day');
  });
});
