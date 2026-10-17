// SPEC §21.2 — what to order, given what is left of the day.
//
// The question a person actually has standing in a queue is not "what is lowest in calories".
// It is "I have 640 left and I want to eat properly — what do I get?". A ranking by calories
// answers the first and is useless for the second: it recommends a side salad to someone with
// most of their day unspent, and a milkshake looks fine next to a chicken sandwich because it
// happens to be smaller.
//
// So the objective is **the most protein that fits**. Protein is the macro people run short
// of, it is what makes a meal hold, and §3.4 already treats it as the floor the other macros
// move around. Carbohydrate and fat are not scored at all: inside a calorie budget they are
// the consequence of the choice, not the choice.
//
// An order that does not fit is not offered. Not ranked lower — absent. Suggesting something
// that puts you over and leaving you to notice is the same failure as showing an Italian Big
// Mac in Muscat.
import type { MacroTotals } from './types';

export interface MenuItem {
  id: string;
  name: string;
  /** One serving as the chain sells it: one item, one slice, or one weighed portion. */
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  fiber_g: number;
}

export interface OrderLine {
  item: MenuItem;
  count: number;
}

export interface Order {
  lines: readonly OrderLine[];
  totals: MacroTotals;
  /** Grams of protein per 100 kcal — how well the order earns its calories. */
  density: number;
  /** Share of the remaining calories it uses, 0–1. */
  fill: number;
}

export interface OrderOptions {
  /**
   * Most servings in one order, counting repeats. Default 3, which is what an order looks
   * like. Raising it to six did fill a pizza budget more completely and produced "3× Tea +
   * 2× Chicken Caesar Salad" in seven seconds, which is neither an order nor advice.
   */
  maxLines?: number;
  /** How many orders to return. Default 3. */
  limit?: number;
  /** Most of the same item. Two is an order; four Caesar salads is not. Default 2. */
  maxSame?: number;
}

const EMPTY: MacroTotals = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0 };

function add(a: MacroTotals, item: MenuItem, n: number): MacroTotals {
  return {
    kcal: a.kcal + item.kcal * n,
    protein_g: a.protein_g + item.protein_g * n,
    carb_g: a.carb_g + item.carb_g * n,
    fat_g: a.fat_g + item.fat_g * n,
    fiber_g: a.fiber_g + item.fiber_g * n,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * How many candidates survive the prune.
 *
 * A chain menu runs to a few hundred servings and every combination of three would be tens of
 * millions. The prune keeps the items that earn their calories best, which is what the
 * objective rewards anyway, plus the highest-protein items outright so that a large sandwich
 * is not lost to a handful of efficient small ones.
 */
const KEEP_BY_DENSITY = 30;
const KEEP_BY_PROTEIN = 15;

/**
 * Under a gram of protein a serving, an item cannot improve a protein-maximising order by
 * anything a person would notice — but the optimiser will still take it, because more is
 * more. It recommended tea: 355 ml, four calories, 0.6 g. True, and not advice.
 */
const MIN_PROTEIN_G = 1;

function candidates(menu: readonly MenuItem[], budget: number): MenuItem[] {
  const affordable = menu.filter(
    (m) => m.kcal > 0 && m.kcal <= budget && m.protein_g >= MIN_PROTEIN_G,
  );
  const byDensity = [...affordable].sort((a, b) => b.protein_g / b.kcal - a.protein_g / a.kcal);
  const byProtein = [...affordable].sort((a, b) => b.protein_g - a.protein_g);
  const kept = new Map<string, MenuItem>();
  for (const m of byDensity.slice(0, KEEP_BY_DENSITY)) kept.set(m.id, m);
  for (const m of byProtein.slice(0, KEEP_BY_PROTEIN)) kept.set(m.id, m);
  return [...kept.values()];
}

/**
 * The orders worth offering, best first.
 *
 * Empty when nothing fits, which is a real answer: with 90 calories left there is nothing
 * honest to recommend at a burger chain, and inventing something would be worse than saying so.
 */
export function bestOrders(
  menu: readonly MenuItem[],
  remaining: MacroTotals,
  opts: OrderOptions = {},
): Order[] {
  const maxLines = opts.maxLines ?? 3;
  const limit = opts.limit ?? 3;
  const maxSame = opts.maxSame ?? 2;
  if (remaining.kcal <= 0 || maxLines < 1) return [];

  const pool = candidates(menu, remaining.kcal);
  const found: Order[] = [];

  // Combinations with repetition, by index, so the same pair is never built twice.
  const walk = (start: number, lines: OrderLine[], totals: MacroTotals, servings: number) => {
    if (lines.length > 0) {
      found.push({
        lines: lines.map((l) => ({ ...l })),
        totals: {
          kcal: round1(totals.kcal),
          protein_g: round1(totals.protein_g),
          carb_g: round1(totals.carb_g),
          fat_g: round1(totals.fat_g),
          fiber_g: round1(totals.fiber_g),
        },
        density: totals.kcal > 0 ? round1((totals.protein_g / totals.kcal) * 100) : 0,
        fill: Math.round((totals.kcal / remaining.kcal) * 100) / 100,
      });
    }
    if (servings >= maxLines) return;
    for (let i = start; i < pool.length; i++) {
      const item = pool[i] as MenuItem;
      for (let n = 1; n <= Math.min(maxSame, maxLines - servings); n++) {
        const next = add(totals, item, n);
        if (next.kcal > remaining.kcal) break; // more of it will not fit either
        walk(i + 1, [...lines, { item, count: n }], next, servings + n);
      }
    }
  };
  walk(0, [], EMPTY, 0);

  // Most protein first, to the nearest gram — then the shortest order, then the smallest.
  //
  // The rounding is the important part. Compared to a tenth of a gram the optimiser will add
  // anything with a pulse: it recommended "Tea + 2 Chicken Caesar Salads" over the same two
  // salads, because 355 ml of tea carries 0.6 g of protein for four calories. True, and
  // useless — a person reading that thinks the tea is doing something. If a line does not
  // add a gram, it does not belong in the recommendation.
  const servingsOf = (o: Order) => o.lines.reduce((n, l) => n + l.count, 0);
  found.sort(
    (a, b) =>
      Math.round(b.totals.protein_g) - Math.round(a.totals.protein_g) ||
      servingsOf(a) - servingsOf(b) ||
      a.totals.kcal - b.totals.kcal,
  );

  // One order per set of items, so the list is three different answers rather than three
  // spellings of the same one.
  const seen = new Set<string>();
  const out: Order[] = [];
  for (const o of found) {
    const key = o.lines
      .map((l) => `${l.item.id}x${l.count}`)
      .sort()
      .join('+');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
    if (out.length >= limit) break;
  }
  return out;
}

/** One line a person can read: what it comes to, and what it is worth. */
export function describeOrder(o: Order): string {
  const items = o.lines
    .map((l) => (l.count > 1 ? `${l.count}× ${l.item.name}` : l.item.name))
    .join(' + ');
  return `${items} — ${Math.round(o.totals.kcal)} kcal, ${Math.round(o.totals.protein_g)} g protein`;
}
