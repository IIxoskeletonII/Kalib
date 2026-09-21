import { describe, expect, it } from 'vitest';
import {
  PHOTO_BIAS,
  groundItems,
  matchItems,
  parseEstimate,
  regroundItem,
  totalGrounded,
} from './estimate';
import { buildSearchDoc } from './search';
import type { Food } from './types';

const food = (
  id: string,
  name: string,
  kcal: number,
  source: Food['source'] = 'usda_sr',
): Food => ({
  id,
  user_id: 'local',
  created_at: '',
  updated_at: '',
  source,
  name,
  per_100g: { kcal, protein: kcal / 10, carb: kcal / 8, fat: kcal / 30, fiber: 1 },
  micros: { iron: 1 },
  micro_coverage: 0.05,
  portions: [],
  verified: true,
});

const eggs = food('egg', 'Egg, whole, cooked, scrambled', 149);
const toast = food('toast', 'Bread, white, commercially prepared, toasted', 293);
const coffee = food('coffee', 'Coffee, brewed', 1);
const latteMine = food('latte', 'Latte', 60, 'custom');
const foods = new Map([eggs, toast, coffee, latteMine].map((f) => [f.id, f]));
const docs = [eggs, toast, coffee, latteMine].map(buildSearchDoc);

const raw = {
  items: [
    {
      name: 'Scrambled eggs',
      search_term: 'egg scrambled',
      grams_estimate: 120,
      grams_range: [90, 150],
      kcal: 180,
      protein_g: 13,
      carb_g: 2,
      fat_g: 13,
      fiber_g: 0,
      confidence: 'medium',
    },
    {
      name: 'Toast with butter',
      search_term: 'bread white toasted',
      grams_estimate: 40,
      grams_range: [30, 50],
      kcal: 150,
      protein_g: 4,
      carb_g: 20,
      fat_g: 6,
      fiber_g: 1,
      confidence: 'medium',
    },
    {
      name: 'Latte',
      search_term: 'coffee latte',
      grams_estimate: 250,
      grams_range: [200, 300],
      kcal: 150,
      protein_g: 8,
      carb_g: 12,
      fat_g: 8,
      fiber_g: 0,
      confidence: 'low',
    },
  ],
  hidden_ingredients_assumed: ['~10 g butter'],
  total_kcal_range: [380, 600],
  notes: 'ok',
};

describe('parseEstimate', () => {
  it('normalises a good response', () => {
    const r = parseEstimate(raw);
    expect(r.items).toHaveLength(3);
    expect(r.items[0]!.grams_range).toEqual([90, 150]);
    expect(r.hidden_ingredients_assumed).toEqual(['~10 g butter']);
  });
  it('clamps garbage and fills missing ranges', () => {
    const r = parseEstimate({
      items: [{ name: 'Thing', grams_estimate: '80', kcal: -5, protein_g: 'x' }],
    });
    expect(r.items[0]!.grams_estimate).toBe(80);
    expect(r.items[0]!.kcal).toBe(0);
    expect(r.items[0]!.protein_g).toBe(0);
    expect(r.items[0]!.grams_range).toEqual([56, 104]);
    expect(r.items[0]!.confidence).toBe('low');
  });
  it('rejects an empty estimate', () => {
    expect(() => parseEstimate({ items: [] })).toThrow(/recognisable/);
    expect(() => parseEstimate(null)).toThrow();
  });
});

describe('grounding', () => {
  const r = parseEstimate(raw);
  it('matches items to database foods by search term, own foods included', () => {
    const m = matchItems(r.items, docs);
    expect(m[0]).toBe('egg');
    expect(m[1]).toBe('toast');
    expect(m[2]).toBe('latte'); // the user's own "Latte", not brewed coffee
  });
  it('keeps a match only when the energy density agrees', () => {
    // Force the latte onto brewed coffee (1 kcal/100 g vs the model's 60): rejected.
    const g = groundItems(r.items, ['egg', 'toast', 'coffee'], foods);
    expect(g[0]!.kind).toBe('matched');
    expect(g[0]!.confidence).toBe('medium');
    expect(g[0]!.kcal).toBeCloseTo(149 * 1.2);
    expect(g[0]!.micros.iron).toBeCloseTo(1.2);
    expect(g[2]!.kind).toBe('estimate');
    expect(g[2]!.confidence).toBe('low');
  });
  it('applies the +10% bias only to what stays an estimate', () => {
    const g = groundItems(r.items, [undefined, 'toast', undefined], foods);
    expect(g[0]!.kcal).toBeCloseTo(180 * PHOTO_BIAS);
    expect(g[0]!.protein_g).toBeCloseTo(13 * PHOTO_BIAS);
    expect(g[0]!.micros).toEqual({});
    expect(g[1]!.kcal).toBeCloseTo(293 * 0.4);
  });
  it('ranges follow the gram range', () => {
    const g = groundItems(r.items, ['egg', undefined, undefined], foods);
    expect(g[0]!.kcal_range[0]).toBeCloseTo(149 * 0.9);
    expect(g[0]!.kcal_range[1]).toBeCloseTo(149 * 1.5);
    expect(g[1]!.kcal_range[0]).toBeCloseTo((150 / 40) * 30 * PHOTO_BIAS);
  });
  it('re-grounds at new grams and totals', () => {
    const g = groundItems(r.items, ['egg', 'toast', undefined], foods);
    const eggs200 = regroundItem(g[0]!, 200);
    expect(eggs200.kcal).toBeCloseTo(298);
    const latte300 = regroundItem(g[2]!, 300);
    expect(latte300.kcal).toBeCloseTo(150 * 1.2 * PHOTO_BIAS);
    const t = totalGrounded([eggs200, g[1]!, latte300]);
    expect(t.kcal).toBeCloseTo(298 + 117.2 + 198);
    expect(t.lo).toBeLessThan(t.kcal);
    expect(t.hi).toBeGreaterThan(t.kcal);
  });
});
