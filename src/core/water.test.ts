import { describe, expect, it } from 'vitest';
import type { WaterLog } from './types';
import { formatLitres, formatWater, sumWater } from './water';

const log = (ml: number, deleted = false): WaterLog => ({
  id: String(ml),
  user_id: 'local',
  created_at: '',
  updated_at: '',
  deleted_at: deleted ? 'x' : null,
  date: '2026-09-20',
  logged_at: '',
  ml,
});

describe('water', () => {
  it('sums live logs only', () => {
    expect(sumWater([log(250), log(500), log(330, true)])).toBe(750);
    expect(sumWater([])).toBe(0);
  });
  it('formats to one decimal litre, ml below a litre', () => {
    expect(formatLitres(1500)).toBe('1.5 L');
    expect(formatLitres(3850)).toBe('3.9 L');
    expect(formatWater(250)).toBe('250 ml');
    expect(formatWater(1000)).toBe('1.0 L');
  });
});
