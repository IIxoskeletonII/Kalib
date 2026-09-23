import { describe, expect, it } from 'vitest';
import {
  aisleFor,
  planSummary,
  recipeFacts,
  scalePlan,
  shoppingList,
  shoppingListText,
  type PlanInputs,
  type RecipeFacts,
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

describe('the budget is a hard constraint (§18.6)', () => {
  // Chicken at €9/kg and rice at €2/kg: the recipe below costs €9.80 raw for 2,200 g of yield.
  const prices = new Map([
    ['chicken', { food_id: 'chicken', price_per_kg: 9 }],
    ['rice', { food_id: 'rice', price_per_kg: 2 }],
    ['lettuce', { food_id: 'lettuce', price_per_kg: 4 }],
    ['oil', { food_id: 'oil', price_per_kg: 12 }],
  ]);
  const facts = [recipeFacts(chickenRice, foods, prices), recipeFacts(salad, foods, prices)];
  const base: PlanInputs = {
    kcal: 2400,
    protein_g: 160,
    days: 7,
    allowance_kcal: 0,
    allowance_protein_g: 0,
  };

  /** What the shopping list will actually total, computed independently of the scaler. */
  const listCost = (plan: ReturnType<typeof scalePlan>) =>
    shoppingList(plan, facts, foods, prices).total_cost;

  it('prices a recipe from its ingredients and knows how much of it is priced', () => {
    const f = facts[0]!;
    expect(f.cost).toBeCloseTo((1000 / 1000) * 9 + (400 / 1000) * 2, 6);
    expect(f.priced_share).toBe(1);
    expect(recipeFacts(chickenRice, foods).cost).toBe(0);
  });

  it('a budget that is not binding leaves the calorie plan alone', () => {
    const generous = scalePlan(facts, [{ recipe_id: 'cr', portions: 1 }], {
      ...base,
      budget: 200,
    });
    const free = scalePlan(facts, [{ recipe_id: 'cr', portions: 1 }], base);
    expect(generous.items).toEqual(free.items);
    expect(generous.budget_limited).toBe(false);
  });

  it('without a budget the week costs whatever the calories demand', () => {
    const free = scalePlan(facts, [{ recipe_id: 'cr', portions: 1 }], base);
    expect(free.budget_limited).toBe(false);
    expect(free.cost).toBeGreaterThan(60);
    expect(listCost(free)).toBeCloseTo(free.cost, 2);
  });

  it('with a budget the week never exceeds it, and the list agrees to the cent', () => {
    for (const budget of [25, 40, 55, 70]) {
      const plan = scalePlan(facts, [{ recipe_id: 'cr', portions: 1 }], { ...base, budget });
      expect(plan.cost, `budget ${budget}`).toBeLessThanOrEqual(budget);
      // The list is what the user will pay: it must match the projection, not merely be near it.
      expect(listCost(plan), `budget ${budget}`).toBeCloseTo(plan.cost, 2);
      // When money is what bound the week, it lands within a portion of the budget rather
      // than far under it. When calories were satisfied first, spending less is correct.
      if (plan.budget_limited) {
        const onePortion = (facts[0]!.portion_g / facts[0]!.yield_g) * facts[0]!.cost;
        expect(budget - plan.cost, `budget ${budget}`).toBeLessThanOrEqual(onePortion);
        expect(budget - plan.cost, `budget ${budget}`).toBeLessThanOrEqual(5);
      }
    }
  });

  it('drops the worst value per calorie first when two recipes compete', () => {
    // Salad is dear per calorie (oil and lettuce); chicken and rice is cheap.
    const plan = scalePlan(
      facts,
      [
        { recipe_id: 'cr', portions: 1 },
        { recipe_id: 'sal', portions: 1 },
      ],
      { ...base, budget: 30 },
    );
    const cr = plan.items.find((i) => i.recipe_id === 'cr')!;
    const sal = plan.items.find((i) => i.recipe_id === 'sal')!;
    expect(plan.cost).toBeLessThanOrEqual(30);
    expect(cr.portions).toBeGreaterThan(sal.portions);
    expect(plan.portions_dropped).toBeGreaterThan(0);
    expect(plan.budget_limited).toBe(true);
  });

  it('never touches a pinned count, and says so by staying over only when pinned', () => {
    const plan = scalePlan(facts, [{ recipe_id: 'cr', portions: 20, pinned: true }], {
      ...base,
      budget: 10,
    });
    expect(plan.items[0]!.portions).toBe(20);
    expect(plan.cost).toBeGreaterThan(10); // the user's own pin wins over the budget
  });

  it('leaves the plan alone when nothing is priced', () => {
    const unpriced = [recipeFacts(chickenRice, foods)];
    const plan = scalePlan(unpriced, [{ recipe_id: 'cr', portions: 1 }], { ...base, budget: 10 });
    expect(plan.budget_limited).toBe(false);
    expect(plan.cost).toBe(0);
  });
});

describe('budget simulation: a week never costs more than it was told to (§18.6)', () => {
  /** A deterministic pseudo-random source, so a failure is always reproducible. */
  const rng = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

  /** Ten plausible weekly plans: 2–5 recipes, mixed prices, mixed portion sizes. */
  function scenario(n: number) {
    const r = rng(n * 7919 + 13);
    const catalogue: Food[] = [
      food('chicken', 'Chicken, breast, raw', 120, 22.5, 'Poultry Products'),
      food('beef', 'Beef, mince, raw', 250, 18, 'Beef Products'),
      food('salmon', 'Salmon, raw', 208, 20, 'Finfish and Shellfish Products'),
      food('rice', 'Rice, white, raw', 360, 7, 'Cereal Grains and Pasta'),
      food('pasta', 'Pasta, dry', 371, 13, 'Cereal Grains and Pasta'),
      food('lentil', 'Lentils, dry', 352, 25, 'Legumes and Legume Products'),
      food('lettuce', 'Lettuce, raw', 15, 1.4, 'Vegetables and Vegetable Products'),
      food('oil', 'Oil, olive', 884, 0, 'Fats and Oils'),
    ];
    const all = new Map(catalogue.map((f) => [f.id, f]));
    const priceOf: Record<string, number> = {
      chicken: 9,
      beef: 12,
      salmon: 22,
      rice: 2,
      pasta: 2.5,
      lentil: 3,
      lettuce: 4,
      oil: 12,
    };
    const prices = new Map(
      catalogue.map((f) => [f.id, { food_id: f.id, price_per_kg: priceOf[f.id]! }]),
    );
    const count = 2 + Math.floor(r() * 4);
    const facts: RecipeFacts[] = [];
    for (let i = 0; i < count; i++) {
      const protein = ['chicken', 'beef', 'salmon', 'lentil'][Math.floor(r() * 4)]!;
      const carb = ['rice', 'pasta', 'lentil'][Math.floor(r() * 3)]!;
      const grams = 600 + Math.floor(r() * 900);
      const portions = 3 + Math.floor(r() * 4);
      const items: [string, number][] = [
        [protein, grams],
        [carb, 200 + Math.floor(r() * 500)],
        ['oil', 10 + Math.floor(r() * 40)],
      ];
      const rec: Recipe = {
        id: `r${i}`,
        user_id: 'local',
        created_at: '',
        updated_at: '',
        name: `Recipe ${i}`,
        items: items.map(([food_id, g]) => ({ food_id, name: all.get(food_id)!.name, grams: g })),
        yield_g: grams + 600,
        portions,
        food_id: `f-r${i}`,
      };
      facts.push(recipeFacts(rec, all, prices));
    }
    return { facts, foods: all, prices };
  }

  it('holds across 10 plans × 8 budgets, with the shopping list agreeing every time', () => {
    const failures: string[] = [];
    let binding = 0;
    for (let n = 0; n < 10; n++) {
      const { facts, foods: all, prices } = scenario(n);
      for (const budget of [25, 35, 45, 60, 75, 90, 110, 140]) {
        const inputs: PlanInputs = {
          kcal: 2200,
          protein_g: 150,
          days: 7,
          allowance_kcal: 300,
          allowance_protein_g: 20,
          budget,
        };
        const chosen = facts.map((f) => ({ recipe_id: f.recipe.id, portions: 1 }));
        const plan = scalePlan(facts, chosen, inputs);
        const list = shoppingList(plan, facts, all, prices);
        if (list.total_cost > budget + 0.01) {
          failures.push(`plan ${n} budget ${budget}: list ${list.total_cost.toFixed(2)}`);
        }
        // Whole-gram rounding, line by line, can move the total by a few cents on a big shop.
        if (Math.abs(list.total_cost - plan.cost) > 0.1) {
          failures.push(
            `plan ${n} budget ${budget}: projection ${plan.cost.toFixed(2)} vs list ${list.total_cost.toFixed(2)}`,
          );
        }
        if (plan.budget_limited) {
          binding++;
          // Whole portions cannot land exactly on the line, and the plan must never cook more
          // than the calories call for. The fit is right when nothing that is still below its
          // calorie-optimal count could be added without going over the money.
          const free = scalePlan(facts, chosen, { ...inputs, budget: 0 });
          const ceiling = new Map(free.items.map((i) => [i.recipe_id, i.portions]));
          const room = budget - plan.cost;
          for (const i of plan.items) {
            if (i.portions >= (ceiling.get(i.recipe_id) ?? 0)) continue;
            const f = facts.find((x) => x.recipe.id === i.recipe_id)!;
            const onePortion =
              f.yield_g > 0
                ? ((plan.portion_g[i.recipe_id] ?? f.portion_g) / f.yield_g) * f.cost
                : 0;
            if (onePortion > 0 && onePortion <= room - 0.05) {
              failures.push(
                `plan ${n} budget ${budget}: ${room.toFixed(2)} left but ${i.recipe_id} could take another portion at ${onePortion.toFixed(2)}`,
              );
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
    // The exercise is only meaningful if the budget actually bit often enough: it binds in
    // 31 of the 80 runs, the rest being budgets the calorie plan already fitted inside.
    expect(binding).toBeGreaterThan(25);
  });
});
