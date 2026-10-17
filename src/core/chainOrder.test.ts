import { describe, expect, it } from 'vitest';
import { bestOrders, describeOrder, type MenuItem } from './chainOrder';

const item = (
  id: string,
  kcal: number,
  protein: number,
  extra: Partial<MenuItem> = {},
): MenuItem => ({
  id,
  name: id,
  kcal,
  protein_g: protein,
  carb_g: 0,
  fat_g: 0,
  fiber_g: 0,
  ...extra,
});

/** A small menu with the shapes that matter: dense, big, cheap and useless. */
const MENU: MenuItem[] = [
  item('grilled-chicken', 300, 40),
  item('big-burger', 600, 30),
  item('small-burger', 250, 14),
  item('fries', 330, 4),
  item('milkshake', 500, 8),
  item('side-salad', 40, 2),
];

const left = (kcal: number, protein = 200): import('./types').MacroTotals => ({
  kcal,
  protein_g: protein,
  carb_g: 999,
  fat_g: 999,
  fiber_g: 999,
});

describe('bestOrders', () => {
  it('maximises protein inside the calories left', () => {
    const [best] = bestOrders(MENU, left(650));
    expect(best).toBeDefined();
    // Two grilled chickens is 600 kcal for 80 g, already beating the big burger's 600 for 30.
    // The answer is better still: the last 40 calories buy a side salad and two more grams.
    // Written down after running it, because the point of an optimiser is to find the thing
    // you would not have thought of.
    expect(best?.totals.protein_g).toBe(82);
    expect(best?.totals.kcal).toBe(640);
  });

  it('never offers an order that does not fit', () => {
    for (const o of bestOrders(MENU, left(500))) {
      expect(o.totals.kcal).toBeLessThanOrEqual(500);
    }
  });

  it('says nothing when nothing fits', () => {
    // 30 kcal at a burger chain. Inventing a recommendation would be worse than none.
    expect(bestOrders(MENU, left(30))).toEqual([]);
    expect(bestOrders(MENU, left(0))).toEqual([]);
  });

  it('prefers the smaller order when the protein is the same', () => {
    const menu = [item('a', 200, 20), item('b', 400, 20)];
    const [best] = bestOrders(menu, left(900), { maxLines: 1 });
    expect(best?.lines[0]?.item.id).toBe('a');
  });

  it('does not rank a milkshake well just because it is small', () => {
    // The failure a calorie ranking makes: 500 kcal for 8 g of protein is not an answer.
    const ids = bestOrders(MENU, left(900)).flatMap((o) => o.lines.map((l) => l.item.id));
    expect(ids).not.toContain('milkshake');
  });

  it('returns different answers, not one answer three ways', () => {
    const orders = bestOrders(MENU, left(900), { limit: 3 });
    const keys = orders.map((o) =>
      o.lines
        .map((l) => `${l.item.id}x${l.count}`)
        .sort()
        .join('+'),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('honours the limits it is given', () => {
    const one = bestOrders(MENU, left(2000), { maxLines: 1 });
    for (const o of one) expect(o.lines).toHaveLength(1);

    const same = bestOrders(MENU, left(2000), { maxSame: 1, maxLines: 3 });
    for (const o of same) for (const l of o.lines) expect(l.count).toBe(1);

    expect(bestOrders(MENU, left(2000), { limit: 1 })).toHaveLength(1);
  });

  it('reports what the order comes to', () => {
    const [best] = bestOrders(MENU, left(650));
    expect(best?.fill).toBeCloseTo(640 / 650, 2);
    // 82 g over 640 kcal is 12.8 g per 100 kcal.
    expect(best?.density).toBeCloseTo(12.8, 1);
  });

  it('copes with an empty menu', () => {
    expect(bestOrders([], left(800))).toEqual([]);
  });

  it('ignores an item with no calories rather than stacking it forever', () => {
    // A zero-calorie drink would otherwise be free to add without limit.
    const menu = [item('water', 0, 0), item('chicken', 300, 40)];
    const orders = bestOrders(menu, left(700));
    for (const o of orders) {
      for (const l of o.lines) expect(l.item.id).not.toBe('water');
    }
  });
});

describe('describeOrder', () => {
  it('reads as one line', () => {
    const [best] = bestOrders(MENU, left(650));
    expect(best && describeOrder(best)).toBe(
      '2× grilled-chicken + side-salad — 640 kcal, 82 g protein',
    );
  });
});

describe('what does not belong in an order', () => {
  it('leaves out an item that carries no useful protein', () => {
    // Against the real Omani menu this recommended "Tea + 2× Chicken Caesar Salad": 355 ml
    // of tea, four calories, 0.6 g of protein. The optimiser was right that it raised the
    // total and wrong that it was advice.
    const tea = item('tea', 4, 0.6);
    const menu = [tea, item('chicken', 300, 40)];
    const ids = bestOrders(menu, left(900)).flatMap((o) => o.lines.map((l) => l.item.id));
    expect(ids).not.toContain('tea');
  });

  it('keeps a small item that does carry some', () => {
    // The line is a gram a serving, not a calorie count: a side salad earns its place.
    const menu = [item('salad', 40, 2), item('chicken', 300, 40)];
    const ids = bestOrders(menu, left(400)).flatMap((o) => o.lines.map((l) => l.item.id));
    expect(ids).toContain('salad');
  });

  it('stays quick on a whole menu', () => {
    // 130 servings and a large budget is the worst case the app will meet. Raising the
    // serving limits to six took seven seconds on exactly this shape.
    const big = Array.from({ length: 130 }, (_, i) =>
      item(`i${i}`, 80 + (i % 40) * 12, 2 + (i % 25)),
    );
    const t0 = Date.now();
    bestOrders(big, left(1200));
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
