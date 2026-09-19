import { describe, expect, it } from 'vitest';
import { normalizeOffProduct, rankOffProducts, type OffHit } from './off';

const pringles: OffHit = {
  code: '5053990101573',
  product_name: 'Pringles Original',
  brands: ['Pringles', "Kellogg's"],
  quantity: '165g',
  serving_quantity: 30,
  unique_scans_n: 258,
  countries_tags: ['en:france', 'en:italy'],
  completeness: 0.9,
  nutriments: {
    'energy-kcal_100g': 534,
    proteins_100g: 5.9,
    carbohydrates_100g: 50,
    fat_100g: 33,
    fiber_100g: 3.1,
    sugars_100g: 2.1,
    'saturated-fat_100g': 3.1,
    salt_100g: 1.2,
  },
};

describe('normalizeOffProduct', () => {
  it('maps label nutrients and derives sodium from salt', () => {
    const p = normalizeOffProduct(pringles)!;
    expect(p.name).toBe('Pringles Original');
    expect(p.brand).toBe('Pringles');
    expect(p.serving_g).toBe(30);
    expect(p.italy).toBe(true);
    expect(p.per_100g).toEqual({
      kcal: 534,
      protein: 5.9,
      carb: 50,
      fat: 33,
      fiber: 3.1,
      sugar: 2.1,
      sat_fat: 3.1,
      sodium: 480,
    });
  });

  it('converts kJ when kcal is missing and accepts string brands', () => {
    const p = normalizeOffProduct({
      ...pringles,
      brands: 'Lays, PepsiCo',
      nutriments: { energy_100g: 2234, proteins_100g: '6', carbohydrates_100g: 50, fat_100g: 33 },
    })!;
    expect(p.per_100g.kcal).toBeCloseTo(534, 0);
    expect(p.per_100g.fiber).toBe(0);
    expect(p.brand).toBe('Lays');
  });

  it('rejects incomplete labels and nameless products', () => {
    expect(
      normalizeOffProduct({ ...pringles, nutriments: { 'energy-kcal_100g': 534 } }),
    ).toBeNull();
    expect(normalizeOffProduct({ ...pringles, product_name: '' })).toBeNull();
  });
});

describe('rankOffProducts', () => {
  it('drops incomplete and off-topic hits, prefers popular matches, dedupes', () => {
    const hits: OffHit[] = [
      { code: '1', product_name: 'Pringles', brands: ['Pringles'] }, // incomplete
      { ...pringles, code: '2', unique_scans_n: 5 },
      { ...pringles, code: '3', unique_scans_n: 300 },
      { ...pringles, code: '4', product_name: 'Pringles Sour Cream', unique_scans_n: 100 },
      {
        ...pringles,
        code: '5',
        product_name: 'Yeast Extract',
        brands: ['Marmite'],
        unique_scans_n: 900,
        countries_tags: [],
      },
    ];
    const out = rankOffProducts(hits, 'pringles original');
    // Marmite shares no term with the query → dropped even though it is the most scanned.
    expect(out.map((p) => p.code)).toEqual(['3', '4']);
  });

  it('treats apostrophes as noise', () => {
    const out = rankOffProducts(
      [{ ...pringles, product_name: "Lay's Classic", brands: ["Lay's"] }],
      'lays',
    );
    expect(out).toHaveLength(1);
  });
});
