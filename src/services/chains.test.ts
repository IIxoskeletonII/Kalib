import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { addFood } from '@/db/repo/foods';
import { listEntriesForDate } from '@/db/repo/logEntries';
import type { Market } from '@/core/market';
import { chainsFor, logOrder, ordersAt } from './chains';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

/** A chain row sold by the item, as Domino's publishes them. */
async function slice(name: string, market: Market, chain: string, kcal: number, protein: number) {
  return addFood({
    source: 'chain',
    name,
    chain,
    market,
    per_item: { kcal, protein, carb: 10, fat: 5, fiber: 1 },
    item_label: 'slice',
    micros: {},
    micro_coverage: 0,
    portions: [],
    verified: true,
  });
}

/** A chain row sold by weight, as McDonald's publishes them. */
async function weighed(name: string, market: Market, chain: string, grams: number) {
  return addFood({
    source: 'chain',
    name,
    chain,
    market,
    per_100g: { kcal: 200, protein: 20, carb: 10, fat: 8, fiber: 1 },
    micros: {},
    micro_coverage: 0,
    portions: [{ label: 'item', grams }],
    verified: true,
  });
}

const GULF: Market[] = ['OM', 'AE', 'SA'];
const LOTS = { kcal: 2000, protein_g: 150, carb_g: 300, fat_g: 80, fiber_g: 30 };

describe('chainsFor', () => {
  it('lists a chain once even when it trades in several of your markets', () => {
    // Domino's publishes in both Oman and the Emirates. Two identical chips would be two
    // spellings of one answer.
    return (async () => {
      await slice('Margerita', 'OM', "Domino's", 150, 6);
      await slice('Margerita', 'AE', "Domino's", 150, 6);
      await slice('Pepperoni', 'AE', "Domino's", 180, 8);
      const chains = await chainsFor(GULF);
      expect(chains).toHaveLength(1);
      expect(chains[0]?.chain).toBe("Domino's");
      expect(chains[0]?.items).toBe(3);
    })();
  });

  it('records the nearest market that has it', async () => {
    await slice('Margerita', 'AE', "Domino's", 150, 6);
    await slice('Margerita', 'OM', "Domino's", 150, 6);
    expect((await chainsFor(GULF))[0]?.market).toBe('OM');
  });

  it('ignores chains outside your markets', async () => {
    await slice('Margerita', 'IT' as Market, "Domino's", 150, 6);
    expect(await chainsFor(GULF)).toEqual([]);
  });
});

describe('ordersAt', () => {
  it('offers the same dish once, not once per country', async () => {
    // Before this, an order could contain the same slice twice over — one Omani, one Emirati.
    await slice('Margerita', 'OM', "Domino's", 150, 6);
    await slice('Margerita', 'AE', "Domino's", 150, 6);
    const orders = await ordersAt("Domino's", GULF, LOTS);
    for (const o of orders) {
      const names = o.lines.map((l) => l.item.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('reads both the weighed and the by-item shapes', async () => {
    await weighed('Big Mac', 'OM', "McDonald's", 200); // 400 kcal, 40 g
    const [best] = await ordersAt("McDonald's", GULF, {
      ...LOTS,
      kcal: 420,
    });
    expect(best?.totals.kcal).toBeCloseTo(400, 0);
    expect(best?.totals.protein_g).toBeCloseTo(40, 0);
  });
});

describe('logOrder', () => {
  it('writes one entry per dish, not one lump called "order"', async () => {
    const a = await weighed('Big Mac', 'OM', "McDonald's", 200);
    const b = await slice('Margerita', 'OM', "McDonald's", 150, 6);
    await logOrder(
      {
        lines: [
          {
            item: {
              id: a.id,
              name: 'Big Mac',
              kcal: 400,
              protein_g: 40,
              carb_g: 20,
              fat_g: 16,
              fiber_g: 2,
            },
            count: 1,
          },
          {
            item: {
              id: b.id,
              name: 'Margerita',
              kcal: 150,
              protein_g: 6,
              carb_g: 10,
              fat_g: 5,
              fiber_g: 1,
            },
            count: 2,
          },
        ],
        totals: { kcal: 700, protein_g: 52, carb_g: 40, fat_g: 26, fiber_g: 4 },
        density: 7.4,
        fill: 0.5,
      },
      GULF,
      '2026-10-17',
      'lunch',
    );
    const entries = await listEntriesForDate('2026-10-17');
    expect(entries).toHaveLength(2);

    const byItem = entries.find((e) => e.name.includes('Margerita'));
    // Two slices: the macros double and no weight is invented for them.
    expect(byItem?.servings).toBe(2);
    expect(byItem?.grams).toBe(0);
    expect(byItem?.kcal).toBeCloseTo(300, 0);

    const weighedEntry = entries.find((e) => e.name.includes('Big Mac'));
    expect(weighedEntry?.grams).toBe(200);
    expect(weighedEntry?.kcal).toBeCloseTo(400, 0);
  });
});
