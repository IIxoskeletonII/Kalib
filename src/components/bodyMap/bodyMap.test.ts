import { describe, expect, it } from 'vitest';
import {
  MAP_MUSCLES,
  planBalance,
  REGION_MUSCLE,
  UNDRAWN,
  type MappedRegion,
} from '@/core/balance';
import { MUSCLE_LABEL } from '@/core/muscles';
import type { Muscle } from '@/core/types';
import {
  BACK_OUTLINE,
  BACK_PARTS,
  BACK_VIEWBOX,
  FRONT_OUTLINE,
  FRONT_PARTS,
  FRONT_VIEWBOX,
  type AnatomyPart,
} from './anatomy';
import { describeMap, levelFill, VIEWBOX } from './BodyMap';

const slugs = (parts: readonly AnatomyPart[]) => parts.map((p) => p.slug);

describe('the anatomy data', () => {
  it('has a front and a back that share one coordinate space', () => {
    expect(FRONT_VIEWBOX).toBe('0 0 724 1448');
    expect(BACK_VIEWBOX).toBe('724 0 724 1448');
    expect(FRONT_OUTLINE.startsWith('M')).toBe(true);
    expect(BACK_OUTLINE.startsWith('M')).toBe(true);
  });

  it('draws every part with at least one closed-off path', () => {
    for (const p of [...FRONT_PARTS, ...BACK_PARTS]) {
      expect(p.paths.length, p.slug).toBeGreaterThan(0);
      for (const d of p.paths) {
        expect(d, p.slug).toMatch(/^M\s?[\d.]/);
        expect(d.length, p.slug).toBeGreaterThan(20);
      }
    }
  });

  it('lists each part once per side', () => {
    for (const parts of [FRONT_PARTS, BACK_PARTS]) {
      expect(new Set(slugs(parts)).size).toBe(parts.length);
    }
  });

  it('has a region on the figure for every mapped region name', () => {
    const drawn = new Set([...slugs(FRONT_PARTS), ...slugs(BACK_PARTS)]);
    for (const region of Object.keys(REGION_MUSCLE)) expect(drawn.has(region as never)).toBe(true);
  });

  it('splits the lats from the shoulder-blade muscles, one shape a side', () => {
    const lats = BACK_PARTS.find((p) => p.slug === 'lats')!;
    const upper = BACK_PARTS.find((p) => p.slug === 'upper-back')!;
    expect(lats.paths).toHaveLength(2);
    expect(upper.paths).toHaveLength(4);
    for (const d of lats.paths) expect(upper.paths).not.toContain(d);
    // The lat is the biggest shape on its side.
    const longest = Math.max(...upper.paths.map((d) => d.length));
    for (const d of lats.paths) expect(d.length).toBeGreaterThan(longest);
  });

  it('puts the front-only and back-only muscles on the side you would see them', () => {
    const front = slugs(FRONT_PARTS);
    const back = slugs(BACK_PARTS);
    for (const s of ['chest', 'abs', 'obliques', 'biceps', 'quadriceps'] as const) {
      expect(front).toContain(s);
      expect(back).not.toContain(s);
    }
    for (const s of ['lats', 'upper-back', 'lower-back', 'gluteal', 'hamstring'] as const) {
      expect(back).toContain(s);
      expect(front).not.toContain(s);
    }
    for (const s of ['deltoids', 'trapezius', 'triceps', 'forearm', 'calves'] as const) {
      expect(front).toContain(s);
      expect(back).toContain(s);
    }
  });

  it('draws every muscle the app counts, except the one with no surface to draw', () => {
    const drawnMuscles = new Set<Muscle>(Object.values(REGION_MUSCLE));
    for (const m of MAP_MUSCLES) {
      if (UNDRAWN.includes(m)) continue;
      expect(drawnMuscles.has(m), m).toBe(true);
    }
    // Every region maps to a real muscle with a label.
    for (const [region, m] of Object.entries(REGION_MUSCLE) as [MappedRegion, Muscle][]) {
      expect(MUSCLE_LABEL[m], region).toBeTruthy();
    }
  });
});

describe('levelFill', () => {
  it('is grey for none, the accent for full, and a mix between', () => {
    expect(levelFill(0)).toBe('var(--surface-3)');
    expect(levelFill(3)).toBe('var(--accent)');
    expect(levelFill(1)).toMatch(
      /^color-mix\(in srgb, var\(--accent\) \d+%, var\(--surface-3\)\)$/,
    );
    const pct = (s: string) => Number(/(\d+)%/.exec(s)![1]);
    expect(pct(levelFill(1))).toBeLessThan(pct(levelFill(2)));
  });
});

describe('describeMap', () => {
  it('says what is trained, what has some work, and what has none', () => {
    const r = planBalance(
      [
        {
          id: 'a',
          items: [
            { exercise_id: 'bench', name: 'Bench', load_type: 'weight_reps', sets: 12 },
            { exercise_id: 'curl', name: 'Curl', load_type: 'weight_reps', sets: 3 },
          ],
        },
      ],
      new Map([
        [
          'bench',
          {
            id: 'bench',
            name: 'Barbell Bench Press',
            primary_muscle: 'chest' as const,
            secondary_muscles: [],
            equipment: 'barbell',
            load_type: 'weight_reps' as const,
            category: 'strength' as const,
          },
        ],
        [
          'curl',
          {
            id: 'curl',
            name: 'Barbell Curl',
            primary_muscle: 'biceps' as const,
            secondary_muscles: [],
            equipment: 'barbell',
            load_type: 'weight_reps' as const,
            category: 'strength' as const,
          },
        ],
      ]),
    );
    const s = describeMap(r);
    expect(s).toMatch(/^Muscle map\./);
    expect(s).toContain('Ten or more sets a week: Chest.');
    expect(s).toContain('Some work: Biceps.');
    expect(s).toMatch(/Not trained: .*Calves/);
    // Muscles nobody is held to are not reported as missing.
    expect(s).not.toMatch(/Not trained: .*Forearms/);
    expect(s).not.toContain('Neck');
  });
});

describe('the cropped view', () => {
  const box = (v: string) => v.split(' ').map(Number) as [number, number, number, number];
  // The drawn extent, measured with getBBox over every path (x0, y0, x1, y1).
  const DRAWN = {
    front: [53.1, 96.5, 675.2, 1340.5],
    back: [772.7, 96.5, 1394.3, 1341.6],
  } as const;

  it.each(['front', 'back'] as const)(
    '%s keeps the whole figure, inside the source view',
    (side) => {
      const [x, y, w, h] = box(VIEWBOX[side]);
      const [sx, sy, sw, sh] = box(side === 'front' ? FRONT_VIEWBOX : BACK_VIEWBOX);
      expect(x).toBeGreaterThanOrEqual(sx);
      expect(y).toBeGreaterThanOrEqual(sy);
      expect(x + w).toBeLessThanOrEqual(sx + sw);
      expect(y + h).toBeLessThanOrEqual(sy + sh);
      const [x0, y0, x1, y1] = DRAWN[side];
      expect(x).toBeLessThanOrEqual(x0);
      expect(y).toBeLessThanOrEqual(y0);
      expect(x + w).toBeGreaterThanOrEqual(x1);
      expect(y + h).toBeGreaterThanOrEqual(y1);
    },
  );

  it('crops both views to the same size, so they sit side by side at one scale', () => {
    expect(box(VIEWBOX.front).slice(2)).toEqual(box(VIEWBOX.back).slice(2));
  });
});

describe('a single session', () => {
  const cat = new Map([
    [
      'pulldown',
      {
        id: 'pulldown',
        name: 'Cable Bar Lateral Pulldown',
        primary_muscle: 'lats' as const,
        secondary_muscles: ['biceps' as const],
        equipment: 'cable',
        load_type: 'weight_reps' as const,
        category: 'strength' as const,
      },
    ],
  ]);
  const day = planBalance(
    [
      {
        id: 'd',
        items: [{ exercise_id: 'pulldown', name: 'P', load_type: 'weight_reps', sets: 6 }],
      },
    ],
    cat,
  );

  it('names what the day is built around, and does not list what it leaves alone', () => {
    const s = describeMap(day, 'session');
    expect(s).toContain('Mostly: Lats.');
    expect(s).toContain('Also: Biceps.');
    expect(s).not.toContain('Not trained');
  });

  it('on the week scale, the same day reads as some work and a list of gaps', () => {
    const s = describeMap(day);
    expect(s).toContain('Some work: Lats, Biceps.');
    expect(s).toContain('Not trained:');
  });
});
