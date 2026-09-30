import { describe, expect, it } from 'vitest';
import {
  B6_UPPER_MG,
  SUPPLEMENT_CATALOGUE,
  catalogueItem,
  doseWarning,
  formatDose,
  stackNotes,
  type Person,
  type StackItem,
} from './supplements';

const eliya: Person = { sex: 'male', age: 23, weight_kg: 110, height_cm: 186 };
const woman35: Person = { sex: 'female', age: 35, weight_kg: 62, height_cm: 165 };

describe('creatine (ISSN)', () => {
  const item = catalogueItem('creatine')!;
  it('scales with body weight inside 3–5 g', () => {
    expect(item.recommend(eliya).dose).toBe(5); // 0.045 × 110 = 4.95 → 5
    expect(item.recommend(woman35).dose).toBe(3); // 0.045 × 62 = 2.8 → 3
    expect(item.recommend({ ...eliya, weight_kg: 80 }).dose).toBe(3.5);
    expect(item.recommend({ ...eliya, weight_kg: 200 }).dose).toBe(5);
  });
  it('falls back to the plain range without a weight', () => {
    const g = item.recommend({ sex: 'male', age: 30 });
    expect(g.dose).toBe(5);
    expect(g.basis).toMatch(/3–5 g/);
  });
  it('names the weight it used', () => {
    expect(item.recommend(eliya).basis).toContain('110 kg');
    expect(item.recommend(eliya).factor).toBe('weight');
  });
});

describe('DRI-based items (NIH ODS)', () => {
  it('magnesium: RDA by sex and age band, supplement cap 350 mg', () => {
    const mg = catalogueItem('magnesium')!;
    expect(mg.recommend(eliya).basis).toContain('RDA 400 mg for men 19–30');
    expect(mg.recommend({ ...eliya, age: 40 }).basis).toContain('RDA 420 mg');
    expect(mg.recommend(woman35).basis).toContain('RDA 320 mg for women 31–50');
    expect(mg.recommend(eliya).upper).toBe(350);
    expect(mg.recommend(eliya).dose).toBeLessThanOrEqual(350);
  });
  it('vitamin D: 600 IU RDA to 70, 800 after, UL 4,000 IU', () => {
    const d = catalogueItem('vitamin_d3')!;
    expect(d.recommend(eliya).low).toBe(600);
    expect(d.recommend({ ...eliya, age: 75 }).low).toBe(800);
    expect(d.recommend(eliya).upper).toBe(4000);
    expect(d.nutrientPerUnit).toBe(0.025); // 1,000 IU = 25 µg
  });
  it('zinc and iron depend on sex (and age for iron)', () => {
    expect(catalogueItem('zinc')!.recommend(eliya).dose).toBe(11);
    expect(catalogueItem('zinc')!.recommend(woman35).dose).toBe(8);
    expect(catalogueItem('iron')!.recommend(woman35).dose).toBe(18);
    expect(catalogueItem('iron')!.recommend({ ...woman35, age: 55 }).dose).toBe(8);
    expect(catalogueItem('iron')!.recommend(eliya).dose).toBe(8);
    expect(catalogueItem('iron')!.recommend(eliya).basis).toMatch(/ferritin/);
  });
  it('calcium upper limit drops after 50', () => {
    const ca = catalogueItem('calcium')!;
    expect(ca.recommend(eliya).upper).toBe(2500);
    expect(ca.recommend({ ...woman35, age: 55 }).upper).toBe(2000);
    expect(ca.recommend({ ...woman35, age: 55 }).basis).toContain('1,200 mg');
  });
});

describe('caffeine (EFSA)', () => {
  const c = catalogueItem('caffeine')!;
  it('3 mg/kg, never above the 200 mg single dose or 400 mg/day', () => {
    const g = c.recommend(eliya);
    expect(g.dose).toBe(200); // 330 capped
    expect(g.upper).toBe(400);
    expect(c.recommend(woman35).dose).toBe(190); // 3 × 62 = 186 → 190
  });
});

describe('catalogue hygiene', () => {
  it('every item recommends within its own range and under its upper limit', () => {
    for (const item of SUPPLEMENT_CATALOGUE) {
      for (const p of [eliya, woman35, { sex: 'male' as const, age: 72 }]) {
        const g = item.recommend(p);
        expect(g.unit, item.id).toBe(item.unit);
        expect(g.dose, item.id).toBeGreaterThanOrEqual(g.low);
        expect(g.dose, item.id).toBeLessThanOrEqual(g.high);
        if (g.upper != null) expect(g.dose, item.id).toBeLessThanOrEqual(g.upper);
        expect(g.basis.length, item.id).toBeGreaterThan(10);
      }
      if (item.nutrient) expect(item.nutrientPerUnit, item.id).toBeGreaterThan(0);
    }
  });
  it('ids are unique', () => {
    const ids = SUPPLEMENT_CATALOGUE.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('formatting and warnings', () => {
  it('formats doses', () => {
    expect(formatDose(5, 'g')).toBe('5 g');
    expect(formatDose(1000, 'IU')).toBe('1,000 IU');
    expect(formatDose(1, 'capsule')).toBe('1 capsule');
    expect(formatDose(2, 'capsule')).toBe('2 capsules');
    expect(formatDose(2.5, 'g')).toBe('2.5 g');
  });
  it('flags doses over the upper limit or far over the usual', () => {
    const mg = catalogueItem('magnesium')!.recommend(eliya);
    expect(doseWarning(300, mg)).toBeUndefined();
    expect(doseWarning(500, mg)).toMatch(/upper limit/);
    const cr = catalogueItem('creatine')!.recommend(eliya);
    expect(doseWarning(20, cr)).toMatch(/usual 5 g/);
  });
});

describe('vitamin B6 uses the limit that actually applies', () => {
  it('carries the EFSA 2023 upper level, not the older permissive figure', () => {
    const guide = catalogueItem('b6')!.recommend({ sex: 'male', age: 23 });
    expect(guide.upper).toBe(B6_UPPER_MG);
    expect(guide.upper).toBe(12);
    expect(guide.basis).toContain('EFSA 2023');
  });

  it('flags a single dose over that limit', () => {
    const guide = catalogueItem('b6')!.recommend({ sex: 'male', age: 23 });
    expect(doseWarning(50, guide)).toContain('upper limit');
    expect(doseWarning(2, guide)).toBeUndefined();
  });
});

describe('stackNotes', () => {
  const item = (over: Partial<StackItem>): StackItem => ({
    name: 'Thing',
    dose: 1,
    unit: 'mg',
    timing: 'any',
    ...over,
  });
  const iron = item({ name: 'Iron', nutrient: 'iron', dose: 18, timing: 'morning' });
  const calcium = item({ name: 'Calcium', nutrient: 'calcium', dose: 500, timing: 'morning' });
  const vitC = item({ name: 'Vitamin C', nutrient: 'vit_c', dose: 200, timing: 'morning' });

  it('says nothing about an empty or harmless stack', () => {
    expect(stackNotes([])).toEqual([]);
    expect(stackNotes([item({ name: 'Creatine', dose: 5, unit: 'g' })])).toEqual([]);
  });

  it('spots calcium and iron taken together', () => {
    const notes = stackNotes([iron, calcium]);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.kind).toBe('conflict');
    expect(notes[0]!.items).toEqual(['Iron', 'Calcium']);
    expect(notes[0]!.text).toContain('2 hours');
  });

  it('stays quiet once they are at different times of day', () => {
    expect(stackNotes([iron, { ...calcium, timing: 'evening' }])).toEqual([]);
  });

  it('never treats an any-time dose as a clash, because it can simply be moved', () => {
    expect(
      stackNotes([
        { ...iron, timing: 'any' },
        { ...calcium, timing: 'any' },
      ]),
    ).toEqual([]);
  });

  it('adds up B6 across the whole stack, not just one bottle', () => {
    const notes = stackNotes([
      item({ name: 'B complex', nutrient: 'b6', dose: 10 }),
      item({ name: 'Extra B6', nutrient: 'b6', dose: 5 }),
    ]);
    expect(notes[0]!.text).toContain('15 mg of vitamin B6');
    expect(notes[0]!.text).toContain('EFSA 2023');
    expect(notes[0]!.items).toEqual(['B complex', 'Extra B6']);
  });

  it('accepts a B6 total inside the limit without comment', () => {
    expect(stackNotes([item({ name: 'B complex', nutrient: 'b6', dose: 10 })])).toEqual([]);
  });

  it('warns about long-term high zinc with no copper alongside it', () => {
    const zinc = item({ name: 'Zinc', nutrient: 'zinc', dose: 40 });
    expect(stackNotes([zinc])[0]!.text).toContain('lowers copper');
    const withCopper = stackNotes([zinc, item({ name: 'Copper', nutrient: 'copper', dose: 2 })]);
    expect(withCopper).toEqual([]);
  });

  it('points out the pairing that helps rather than only the ones that hurt', () => {
    const notes = stackNotes([iron, vitC]);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.kind).toBe('tip');
    expect(notes[0]!.text).toContain('helps the iron absorb');
  });

  it('reminds fat-soluble vitamins to ride along with a meal', () => {
    const d = item({ name: 'Vitamin D3', nutrient: 'vit_d', dose: 4000, unit: 'IU' });
    expect(stackNotes([d])[0]!.text).toContain('some fat in it');
    expect(stackNotes([{ ...d, timing: 'with_food' }])).toEqual([]);
  });

  it('puts what costs absorption before what would merely improve it', () => {
    const notes = stackNotes([iron, calcium, vitC]);
    expect(notes[0]!.kind).toBe('conflict');
    expect(notes[notes.length - 1]!.kind).toBe('tip');
  });
});
