import { describe, expect, it } from 'vitest';
import { computeBanking, weekDays, weekStart, type BankingDay } from './banking';

// Monday 14 Sep – Sunday 20 Sep 2026
const WEEK = [
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
  '2026-09-17',
  '2026-09-18',
  '2026-09-19',
  '2026-09-20',
];

function week(consumed: (number | undefined)[], target = 2000): BankingDay[] {
  return WEEK.map((date, i) => ({ date, target, consumed: consumed[i] }));
}

const base = { floor: 1500, choices: {} };

describe('week boundaries', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2026-09-19')).toBe('2026-09-14');
    expect(weekStart('2026-09-14')).toBe('2026-09-14');
    expect(weekStart('2026-09-20')).toBe('2026-09-14');
    expect(weekDays('2026-09-17')).toEqual(WEEK);
  });
});

describe('computeBanking (§5.1)', () => {
  it('leaves targets alone when every day is on target', () => {
    const r = computeBanking({ ...base, days: week([2000, 2000, undefined]), today: '2026-09-17' });
    expect(r.todayTarget).toBe(2000);
    expect(r.notices).toEqual([]);
    expect(r.balance).toBe(0);
    expect(r.weekBudget).toBe(14000);
    expect(r.daysLeft).toBe(4);
  });

  it('absorbs an overshoot of 300 or less into the next day silently', () => {
    const r = computeBanking({ ...base, days: week([2250]), today: '2026-09-15' });
    expect(r.todayTarget).toBe(1750);
    expect(r.adjusted['2026-09-16']).toBe(2000);
    expect(r.notices[0]?.kind).toBe('absorbed');
    expect(r.pending).toBeUndefined();
  });

  it('asks about a 301–1000 overshoot and spreads it provisionally', () => {
    const r = computeBanking({ ...base, days: week([2600]), today: '2026-09-15' });
    expect(r.pending).toMatchObject({
      date: '2026-09-14',
      overshoot: 600,
      spreadPerDay: 100,
      tomorrowCut: 300,
    });
    expect(r.todayTarget).toBe(1900);
    expect(r.adjusted['2026-09-20']).toBe(1900);
  });

  it('honours the recorded choice: tomorrow takes the capped cut, the rest rolls over', () => {
    const r = computeBanking({
      ...base,
      days: week([2600]),
      today: '2026-09-15',
      choices: { '2026-09-14': 'tomorrow' },
    });
    expect(r.pending).toBeUndefined();
    expect(r.todayTarget).toBe(1700);
    expect(r.adjusted['2026-09-16']).toBe(2000);
    expect(r.carryOut).toBe(-300);
    expect(r.notices.map((n) => n.kind)).toEqual(['tomorrow', 'rollover']);
  });

  it('spreads a >1000 overshoot automatically, capped at 300 a day, and explains', () => {
    const r = computeBanking({ ...base, days: week([3800]), today: '2026-09-15' });
    expect(r.pending).toBeUndefined();
    for (const d of WEEK.slice(1)) expect(r.adjusted[d]).toBe(1700);
    expect(r.carryOut).toBe(0);
    expect(r.notices[0]?.kind).toBe('spread');
  });

  it('never cuts a day by more than 300 in total across several overshoots', () => {
    const r = computeBanking({ ...base, days: week([2300, 2300, 2300]), today: '2026-09-17' });
    // Tue absorbed Mon's 300 → Tue target 1700, Tue ate 2300 → 600 over → provisional spread.
    for (const d of WEEK.slice(3)) expect(r.adjusted[d]!).toBeGreaterThanOrEqual(1700);
    expect(r.adjusted['2026-09-17']).toBeGreaterThanOrEqual(1700);
  });

  it('never goes below the safety floor', () => {
    const r = computeBanking({ ...base, floor: 1900, days: week([3500]), today: '2026-09-15' });
    for (const d of WEEK.slice(1)) expect(r.adjusted[d]).toBe(1900);
    expect(r.carryOut).toBe(-(1500 - 6 * 100));
  });

  it('rolls an undershoot forward in full, but no day exceeds target + 700', () => {
    const r = computeBanking({ ...base, days: week([1000]), today: '2026-09-15' });
    expect(r.todayTarget).toBe(2700);
    expect(r.adjusted['2026-09-16']).toBe(2300);
    expect(r.balance).toBe(1000);
    expect(r.notices[0]?.kind).toBe('credit');
  });

  it('skips days with nothing logged instead of treating them as zero', () => {
    const r = computeBanking({ ...base, days: week([undefined, 2000]), today: '2026-09-16' });
    expect(r.todayTarget).toBe(2000);
    expect(r.notices).toEqual([]);
  });

  it('applies last week’s debt once, spread across the week, and forgives what does not fit', () => {
    const r = computeBanking({ ...base, days: week([]), today: '2026-09-14', carryIn: -2500 });
    for (const d of WEEK) expect(r.adjusted[d]).toBe(1700);
    expect(r.notices.map((n) => n.kind)).toEqual(['carried', 'forgiven']);
    expect(r.notices[1]?.amount).toBe(400);
    expect(r.carryOut).toBe(0);
  });

  it('applies last week’s credit to the first days', () => {
    const r = computeBanking({ ...base, days: week([]), today: '2026-09-14', carryIn: 900 });
    expect(r.adjusted['2026-09-14']).toBe(2700);
    expect(r.adjusted['2026-09-15']).toBe(2200);
  });

  it('reports week totals for the display', () => {
    const r = computeBanking({ ...base, days: week([1800, 2100, 500]), today: '2026-09-16' });
    expect(r.consumedToDate).toBe(4400);
    // Mon +200 credit → Tue target 2200; Tue ate 2100 → +100 more. Today is not counted yet.
    expect(r.balance).toBe(300);
    expect(r.adjusted['2026-09-16']).toBe(2100);
  });
});
