import { describe, expect, it } from 'vitest';
import {
  aisleFor,
  planSummary,
  recipeFacts,
  scalePlan,
  shoppingList,
  shoppingListText,
  type PlanInputs,
} from './planner';
import type { Food, Recipe } from './types';

const food = (id: string, name: string, kcal: number, protein: number, category: string): Food => ({
  id,
  user_id: 'local',
  created_at: '',
  updated_at: '',
  source: 'usda_sr',
  name,
  category,
  per_100g: { kcal, protein, carb: 10, fat: 3, fiber: 2 },
  micros: {},
  micro_coverage: 0,
  portions: [],
  verified: true,
});
const chicken = food('chicken', 'Chicken, breast, raw', 120, 22.5, 'Poultry Products');
const rice = food('rice', 'Rice, white, raw', 360, 7, 'Cereal Grains and Pasta');
const lettuce = food('lettuce', 'Lettuce, raw', 15, 1.4, 'Vegetables and Vegetable Products');
const oil = food('oil', 'Oil, olive', 884, 0, 'Fats and Oils');
const foods = new Map([chicken, rice, lettuce, oil].map((f) => [f.id, f]));

const recipe = (
  id: string,
  name: string,
  items: [string, number][],
  yield_g: number,
  portions: number,
): Recipe => ({
  id,
  user_id: 'local',
  created_at: '',
  updated_at: '',
  name,
  items: items.map(([food_id, grams]) => ({ food_id, name: foods.get(food_id)!.name, grams })),
  yield_g,
  portions,
  food_id: `f-${id}`,
});
// 1,000 g chicken (1,200 kcal) + 400 g rice (1,440 kcal) = 2,640 kcal, 4 portions of 550 g → 660 kcal
const chickenRice = recipe(
  'cr',
  'Chicken & rice',
  [
    ['chicken', 1000],
    ['rice', 400],
  ],
  2200,
  4,
);
// 300 g lettuce + 20 g oil = 45 + 177 = 222 kcal, 2 portions → 111 kcal
const salad = recipe(
  'sal',
  'Big salad',
  [
    ['lettuce', 300],
    ['oil', 20],
  ],
  320,
  2,
);

const inputs: PlanInputs = {
  kcal: 2200,
  protein_g: 160,
  days: 7,
  allowance_kcal: 500,
  allowance_protein_g: 30,
};

describe('recipeFacts', () => {
  it('gives whole and per-portion figures', () => {
    const f = recipeFacts(chickenRice, foods);
    expect(f.kcal).toBeCloseTo(2640);
    expect(f.portion_kcal).toBeCloseTo(660);
    expect(f.portion_protein_g).toBeCloseTo((225 + 28) / 4);
    expect(f.portion_g).toBe(550);
  });
});

describe('scalePlan', () => {
  const facts = [recipeFacts(chickenRice, foods), recipeFacts(salad, foods)];

  it('shares the weekly budget by kcal and lands within ±5%', () => {
    const plan = scalePlan(
      facts,
      [
        { recipe_id: 'cr', portions: 1 },
        { recipe_id: 'sal', portions: 1 },
      ],
      inputs,
    );
    // budget = (2200 − 500) × 7 = 11,900; each recipe gets 5,950 kcal
    expect(plan.budget_kcal).toBe(11900);
    const cr = plan.items.find((i) => i.recipe_id === 'cr')!;
    const sal = plan.items.find((i) => i.recipe_id === 'sal')!;
    expect(cr.portions).toBe(9); // 5950 / 660
    expect(sal.portions).toBe(54); // 5950 / 111 — a salad is not a meal; that is the user's call
    const total = plan.kcal_per_day * 7;
    expect(Math.abs(total - 11900) / 11900).toBeLessThan(0.05);
    expect(plan.kcal_ratio).toBeCloseTo(1, 1);
  });

  it('respects a pinned count and re-scales the rest', () => {
    const plan = scalePlan(
      facts,
      [
        { recipe_id: 'cr', portions: 7, pinned: true },
        { recipe_id: 'sal', portions: 1 },
      ],
      inputs,
    );
    expect(plan.items.find((i) => i.recipe_id === 'cr')!.portions).toBe(7);
    // remaining = 11,900 − 7 × 660 = 7,280 → 66 salads before the gram factor
    expect(plan.items.find((i) => i.recipe_id === 'sal')!.portions).toBe(66);
    expect(plan.protein_per_day).toBeGreaterThan(0);
  });

  it('bounds the gram factor so portions stay realistic', () => {
    const plan = scalePlan(facts, [{ recipe_id: 'cr', portions: 1, pinned: true }], inputs);
    // one pinned portion of 660 kcal cannot fill 11,900: factor caps at 1.3
    expect(plan.portion_g.cr).toBe(Math.round(550 * 1.3));
    expect(plan.kcal_ratio).toBeLessThan(0.5);
  });

  it('a skipped recipe (portions 0) takes no share of the week', () => {
    const plan = scalePlan(
      facts,
      [
        { recipe_id: 'cr', portions: 1 },
        { recipe_id: 'sal', portions: 0 },
      ],
      inputs,
    );
    expect(plan.items.map((i) => i.recipe_id)).toEqual(['cr']);
    expect(plan.items[0]!.portions).toBe(18); // the whole 11,900 on one recipe
  });

  it('is empty-safe', () => {
    const plan = scalePlan(facts, [], inputs);
    expect(plan.items).toEqual([]);
    expect(plan.kcal_per_day).toBe(0);
  });
});

describe('shopping list', () => {
  it('maps categories to aisles', () => {
    expect(aisleFor(chicken)).toBe('Meat & fish');
    expect(aisleFor(lettuce)).toBe('Produce');
    expect(aisleFor(oil)).toBe('Oils & spices');
    expect(aisleFor({ name: 'Peas, frozen', category: 'Vegetables and Vegetable Products' })).toBe(
      'Frozen',
    );
    expect(aisleFor({ name: 'Mystery', category: '' })).toBe('Other');
  });

  it('sums scaled ingredients across recipes, groups, and prices what it can', () => {
    const facts = [recipeFacts(chickenRice, foods), recipeFacts(salad, foods)];
    const plan = scalePlan(
      facts,
      [
        { recipe_id: 'cr', portions: 8, pinned: true },
        { recipe_id: 'sal', portions: 4, pinned: true },
      ],
      inputs,
    );
    const prices = new Map([['chicken', { food_id: 'chicken', price_per_kg: 9.5 }]]);
    const list = shoppingList(plan, facts, foods, prices);
    const meat = list.aisles.find((a) => a.aisle === 'Meat & fish')!;
    // Pinned counts still get the gram factor (here the 1.3 cap): 8 portions × 715 g of a
    // 2,200 g recipe → 2.6× the raw items → 2,600 g chicken.
    const scale = (plan.portion_g.cr! * 8) / 2200;
    expect(meat.lines[0]!.grams).toBe(Math.round(1000 * scale));
    expect(meat.lines[0]!.cost).toBeCloseTo((1000 * scale * 9.5) / 1000, 0);
    expect(list.total_cost).toBeCloseTo(meat.lines[0]!.cost!);
    expect(list.unpriced).toBe(3);
    expect(list.aisles.map((a) => a.aisle)).toEqual([
      'Produce',
      'Meat & fish',
      'Grains & pasta',
      'Oils & spices',
    ]);
    const text = shoppingListText(list, '€');
    expect(text).toMatch(/Chicken, breast — 2\.60 kg \(€24\.70\)/);
    expect(text).toContain('3 items unpriced');
  });
});

describe('planSummary (§18.2)', () => {
  const inputs: PlanInputs = {
    kcal: 2000,
    protein_g: 150,
    days: 7,
    allowance_kcal: 400,
    allowance_protein_g: 20,
  };
  const facts = [recipeFacts(chickenRice, foods), recipeFacts(salad, foods)];

  it('reads the week back in portions, days and money, and names the biggest gap', () => {
    const scaled = scalePlan(facts, [{ recipe_id: 'cr', portions: 4, pinned: true }], inputs);
    const s = planSummary(scaled, facts, inputs, 42);
    expect(s.portions).toBe(4);
    expect(s.recipes).toBe(1);
    expect(s.portions_per_day).toBeCloseTo(4 / 7, 4);
    expect(s.cost_per_day).toBeCloseTo(6, 4);
    expect(s.cost_per_portion).toBeCloseTo(10.5, 4);
    expect(s.kcal).toBeCloseTo(scaled.kcal_per_day + 400, 4);
    expect(s.protein_g).toBeCloseTo(scaled.protein_per_day + 20, 4);
    expect(s.fiber_target).toBe(28);
    expect(s.grams).toBeGreaterThan(0);
    // Chicken and rice carry little fiber, so against its own target fiber is furthest off:
    // ~5 g a day against 28 beats calories and protein as a share of their targets.
    expect(s.shortest).toBe('fiber');
    expect(s.shortest_gap).toBe(23);
  });

  it('has nothing to flag when every target is met', () => {
    const small: PlanInputs = {
      kcal: 200,
      protein_g: 5,
      days: 7,
      allowance_kcal: 0,
      allowance_protein_g: 0,
    };
    // Enough portions that even the 25 g fiber floor is cleared.
    const scaled = scalePlan(facts, [{ recipe_id: 'cr', portions: 40, pinned: true }], small);
    const s = planSummary(scaled, facts, small, 0);
    expect(s.fiber_g).toBeGreaterThanOrEqual(s.fiber_target);
    expect(s.shortest).toBeNull();
    expect(s.shortest_gap).toBe(0);
  });
});
