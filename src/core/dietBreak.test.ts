import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import {
  BREAK_AFTER_WEEKS,
  BREAK_WEEKS,
  inDietBreak,
  nextMonday,
  PROPOSAL_QUIET_DAYS,
  proposeDietBreak,
  STALL_AFTER_WEEKS,
  withDietBreak,
  type DietBreakInput,
} from './dietBreak';
import type { ModeSwitch } from './targets';

const TODAY = '2026-09-30'; // a Wednesday
const MONDAY = '2026-10-05';

const base = (over: Partial<DietBreakInput> = {}): DietBreakInput => ({
  mode: 'CUT',
  deficit_since: addDays(TODAY, -7 * BREAK_AFTER_WEEKS),
  goal_rate_kg_per_week: 0.5,
  schedule: [],
  ...over,
});

describe('nextMonday', () => {
  it('finds the following Monday, never today', () => {
    expect(nextMonday(TODAY)).toBe(MONDAY);
    expect(nextMonday(MONDAY)).toBe(addDays(MONDAY, 7));
    expect(nextMonday('2026-10-04')).toBe(MONDAY); // a Sunday
  });
});

describe('proposeDietBreak — when it speaks', () => {
  it('offers a break after eight weeks of deficit', () => {
    const p = proposeDietBreak(base(), TODAY)!;
    expect(p.reason).toBe('duration');
    expect(p.weeks_in_deficit).toBe(BREAK_AFTER_WEEKS);
    expect(p.weeks).toBe(BREAK_WEEKS);
    expect(p.from).toBe(MONDAY);
    expect(p.to).toBe(addDays(MONDAY, 14));
  });

  it('says nothing before eight weeks when the cut is working', () => {
    const i = base({
      deficit_since: addDays(TODAY, -7 * 6),
      trend_delta_kg: -3,
      lookback_days: 28,
    });
    expect(proposeDietBreak(i, TODAY)).toBeUndefined();
  });

  it('offers one earlier when four weeks have produced almost nothing', () => {
    const i = base({
      deficit_since: addDays(TODAY, -7 * STALL_AFTER_WEEKS),
      trend_delta_kg: -0.1, // expected 2 kg over 28 days at 0.5 kg/week
      lookback_days: 28,
    });
    const p = proposeDietBreak(i, TODAY)!;
    expect(p.reason).toBe('stalled');
    expect(p.line).toContain('barely moved');
  });

  it('does not call a working cut a stall', () => {
    const i = base({
      deficit_since: addDays(TODAY, -7 * STALL_AFTER_WEEKS),
      trend_delta_kg: -1.8,
      lookback_days: 28,
    });
    expect(proposeDietBreak(i, TODAY)).toBeUndefined();
  });

  it('needs a real stall, not a missing measurement', () => {
    const i = base({ deficit_since: addDays(TODAY, -7 * STALL_AFTER_WEEKS) });
    expect(proposeDietBreak(i, TODAY)).toBeUndefined();
  });
});

describe('proposeDietBreak — when it stays quiet', () => {
  it('has nothing to say outside a deficit', () => {
    for (const mode of ['MAINTAIN', 'BULK'] as const) {
      expect(proposeDietBreak(base({ mode }), TODAY)).toBeUndefined();
    }
    // A recomp is still a deficit of sorts, so it does get the offer.
    expect(proposeDietBreak(base({ mode: 'RECOMP' }), TODAY)).toBeDefined();
  });

  it('says nothing when no deficit has started', () => {
    expect(proposeDietBreak(base({ deficit_since: undefined }), TODAY)).toBeUndefined();
  });

  it('does not propose one on top of a break already on the calendar', () => {
    const soon: ModeSwitch[] = [{ date: addDays(TODAY, 10), mode: 'MAINTAIN' }];
    expect(proposeDietBreak(base({ schedule: soon }), TODAY)).toBeUndefined();
    // A maintenance block far in the future does not block a break now.
    const later: ModeSwitch[] = [
      { date: addDays(TODAY, PROPOSAL_QUIET_DAYS + 1), mode: 'MAINTAIN' },
    ];
    expect(proposeDietBreak(base({ schedule: later }), TODAY)).toBeDefined();
  });

  it('ignores a deficit that starts in the future', () => {
    expect(proposeDietBreak(base({ deficit_since: addDays(TODAY, 3) }), TODAY)).toBeUndefined();
  });
});

describe('withDietBreak', () => {
  it('is nothing but two mode switches, so §3.5 does the rest', () => {
    const p = proposeDietBreak(base(), TODAY)!;
    expect(withDietBreak([], p)).toEqual([
      { date: MONDAY, mode: 'MAINTAIN' },
      { date: addDays(MONDAY, 14), mode: 'CUT' },
    ]);
  });

  it('returns to the mode that was in force, not always CUT', () => {
    const p = proposeDietBreak(base({ mode: 'RECOMP' }), TODAY)!;
    expect(withDietBreak([], p)[1]).toEqual({ date: addDays(MONDAY, 14), mode: 'RECOMP' });
  });

  it('keeps the rest of the schedule and stays sorted', () => {
    const existing: ModeSwitch[] = [
      { date: '2026-12-24', mode: 'MAINTAIN' },
      { date: '2027-01-25', mode: 'CUT' },
    ];
    const p = proposeDietBreak(base({ schedule: existing }), TODAY)!;
    const merged = withDietBreak(existing, p);
    expect(merged.map((s) => s.date)).toEqual([
      MONDAY,
      addDays(MONDAY, 14),
      '2026-12-24',
      '2027-01-25',
    ]);
  });

  it('replaces a switch that already sits on one of the break dates', () => {
    const clash: ModeSwitch[] = [{ date: MONDAY, mode: 'BULK' }];
    const p = proposeDietBreak(base(), TODAY)!;
    const merged = withDietBreak(clash, p);
    expect(merged.filter((s) => s.date === MONDAY)).toEqual([{ date: MONDAY, mode: 'MAINTAIN' }]);
  });
});

describe('inDietBreak', () => {
  it('knows which days are inside the break', () => {
    const p = proposeDietBreak(base(), TODAY)!;
    const schedule = withDietBreak([], p);
    expect(inDietBreak(schedule, TODAY)).toBe(false);
    expect(inDietBreak(schedule, MONDAY)).toBe(true);
    expect(inDietBreak(schedule, addDays(MONDAY, 13))).toBe(true);
    expect(inDietBreak(schedule, addDays(MONDAY, 14))).toBe(false);
  });

  it('is false for an empty schedule', () => {
    expect(inDietBreak([], TODAY)).toBe(false);
  });
});
