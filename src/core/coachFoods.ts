// The coach's repertoire (SPEC §16.2). A human coach recommends from a few dozen everyday foods,
// not from 7,000 database rows — nutrient density alone surfaces dried radish and ginkgo nuts.
// Each pattern picks one database row (Foundation preferred); foods the user already logs are
// added to the pool by the service regardless of this list.
import type { Food } from './types';

export interface EverydayFood {
  match: RegExp;
  /** Serving in grams when the database portion is silly or missing. */
  grams?: number;
}

export const EVERYDAY_FOODS: EverydayFood[] = [
  // Legumes
  { match: /^lentils, mature seeds, cooked/i, grams: 150 },
  { match: /^chickpeas.*cooked/i, grams: 150 },
  { match: /^beans, black, mature seeds, cooked/i, grams: 150 },
  { match: /^beans, kidney, (all types|red), mature seeds, cooked/i, grams: 150 },
  { match: /^beans, white, mature seeds, cooked/i, grams: 150 },
  { match: /^beans, pinto, mature seeds, cooked/i, grams: 150 },
  { match: /^peas, split, mature seeds, cooked/i, grams: 150 },
  { match: /^edamame, frozen, (prepared|unprepared)/i, grams: 100 },
  { match: /^hummus, commercial/i, grams: 60 },
  // Whole grains
  { match: /^cereals, oats, regular and quick, not fortified, dry/i, grams: 50 },
  { match: /^quinoa, cooked/i, grams: 150 },
  { match: /^barley, pearled, cooked/i, grams: 150 },
  { match: /^bulgur, cooked/i, grams: 150 },
  { match: /^rice, brown, long-grain, cooked/i, grams: 150 },
  { match: /^pasta, whole-wheat, cooked/i, grams: 150 },
  { match: /^bread, whole-wheat, commercially prepared$/i, grams: 60 },
  { match: /^snacks, popcorn, air-popped$/i, grams: 30 },
  { match: /^sweet potato, cooked, baked in skin, flesh, without salt/i, grams: 150 },
  { match: /^potatoes, baked, flesh and skin, without salt/i, grams: 150 },
  // Fruit
  { match: /^raspberries, raw/i, grams: 125 },
  { match: /^blackberries, raw/i, grams: 125 },
  { match: /^blueberries, raw/i, grams: 125 },
  { match: /^strawberries, raw/i, grams: 150 },
  { match: /^pears, raw$|^pears, raw, bartlett/i, grams: 180 },
  { match: /^apples, raw, with skin/i, grams: 180 },
  { match: /^bananas, raw/i, grams: 120 },
  { match: /^oranges, raw, all commercial varieties/i, grams: 150 },
  { match: /^kiwifruit, green, raw/i, grams: 150 },
  { match: /^avocados, raw, all commercial varieties/i, grams: 70 },
  { match: /^figs, dried, uncooked/i, grams: 40 },
  { match: /^plums, dried \(prunes\), uncooked/i, grams: 40 },
  // Vegetables
  { match: /^broccoli, (raw|cooked, boiled, drained, without salt)/i, grams: 150 },
  { match: /^brussels sprouts, (raw|cooked, boiled, drained, without salt)/i, grams: 150 },
  { match: /^artichokes, \(globe or french\), cooked/i, grams: 120 },
  { match: /^carrots, raw/i, grams: 100 },
  { match: /^spinach, cooked, boiled, drained, without salt/i, grams: 150 },
  { match: /^kale, raw/i, grams: 100 },
  { match: /^peas, green, (raw|frozen, cooked)/i, grams: 120 },
  { match: /^corn, sweet, yellow, cooked/i, grams: 120 },
  { match: /^squash, winter, butternut, cooked/i, grams: 150 },
  { match: /^cabbage, raw/i, grams: 120 },
  // Nuts & seeds
  { match: /^seeds, chia seeds, dried/i, grams: 25 },
  { match: /^seeds, flaxseed/i, grams: 20 },
  { match: /^seeds, pumpkin and squash seed kernels, dried/i, grams: 30 },
  { match: /^nuts, almonds$/i, grams: 30 },
  { match: /^nuts, pistachio nuts, raw/i, grams: 30 },
  { match: /^nuts, walnuts, english/i, grams: 30 },
  { match: /^peanut butter, smooth style, with salt/i, grams: 30 },
  // Protein
  {
    match:
      /^chicken, broiler or fryers, breast, skinless, boneless, meat only, cooked, (roasted|grilled)/i,
    grams: 150,
  },
  { match: /^turkey, (whole|retail parts), breast, meat only, cooked, roasted/i, grams: 150 },
  { match: /^egg, whole, cooked, hard-boiled/i, grams: 100 },
  { match: /^egg, white, raw, fresh/i, grams: 120 },
  { match: /^yogurt, greek, plain, nonfat/i, grams: 200 },
  { match: /^yogurt, greek, plain, lowfat/i, grams: 200 },
  { match: /^cheese, cottage, lowfat, 2% milkfat/i, grams: 200 },
  { match: /^fish, tuna, light, canned in water, drained solids/i, grams: 120 },
  { match: /^fish, salmon, atlantic, farmed, cooked, dry heat/i, grams: 150 },
  { match: /^fish, cod, atlantic, cooked, dry heat/i, grams: 150 },
  { match: /^crustaceans, shrimp, cooked/i, grams: 150 },
  { match: /^beef, ground, 93% lean meat \/ 7% fat, patty, cooked, broiled/i, grams: 150 },
  {
    match:
      /^beef, round, top round, separable lean only, trimmed to 0" fat, choice, cooked, braised/i,
    grams: 150,
  },
  { match: /^pork, fresh, loin, tenderloin, separable lean only, cooked, roasted/i, grams: 150 },
  { match: /^tofu, firm, prepared with calcium sulfate/i, grams: 150 },
  { match: /^tempeh$/i, grams: 120 },
  { match: /^cheese, mozzarella, part skim milk$/i, grams: 60 },
  {
    match: /^milk, nonfat, fluid, with added vitamin a and vitamin d \(fat free or skim\)/i,
    grams: 250,
  },
];

/** Lower is better: Foundation first, unsalted before salted, then the shortest (most generic) name. */
function rank(f: Food): number {
  return (
    (f.source === 'usda_foundation' ? 0 : 1000) +
    (/without salt|unsalted/i.test(f.name) ? 0 : /with salt/i.test(f.name) ? 500 : 250) +
    f.name.length
  );
}

/** One database row per pattern by `rank`. */
export function selectEverydayPool(foods: readonly Food[]): Map<string, EverydayFood> {
  const pool = new Map<string, EverydayFood>();
  for (const spec of EVERYDAY_FOODS) {
    let best: Food | undefined;
    for (const f of foods) {
      if (!spec.match.test(f.name)) continue;
      if (!best || rank(f) < rank(best)) best = f;
    }
    if (best) pool.set(best.id, spec);
  }
  return pool;
}
