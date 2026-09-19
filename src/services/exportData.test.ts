import { describe, expect, it } from 'vitest';
import type { LogEntry, WeighIn } from '@/core/types';
import { csvEscape, entriesCsv, toCsv, weighInsCsv } from './exportData';

const CRLF = '\r\n';

describe('csv', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('x\ny')).toBe('"x\ny"');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(1.5)).toBe('1.5');
  });

  it('writes CRLF rows with a header', () => {
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe(`a,b${CRLF}1,"x,y"${CRLF}`);
  });

  it('entriesCsv includes micros columns', () => {
    const e: LogEntry = {
      id: 'e1',
      user_id: 'local',
      created_at: 't',
      updated_at: 't',
      logged_at: '2026-09-21T08:00:00.000Z',
      date: '2026-09-21',
      meal_slot: 'breakfast',
      name: 'Egg, whole, raw',
      food_id: 'f',
      grams: 50,
      servings: 1,
      kcal: 71.5,
      protein_g: 6.25,
      carb_g: 0.36,
      fat_g: 4.75,
      fiber_g: 0,
      micros: { iron: 0.885 },
      entry_method: 'search',
      confidence: 'high',
    };
    expect(entriesCsv([e])).toContain('"Egg, whole, raw"');

    const [header, row] = entriesCsv([{ ...e, name: 'Egg' }])
      .trim()
      .split(CRLF);
    const h = header!.split(',');
    const cols = row!.split(',');
    expect(h).toContain('iron');
    expect(cols[h.indexOf('iron')]).toBe('0.885');
    expect(cols[h.indexOf('kcal')]).toBe('71.5');
    expect(cols[h.indexOf('zinc')]).toBe('');
    expect(cols[h.indexOf('protein_g')]).toBe('6.3');
  });

  it('weighInsCsv leaves body fat blank when unknown', () => {
    const w: WeighIn = {
      id: 'w',
      user_id: 'local',
      created_at: 't',
      updated_at: 't',
      date: '2026-09-21',
      weight_kg: 110,
      source: 'manual',
    };
    expect(weighInsCsv([w])).toBe(
      `id,date,weight_kg,bodyfat_pct,source,created_at${CRLF}w,2026-09-21,110,,manual,t${CRLF}`,
    );
  });
});
