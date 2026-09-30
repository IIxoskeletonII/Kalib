import { describe, expect, it } from 'vitest';
import {
  parseIngredientLine,
  parseIngredientLines,
  parseQuantity,
  searchTermFor,
} from './ingredientLine';

describe('parseQuantity', () => {
  it('reads whole numbers and decimals', () => {
    expect(parseQuantity('250 g flour')).toMatchObject({ value: 250 });
    expect(parseQuantity('1.5 kg beef')).toMatchObject({ value: 1.5 });
    expect(parseQuantity('1,5 kg beef')).toMatchObject({ value: 1.5 });
  });

  it('reads written fractions', () => {
    expect(parseQuantity('1/2 cup rice')).toMatchObject({ value: 0.5 });
    expect(parseQuantity('1 1/2 cups rice')).toMatchObject({ value: 1.5 });
    expect(parseQuantity('3 / 4 cup milk')).toMatchObject({ value: 0.75 });
  });

  it('reads the fraction glyphs recipe sites actually publish', () => {
    expect(parseQuantity('½ cup rice')).toMatchObject({ value: 0.5 });
    expect(parseQuantity('¼ tsp salt')).toMatchObject({ value: 0.25 });
    expect(parseQuantity('1½ cups flour')).toMatchObject({ value: 1.5 });
    expect(parseQuantity('⅓ cup oats')).toMatchObject({ value: 1 / 3 });
  });

  it('takes the lower bound of a range, which is the honest end', () => {
    expect(parseQuantity('2-3 cloves garlic')).toMatchObject({ value: 2 });
    expect(parseQuantity('2 to 3 onions')).toMatchObject({ value: 2 });
    expect(parseQuantity('2–3 tbsp oil')).toMatchObject({ value: 2 });
  });

  it('is undefined when the line opens with no number', () => {
    expect(parseQuantity('salt and pepper')).toBeUndefined();
    expect(parseQuantity('')).toBeUndefined();
  });
});

describe('searchTermFor', () => {
  it('drops preparation words that only get in a search’s way', () => {
    expect(searchTermFor('finely chopped fresh flat-leaf parsley')).toBe('flat-leaf parsley');
    expect(searchTermFor('large free-range eggs')).toBe('free-range eggs');
    expect(searchTermFor('good quality olive oil')).toBe('olive oil');
  });

  it('drops brackets and punctuation', () => {
    expect(searchTermFor('tomatoes (chopped, tinned)')).toBe('tomatoes');
  });

  it('keeps it to four words', () => {
    expect(searchTermFor('one two three four five six').split(' ')).toHaveLength(4);
  });
});

describe('parseIngredientLine — weights', () => {
  it('reads a plain metric weight', () => {
    const p = parseIngredientLine('250 g red lentils');
    expect(p.grams).toBe(250);
    expect(p.basis).toBe('weight');
    expect(p.name).toBe('red lentils');
    expect(p.term).toBe('red lentils');
    expect(p.seasoning).toBe(false);
  });

  it('converts kilos, ounces and pounds', () => {
    expect(parseIngredientLine('1.5 kg potatoes').grams).toBe(1500);
    expect(parseIngredientLine('8 oz cream cheese').grams).toBeCloseTo(226.8, 1);
    expect(parseIngredientLine('1 lb minced beef').grams).toBeCloseTo(453.6, 1);
  });

  it('handles "of" between the unit and the food', () => {
    const p = parseIngredientLine('500 g of plain flour');
    expect(p.grams).toBe(500);
    expect(p.name).toBe('plain flour');
  });

  it('reads a unit written with a full stop', () => {
    expect(parseIngredientLine('2 tbsp. olive oil').grams).toBe(30);
  });
});

describe('parseIngredientLine — volumes and spoons', () => {
  it('treats millilitres as grams, which is what a recipe writer means', () => {
    expect(parseIngredientLine('200 ml whole milk').grams).toBe(200);
    expect(parseIngredientLine('1 l stock').grams).toBe(1000);
    expect(parseIngredientLine('200 ml milk').basis).toBe('volume');
  });

  it('reads spoons and cups', () => {
    expect(parseIngredientLine('2 tbsp olive oil').grams).toBe(30);
    expect(parseIngredientLine('1 tsp cumin').grams).toBe(5);
    expect(parseIngredientLine('1/2 cup basmati rice').grams).toBe(120);
    expect(parseIngredientLine('2 tbsp olive oil').basis).toBe('measure');
  });
});

describe('parseIngredientLine — packages', () => {
  it('assumes the standard size of a tin', () => {
    const p = parseIngredientLine('1 tin chopped tomatoes');
    expect(p.grams).toBe(400);
    expect(p.basis).toBe('package');
    expect(p.name).toBe('chopped tomatoes');
  });

  it('prefers a printed weight over the assumption', () => {
    const p = parseIngredientLine('1 tin (400 g) chopped tomatoes');
    expect(p.grams).toBe(400);
    expect(p.basis).toBe('weight');
    expect(p.name).toBe('chopped tomatoes');
  });

  it('multiplies a printed weight by the count', () => {
    expect(parseIngredientLine('2 cans (400 g) black beans').grams).toBe(800);
  });
});

describe('parseIngredientLine — bare counts', () => {
  it('returns a count and no grams, leaving the weight to the food itself', () => {
    const p = parseIngredientLine('2 large eggs');
    expect(p.grams).toBeUndefined();
    expect(p.count).toBe(2);
    expect(p.basis).toBe('count');
    expect(p.term).toBe('eggs');
  });

  it('does the same for anything countable', () => {
    expect(parseIngredientLine('1 onion, finely chopped')).toMatchObject({
      count: 1,
      name: 'onion',
    });
    expect(parseIngredientLine('3 cloves garlic').grams).toBe(9); // a clove is a known measure
  });
});

describe('parseIngredientLine — what it refuses to invent', () => {
  it('marks seasoning as such rather than guessing a weight', () => {
    for (const line of [
      'salt and pepper',
      'Salt and pepper to taste',
      'freshly ground black pepper',
    ]) {
      const p = parseIngredientLine(line);
      expect(p.seasoning, line).toBe(true);
      expect(p.grams).toBeUndefined();
    }
  });

  it('keeps a quantity-free line with no grams, for the person to fill in', () => {
    const p = parseIngredientLine('a splash of olive oil');
    expect(p.grams).toBeUndefined();
    expect(p.count).toBeUndefined();
    expect(p.seasoning).toBe(false);
    expect(p.term).toBe('olive oil');
  });

  it('always keeps the published line, so nothing is lost in translation', () => {
    const raw = '1 tin (400 g) chopped tomatoes';
    expect(parseIngredientLine(raw).raw).toBe(raw);
  });

  it('survives an empty line', () => {
    expect(parseIngredientLine('   ')).toMatchObject({ term: '', name: '', seasoning: true });
  });
});

describe('parseIngredientLines', () => {
  it('reads a whole published list and drops only the blanks', () => {
    const out = parseIngredientLines([
      '250 g red lentils',
      '',
      '2 tbsp olive oil',
      '1 tin chopped tomatoes',
      'salt and pepper',
      '   ',
    ]);
    expect(out.map((p) => p.name)).toEqual([
      'red lentils',
      'olive oil',
      'chopped tomatoes',
      'salt and pepper',
    ]);
    expect(out.map((p) => p.grams)).toEqual([250, 30, 400, undefined]);
  });
});
