import { describe, expect, it } from 'vitest';
import {
  MAP_MUSCLES,
  MAX_ROUTINE_SETS,
  MAX_SUGGESTIONS,
  PAIRS,
  REGION_MUSCLE,
  UNDRAWN,
  applyTo,
  deficitLabel,
  deficitSets,
  deficits,
  describeDeficit,
  describeFix,
  formatSets,
  deltHead,
  deltShares,
  fillLevel,
  inferEquipment,
  planBalance,
  regionSets,
  statusOf,
  suggestFixes,
  type BalanceExercise,
  type BalanceFix,
} from './balance';
import { MAX_EXERCISES_PER_DAY, PROGRAMMED } from './program';
import { MAX_SETS, MIN_SETS } from './trainingLoad';
import type { Muscle, Routine, RoutineItem } from './types';

// ----------------------------------------------------------------------------------- fixtures

function ex(
  id: string,
  name: string,
  primary: Muscle,
  secondary: Muscle[] = [],
  equipment = 'barbell',
  extra: Partial<BalanceExercise> = {},
): BalanceExercise {
  return {
    id,
    name,
    primary_muscle: primary,
    secondary_muscles: secondary,
    equipment,
    load_type: equipment === 'body weight' ? 'bodyweight_reps' : 'weight_reps',
    category: 'strength',
    difficulty: 'beginner',
    ...extra,
  };
}

/** A small library with real names, so staple ranking is exercised as it is in the app. */
const LIB: BalanceExercise[] = [
  ex('bench', 'Bench Press (Barbell)', 'chest', ['shoulders', 'triceps']),
  ex('incline', 'Incline Bench Press (Barbell)', 'chest', ['shoulders', 'triceps']),
  ex('dbbench', 'Bench Press (Dumbbell)', 'chest', ['shoulders', 'triceps'], 'dumbbell'),
  ex('fly', 'Pec Deck (Machine)', 'chest', [], 'leverage machine'),
  ex('cablefly', 'Cable Standing Fly', 'chest', ['shoulders'], 'cable'),
  ex('pushup', 'Push-Up', 'chest', ['shoulders', 'triceps'], 'body weight'),
  ex('pushdown', 'Triceps Pushdown (Cable)', 'triceps', [], 'cable'),
  ex('skull', 'Skull Crusher (Barbell)', 'triceps'),
  ex('dbext', 'Skull Crusher (Dumbbell)', 'triceps', [], 'dumbbell'),
  ex('ohp', 'Overhead Press (Barbell)', 'shoulders', ['triceps']),
  ex('dbpress', 'Shoulder Press (Dumbbell)', 'shoulders', ['triceps'], 'dumbbell'),
  ex('lateral', 'Lateral Raise (Dumbbell)', 'shoulders', [], 'dumbbell'),
  ex('revfly', 'Reverse Fly (Dumbbell)', 'shoulders', ['upper back'], 'dumbbell'),
  ex('bandrev', 'Band Reverse Fly', 'shoulders', ['upper back'], 'band'),
  ex('rearrow', 'Rear Delt Row (Cable)', 'shoulders', ['upper back'], 'cable'),
  ex('pulldown', 'Lat Pulldown (Cable)', 'lats', ['biceps'], 'cable'),
  ex('bbrow', 'Bent Over Row (Barbell)', 'lats', ['upper back', 'biceps']),
  ex('dbrow', 'Single-Arm Row (Dumbbell)', 'lats', ['upper back', 'biceps'], 'dumbbell'),
  ex('chin', 'Chin-Up', 'lats', ['biceps'], 'body weight'),
  ex('seatedrow', 'Seated Row (Cable)', 'upper back', ['lats', 'biceps'], 'cable'),
  ex('leverrow', 'Seated Row (Machine)', 'upper back', ['lats', 'biceps'], 'leverage machine'),
  ex('curl', 'Bicep Curl (Barbell)', 'biceps', ['forearms']),
  ex('dbcurl', 'Bicep Curl (Dumbbell)', 'biceps', ['forearms'], 'dumbbell'),
  ex('squat', 'Squat (Barbell)', 'quads', ['glutes', 'hamstrings']),
  ex('goblet', 'Goblet Squat (Dumbbell)', 'quads', ['glutes'], 'dumbbell'),
  ex('legext', 'Leg Extension (Machine)', 'quads', [], 'leverage machine'),
  ex('legcurl', 'Lying Leg Curl (Machine)', 'hamstrings', [], 'leverage machine'),
  ex('seatcurl', 'Seated Leg Curl (Machine)', 'hamstrings', [], 'leverage machine'),
  ex('rdl', 'Romanian Deadlift (Barbell)', 'glutes', ['hamstrings', 'lower back']),
  ex('bridge', 'Glute Bridge (Barbell)', 'glutes', ['hamstrings']),
  ex('calf', 'Standing Calf Raise (Machine)', 'calves', [], 'leverage machine'),
  ex('dbcalf', 'Standing Calf Raise (Dumbbell)', 'calves', [], 'dumbbell'),
  ex('bwcalf', 'Bodyweight Calf Raise', 'calves', [], 'body weight'),
  ex('crunch', 'Cable Crunch', 'abs', [], 'cable'),
  ex('situp', '3/4 Sit-Up', 'abs', ['quads', 'lower back'], 'body weight'),
  ex('shrug', 'Barbell Shrug', 'traps'),
  ex('row-erg', 'Rowing Machine', 'cardio', ['lats'], 'leverage machine', { category: 'cardio' }),
  ex('muscleup', 'Muscle Up', 'lats', ['triceps'], 'body weight', { difficulty: 'advanced' }),
  ex('hook', 'Boxing Left Hook', 'shoulders', [], 'body weight'),
  ex('tyre', 'Tire Flip', 'glutes', ['quads'], 'tire'),
];
const CAT = new Map(LIB.map((e) => [e.id, e]));

function item(id: string, sets = 3, extra: Partial<RoutineItem> = {}): RoutineItem {
  const e = CAT.get(id);
  return {
    exercise_id: id,
    name: e?.name ?? id,
    load_type: e?.load_type ?? 'weight_reps',
    sets,
    ...extra,
  };
}

let order = 0;
function routine(id: string, name: string, items: RoutineItem[]): Routine {
  return {
    id,
    name,
    items,
    sort_order: order++,
    source: 'own',
    user_id: 'local',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };
}

const sets = (r: ReturnType<typeof planBalance>, m: Muscle) =>
  r.muscles.find((x) => x.muscle === m)!.sets;

/**
 * The user's own split: chest and triceps, back and biceps, legs, shoulders and triceps. As
 * typically written it has no hamstring isolation, no calves and no rear delts.
 */
function userSplit(): Routine[] {
  order = 0;
  return [
    routine('push-a', 'Chest & Tri', [
      item('bench', 4),
      item('incline'),
      item('fly'),
      item('pushdown'),
    ]),
    routine('pull', 'Back & Bi', [
      item('pulldown', 4),
      item('bbrow'),
      item('seatedrow'),
      item('curl'),
    ]),
    routine('legs', 'Legs', [item('squat', 4), item('legext'), item('crunch')]),
    routine('push-b', 'Shoulders & Tri', [item('ohp', 4), item('lateral'), item('skull')]),
  ];
}

// ----------------------------------------------------------------------------------- planBalance

describe('planBalance', () => {
  it('reports every muscle untrained and every pair empty with no routines', () => {
    const r = planBalance([], CAT);
    expect(r.routines).toBe(0);
    expect(r.muscles.map((m) => m.muscle)).toEqual(MAP_MUSCLES);
    expect(r.muscles.every((m) => m.sets === 0 && m.status === 'untrained')).toBe(true);
    expect(r.pairs.every((p) => p.verdict === 'none')).toBe(true);
    expect(r.delts).toEqual({ front: 0, side: 0, rear: 0 });
  });

  it('never lists cardio as a muscle', () => {
    expect(MAP_MUSCLES).not.toContain('cardio');
    const r = planBalance([routine('c', 'Cardio', [item('row-erg', 5)])], CAT);
    expect(r.muscles.find((m) => (m.muscle as string) === 'cardio')).toBeUndefined();
    // The rower's assisting lats still count, at half.
    expect(sets(r, 'lats')).toBe(2.5);
  });

  it('counts the aimed muscle whole and each assisting muscle at half', () => {
    const r = planBalance([routine('a', 'A', [item('bench', 4)])], CAT);
    expect(sets(r, 'chest')).toBe(4);
    expect(sets(r, 'triceps')).toBe(2);
    expect(sets(r, 'shoulders')).toBe(2);
    const chest = r.muscles.find((m) => m.muscle === 'chest')!;
    expect(chest.direct_sets).toBe(4);
    expect(r.muscles.find((m) => m.muscle === 'triceps')!.direct_sets).toBe(0);
  });

  it('does not count a primary muscle twice when it is also listed as assisting', () => {
    const odd = new Map(CAT);
    odd.set('x', ex('x', 'Odd Press', 'chest', ['chest', 'triceps', 'triceps']));
    const r = planBalance([routine('a', 'A', [item('x', 3)])], odd);
    expect(sets(r, 'chest')).toBe(3);
    expect(sets(r, 'triceps')).toBe(1.5);
  });

  it('multiplies by how often a routine comes round', () => {
    const rs = [routine('a', 'A', [item('bench', 3)]), routine('b', 'B', [item('squat', 3)])];
    const r = planBalance(
      rs,
      CAT,
      new Map([
        ['a', 2],
        ['b', 0.75],
      ]),
    );
    expect(sets(r, 'chest')).toBe(6);
    expect(sets(r, 'quads')).toBe(2.3); // 2.25, rounded to one place
    expect(r.muscles.find((m) => m.muscle === 'chest')!.frequency).toBe(2);
    expect(r.muscles.find((m) => m.muscle === 'quads')!.frequency).toBe(0.8);
  });

  it('treats a missing, negative or non-finite frequency as once a week', () => {
    const rs = [routine('a', 'A', [item('bench', 3)])];
    for (const n of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(sets(planBalance(rs, CAT, new Map([['a', n]])), 'chest')).toBe(3);
    }
    expect(sets(planBalance(rs, CAT, new Map([['other', 5]])), 'chest')).toBe(3);
  });

  it('counts frequency once per routine, however many exercises in it train the muscle', () => {
    const rs = [
      routine('a', 'A', [item('bench'), item('incline'), item('fly')]),
      routine('b', 'B', [item('pushup')]),
    ];
    const chest = planBalance(rs, CAT).muscles.find((m) => m.muscle === 'chest')!;
    expect(chest.frequency).toBe(2);
    expect(chest.sets).toBe(12);
  });

  it('reports work the catalogue does not know rather than dropping it', () => {
    const r = planBalance(
      [routine('a', 'A', [item('ghost', 4), item('bench', 3)])],
      CAT,
      new Map([['a', 2]]),
    );
    expect(r.unknown_sets).toBe(8);
    expect(sets(r, 'chest')).toBe(6);
  });

  it('treats negative sets as none', () => {
    const r = planBalance([routine('a', 'A', [item('bench', -3)])], CAT);
    expect(sets(r, 'chest')).toBe(0);
    expect(r.muscles.find((m) => m.muscle === 'chest')!.frequency).toBe(0);
  });

  it('holds only the programmed muscles to the band', () => {
    const r = planBalance([], CAT);
    for (const m of r.muscles) expect(m.target).toBe(PROGRAMMED.includes(m.muscle));
    expect(r.muscles.find((m) => m.muscle === 'forearms')!.target).toBe(false);
    expect(r.muscles.find((m) => m.muscle === 'calves')!.target).toBe(true);
  });

  it('is deterministic and independent of routine order', () => {
    const a = userSplit();
    const b = [...a].reverse();
    expect(planBalance(a, CAT)).toEqual(planBalance(b, CAT));
  });
});

describe('statusOf', () => {
  it.each([
    [0, 'untrained'],
    [-1, 'untrained'],
    [0.5, 'under'],
    [MIN_SETS - 0.1, 'under'],
    [MIN_SETS, 'in range'],
    [15, 'in range'],
    [MAX_SETS, 'in range'],
    [MAX_SETS + 0.1, 'over'],
  ] as const)('%s sets is %s', (n, want) => {
    expect(statusOf(n)).toBe(want);
  });
});

// ----------------------------------------------------------------------------------- delts

describe('deltHead', () => {
  it.each([
    ['Dumbbell Reverse Fly', 'rear'],
    ['Band Reverse Fly', 'rear'],
    ['Cable Rear Delt Row (with Rope)', 'rear'],
    ['Dumbbell Rear Lateral Raise', 'rear'],
    ['Face Pull', 'rear'],
    ['Reverse Pec Deck', 'rear'],
    ['Dumbbell Bent-Over Lateral Raise', 'rear'],
    ['Lateral Raise (Dumbbell)', 'side'],
    ['Cable One Arm Lateral Raise', 'side'],
    ['Barbell Upright Row', 'side'],
    ['Dumbbell Front Raise', 'front'],
    ['Band Front Lateral Raise', 'front'],
    ['Overhead Press (Barbell)', 'front'],
    ['Dumbbell Arnold Press', 'front'],
    ['Bench Press (Barbell)', 'front'],
    ['Push-Up', 'front'],
    ['Pike Push-Up', 'front'],
    ['Triceps Dip', 'front'],
    ['Dumbbell Shrug', undefined],
    ['Bicep Curl (Barbell)', undefined],
  ] as const)('%s → %s', (name, want) => {
    expect(deltHead(name)).toBe(want);
  });
});

describe('deltShares', () => {
  it('gives a named head all of the shoulder work', () => {
    expect(deltShares({ name: 'Dumbbell Reverse Fly', primary_muscle: 'shoulders' })).toEqual({
      front: 0,
      side: 0,
      rear: 1,
    });
  });

  it('reads an unnamed movement by what leads it', () => {
    expect(deltShares({ name: 'Cable Standing Fly', primary_muscle: 'chest' })).toEqual({
      front: 1,
      side: 0,
      rear: 0,
    });
    expect(deltShares({ name: 'Lever Pullover', primary_muscle: 'lats' })).toEqual({
      front: 0,
      side: 0,
      rear: 1,
    });
    const s = deltShares({ name: 'Shoulder Circles', primary_muscle: 'shoulders' });
    expect(s.front + s.side + s.rear).toBeCloseTo(1);
    expect(s.front).toBeCloseTo(1 / 3);
  });

  it('sums the heads into the report', () => {
    // Bench: 4 sets, shoulders assist at half → 2 front. Reverse fly: 3 rear. Lateral: 3 side.
    const r = planBalance(
      [routine('a', 'A', [item('bench', 4), item('revfly'), item('lateral')])],
      CAT,
    );
    expect(r.delts).toEqual({ front: 2, side: 3, rear: 3 });
    expect(sets(r, 'shoulders')).toBe(8);
  });
});

// ----------------------------------------------------------------------------------- pairs

function pair(id: string, items: RoutineItem[]) {
  return planBalance([routine('a', 'A', items)], CAT).pairs.find((p) => p.id === id)!;
}

describe('pairs', () => {
  it('has the five pairs, each with thresholds under one', () => {
    expect(PAIRS.map((p) => p.id)).toEqual([
      'push-pull',
      'quads-hamstrings',
      'front-rear-delts',
      'chest-back',
      'biceps-triceps',
    ]);
    for (const p of PAIRS) {
      expect(p.aMin).toBeGreaterThan(0);
      expect(p.aMin).toBeLessThan(1);
      expect(p.bMin).toBeGreaterThan(0);
      expect(p.bMin).toBeLessThan(1);
    }
  });

  it('is empty when neither side is trained', () => {
    expect(pair('quads-hamstrings', [item('bench')]).verdict).toBe('none');
  });

  it('flags hamstrings under half of quads, and not at exactly half', () => {
    // Quads 10 direct. Leg curl 4.9 → short; 5 → balanced.
    const short = pair('quads-hamstrings', [item('legext', 10), item('legcurl', 4.9)]);
    expect(short).toMatchObject({ verdict: 'short', short: 'b' });
    const ok = pair('quads-hamstrings', [item('legext', 10), item('legcurl', 5)]);
    expect(ok.verdict).toBe('balanced');
  });

  it('flags the other side too', () => {
    const p = pair('quads-hamstrings', [item('legext', 2), item('legcurl', 10)]);
    expect(p).toMatchObject({ verdict: 'short', short: 'a' });
  });

  it('flags a side that is missing outright', () => {
    expect(pair('quads-hamstrings', [item('legext', 6)])).toMatchObject({
      verdict: 'short',
      short: 'b',
    });
  });

  it('holds pulling to 80% of pressing', () => {
    // Push = chest + front delts. Bench 10: chest 10, front 5 → 15. Pull needs 12.
    const pushOnly = [item('bench', 10)];
    expect(pair('push-pull', pushOnly).a.sets).toBe(15);
    expect(pair('push-pull', [...pushOnly, item('seatedrow', 7)])).toMatchObject({ short: 'b' });
    // Seated row 8 sets: upper back 8 + lats 4 = 12 → exactly 80%.
    expect(pair('push-pull', [...pushOnly, item('seatedrow', 8)]).verdict).toBe('balanced');
  });

  it('does not flag pulling more than pressing unless pressing falls under half', () => {
    expect(pair('push-pull', [item('bench', 4), item('seatedrow', 6)]).verdict).toBe('balanced');
    expect(pair('push-pull', [item('fly', 2), item('seatedrow', 10)])).toMatchObject({
      verdict: 'short',
      short: 'a',
    });
  });

  it('flags rear delts under half of front', () => {
    // OHP 6 → front 6. Reverse fly 2 → rear 2 < 3.
    const p = pair('front-rear-delts', [item('ohp', 6), item('revfly', 2)]);
    expect(p).toMatchObject({ verdict: 'short', short: 'b', a: { sets: 6 }, b: { sets: 2 } });
    expect(pair('front-rear-delts', [item('ohp', 6), item('revfly', 3)]).verdict).toBe('balanced');
  });

  it('lets the triceps lead the biceps, within reason', () => {
    expect(pair('biceps-triceps', [item('curl', 4), item('pushdown', 8)]).verdict).toBe('balanced');
    expect(pair('biceps-triceps', [item('curl', 3), item('pushdown', 8)])).toMatchObject({
      short: 'a',
    });
    expect(pair('biceps-triceps', [item('curl', 8), item('pushdown', 3)])).toMatchObject({
      short: 'b',
    });
  });

  it('reads chest against the upper back', () => {
    expect(pair('chest-back', [item('fly', 10), item('seatedrow', 6)])).toMatchObject({
      short: 'b',
    });
    expect(pair('chest-back', [item('fly', 10), item('seatedrow', 7)]).verdict).toBe('balanced');
  });
});

// ----------------------------------------------------------------------------------- deficits

describe('deficits', () => {
  it('puts untrained muscles first, then lopsided pairs, then the furthest under', () => {
    const r = planBalance(userSplit(), CAT);
    const d = deficits(r);
    const untrained = d.filter((x) => x.reason === 'untrained').map((x) => x.muscle);
    // Calves are never trained by this split; the hamstrings only assist the squat.
    expect(untrained).toEqual(['calves']);
    expect(d[0]!.muscle).toBe('calves');
    const rank = (x: (typeof d)[number]) =>
      x.reason === 'untrained' ? 0 : x.reason === 'under' ? 2 : 1;
    for (let i = 1; i < d.length; i++) expect(rank(d[i]!)).toBeGreaterThanOrEqual(rank(d[i - 1]!));
    const under = d.filter((x) => x.reason === 'under');
    for (let i = 1; i < under.length; i++) {
      expect(MIN_SETS - under[i]!.need).toBeGreaterThanOrEqual(MIN_SETS - under[i - 1]!.need);
    }
    // The pairs this split forgets: pulling, the hamstrings, the rear delts, the upper back.
    expect(d.filter((x) => rank(x) === 1).map((x) => x.reason)).toEqual([
      'push-pull',
      'quads-hamstrings',
      'front-rear-delts',
    ]);
  });

  it('takes the larger of a pair shortfall and a band shortfall', () => {
    // Hamstrings 2 (under by 8); quads 7 wants hamstrings 3.5 (short by 1.5). Need is 8.
    const d = deficits(planBalance(userSplit(), CAT)).find((x) => x.muscle === 'hamstrings')!;
    expect(d).toMatchObject({ reason: 'quads-hamstrings', need: 8 });
  });

  it('lists every short muscle exactly once, and a head separately', () => {
    const d = deficits(planBalance(userSplit(), CAT));
    const keys = d.map((x) => `${x.muscle}/${x.head ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only chases programmed muscles', () => {
    const d = deficits(planBalance(userSplit(), CAT));
    for (const x of d) expect(PROGRAMMED).toContain(x.muscle);
    expect(d.some((x) => x.muscle === 'forearms' || x.muscle === 'neck')).toBe(false);
  });

  it('names the rear delt as a head of the shoulder', () => {
    const d = deficits(planBalance(userSplit(), CAT));
    expect(d.find((x) => x.reason === 'front-rear-delts')).toMatchObject({
      muscle: 'shoulders',
      head: 'rear',
    });
  });

  it('does not list a muscle twice when a pair agrees with its own gap', () => {
    // Hamstrings untrained and short against the quads: one deficit, not two.
    const r = planBalance([routine('l', 'Legs', [item('legext', 10)])], CAT);
    const ham = deficits(r).filter((x) => x.muscle === 'hamstrings');
    expect(ham).toHaveLength(1);
    expect(ham[0]!.reason).toBe('untrained');
  });

  it('asks for enough to clear a pair threshold', () => {
    // Quads 20 (legext 20), hamstrings 6 (in band? no — under). Use a full band to isolate.
    const r = planBalance([routine('l', 'Legs', [item('legext', 20), item('legcurl', 10)])], CAT);
    const d = deficits(r).find((x) => x.reason === 'quads-hamstrings');
    expect(d).toBeUndefined(); // 10 ≥ 20 × 0.5
    const r2 = planBalance([routine('l', 'Legs', [item('legext', 30), item('legcurl', 12)])], CAT);
    const d2 = deficits(r2).find((x) => x.reason === 'quads-hamstrings');
    expect(d2).toMatchObject({ muscle: 'hamstrings', need: 3 });
  });
});

// ----------------------------------------------------------------------------------- equipment

describe('inferEquipment', () => {
  it('assumes a gym when nothing is written yet', () => {
    const kit = inferEquipment([], CAT);
    expect(kit.has('barbell')).toBe(true);
    expect(kit.has('cable')).toBe(true);
    expect(kit.has('body weight')).toBe(true);
  });

  it('reads a barbell, a cable or a machine as a whole gym', () => {
    const kit = inferEquipment([routine('a', 'A', [item('pushdown')])], CAT);
    expect(kit.has('barbell')).toBe(true);
    expect(kit.has('leverage machine')).toBe(true);
  });

  it('keeps a dumbbell-only home to dumbbells and the floor', () => {
    const kit = inferEquipment([routine('a', 'A', [item('dbbench'), item('dbcurl')])], CAT);
    expect([...kit].sort()).toEqual(['body weight', 'dumbbell']);
  });

  it('ignores exercises the catalogue does not know', () => {
    const kit = inferEquipment([routine('a', 'A', [item('ghost'), item('dbcurl')])], CAT);
    expect([...kit].sort()).toEqual(['body weight', 'dumbbell']);
  });
});

// ----------------------------------------------------------------------------------- suggestions

const after = (routines: Routine[], fixes: readonly BalanceFix[]) =>
  routines.map((r) => {
    let items = r.items;
    for (const f of fixes) if (f.routine_id === r.id) items = applyTo(items, f);
    return { ...r, items };
  });

describe('suggestFixes', () => {
  it('offers nothing without routines', () => {
    expect(suggestFixes([], CAT)).toEqual([]);
  });

  it('offers nothing when the limit is zero', () => {
    expect(suggestFixes(userSplit(), CAT, { limit: 0 })).toEqual([]);
  });

  it("fixes the user's split: calves and hamstrings on leg day, rear delts on back day", () => {
    const fixes = suggestFixes(userSplit(), CAT);
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);

    const calves = fixes.find((f) => f.for.muscle === 'calves')!;
    expect(calves).toMatchObject({ kind: 'add', routine_id: 'legs' });
    expect(calves.item.name).toBe('Standing Calf Raise (Machine)');
    expect(calves.before).toBe(0);
    expect(calves.after).toBeGreaterThan(0);

    const ham = fixes.find((f) => f.for.muscle === 'hamstrings')!;
    expect(ham.routine_id).toBe('legs');
    expect(ham.item.name).toBe('Lying Leg Curl (Machine)');

    // A cable back day gets the cable rear-delt row, the library's nearest thing to a face pull.
    const rear = fixes.find((f) => f.for.head === 'rear')!;
    expect(rear.routine_id).toBe('pull');
    expect(rear.item.name).toBe('Rear Delt Row (Cable)');

    const back = fixes.find((f) => f.for.muscle === 'upper back')!;
    expect(back).toMatchObject({ routine_id: 'pull', kind: 'add' });
    expect(back.item.name).toBe('Seated Row (Machine)');
  });

  it('makes every fix improve the muscle it is for', () => {
    for (const f of suggestFixes(userSplit(), CAT)) {
      expect(f.after).toBeGreaterThan(f.before);
    }
  });

  it('really closes the gaps it claims to, when applied', () => {
    const rs = userSplit();
    const fixes = suggestFixes(rs, CAT);
    const before = planBalance(rs, CAT);
    const then = planBalance(after(rs, fixes), CAT);
    expect(sets(then, 'calves')).toBeGreaterThan(sets(before, 'calves'));
    expect(then.delts.rear).toBeGreaterThan(before.delts.rear);
    // The "after" figure on each fix is the figure you get by applying the fixes in order.
    const last = fixes.at(-1)!;
    expect(last.after).toBeCloseTo(deficitSets(then, last.for));
    for (const f of fixes) expect(f.before).toBeLessThan(f.after);
  });

  it('never suggests an exercise already in the routine, nor the same exercise twice', () => {
    const rs = userSplit();
    const fixes = suggestFixes(rs, CAT, { limit: 10 });
    const ids = fixes.map((f) => f.item.exercise_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of fixes) {
      const r = rs.find((x) => x.id === f.routine_id)!;
      if (f.kind === 'add')
        expect(r.items.map((i) => i.exercise_id)).not.toContain(f.item.exercise_id);
    }
  });

  it('is deterministic, whatever order routines and the catalogue arrive in', () => {
    const a = suggestFixes(userSplit(), CAT);
    const shuffled = new Map([...CAT.entries()].reverse());
    const b = suggestFixes([...userSplit()].reverse(), shuffled);
    expect(b).toEqual(a);
  });

  it('respects the limit', () => {
    expect(suggestFixes(userSplit(), CAT, { limit: 1 })).toHaveLength(1);
  });

  it('never offers advanced, boxing, non-strength or unavailable equipment', () => {
    const fixes = suggestFixes(userSplit(), CAT, { limit: 10 });
    for (const f of fixes) {
      const e = CAT.get(f.item.exercise_id)!;
      expect(e.difficulty).not.toBe('advanced');
      expect(e.category).toBe('strength');
      expect(e.name).not.toMatch(/boxing/i);
      expect(e.equipment).not.toBe('tire');
    }
  });

  it('keeps a dumbbell-only home on dumbbells and the floor', () => {
    order = 0;
    const home = [
      routine('a', 'Upper', [
        item('dbbench', 4),
        item('dbrow', 4),
        item('dbpress'),
        item('dbcurl'),
      ]),
      routine('b', 'Lower', [item('goblet', 4)]),
    ];
    const fixes = suggestFixes(home, CAT, { limit: 10 });
    expect(fixes.length).toBeGreaterThan(0);
    for (const f of fixes) {
      expect(['dumbbell', 'body weight']).toContain(CAT.get(f.item.exercise_id)!.equipment);
    }
    expect(fixes.find((f) => f.for.muscle === 'calves')!.item.name).toBe(
      'Standing Calf Raise (Dumbbell)',
    );
  });

  it('prescribes an added exercise as a built week would', () => {
    const calves = suggestFixes(userSplit(), CAT).find((f) => f.for.muscle === 'calves')!;
    expect(calves.item).toMatchObject({ sets: 3, rep_low: 10, rep_high: 15, rest_sec: 90 });
    expect(calves.item.load_type).toBe('weight_reps');
  });

  it('adds fewer sets when the routine comes round more often', () => {
    order = 0;
    const rs = [
      routine('a', 'Full', [item('bench'), item('pulldown'), item('squat'), item('legcurl', 4)]),
    ];
    // Calves untrained: need 10. Once a week → 3 sets (the cap); four times a week → ceil(10/4) = 3.
    // Five times a week → 2.
    const once = suggestFixes(rs, CAT).find((f) => f.for.muscle === 'calves')!;
    expect(once.item.sets).toBe(3);
    const often = suggestFixes(rs, CAT, { perWeek: new Map([['a', 5]]) }).find(
      (f) => f.for.muscle === 'calves',
    )!;
    expect(often.item.sets).toBe(2);
  });

  it('swaps instead of adding when the natural home is full', () => {
    order = 0;
    const legs = Array.from({ length: MAX_EXERCISES_PER_DAY }, (_, i) =>
      item(i % 2 === 0 ? 'squat' : 'legext', 2),
    );
    // Quads: 5 squats × 2 + 4 extensions × 2 = 18 direct sets — plenty to spare.
    const rs = [routine('legs', 'Legs', legs)];
    const fixes = suggestFixes(rs, CAT);
    const calves = fixes.find((f) => f.for.muscle === 'calves')!;
    expect(calves.kind).toBe('swap');
    expect(calves.routine_id).toBe('legs');
    if (calves.kind === 'swap') {
      expect(calves.out.muscle).toBe('quads');
      expect(calves.out.after).toBeLessThan(calves.out.before);
      expect(calves.out.after).toBeGreaterThanOrEqual(MIN_SETS);
    }
    // And the routine never grows.
    expect(after(rs, fixes)[0]!.items).toHaveLength(MAX_EXERCISES_PER_DAY);
  });

  it('never pushes a routine past the set cap', () => {
    order = 0;
    const rs = [
      routine('legs', 'Legs', [item('squat', 12), item('legext', 11)]), // 23 sets
    ];
    const fixes = suggestFixes(rs, CAT, { limit: 10 });
    for (const r of after(rs, fixes)) {
      expect(r.items.reduce((n, i) => n + i.sets, 0)).toBeLessThanOrEqual(MAX_ROUTINE_SETS);
    }
  });

  it('swaps out a surplus exercise when its muscle is over the band, even with room', () => {
    order = 0;
    const rs = [
      routine('push', 'Push', [item('bench', 8), item('incline', 8), item('fly', 8)]),
      routine('legs', 'Legs', [item('squat', 4), item('legcurl', 4), item('calf', 4)]),
    ];
    // Chest 24 > 20: the push day has room, but a chest exercise is pure surplus.
    const fixes = suggestFixes(rs, CAT, { limit: 10 });
    const swap = fixes.find((f) => f.kind === 'swap' && f.routine_id === 'push');
    expect(swap).toBeDefined();
    if (swap?.kind === 'swap') {
      expect(swap.out.muscle).toBe('chest');
      // The last of equals goes: the fly, an accessory, rather than the bench press.
      expect(swap.out.exercise_id).toBe('fly');
    }
  });

  it("keeps the slot's sets, rest, superset and note when swapping", () => {
    order = 0;
    const legs = [
      ...Array.from({ length: MAX_EXERCISES_PER_DAY - 1 }, () => item('squat', 2)),
      item('legext', 2, { rest_sec: 45, superset: 'A', note: 'slow' }),
    ];
    const fixes = suggestFixes([routine('legs', 'Legs', legs)], CAT);
    const swap = fixes.find((f) => f.kind === 'swap')!;
    expect(swap.kind).toBe('swap');
    if (swap.kind === 'swap') {
      expect(swap.index).toBe(MAX_EXERCISES_PER_DAY - 1);
      expect(swap.item).toMatchObject({ sets: 2, rest_sec: 45, superset: 'A', note: 'slow' });
      expect(swap.out.exercise_id).toBe('legext');
    }
  });

  it('never swaps out an exercise whose muscle would fall out of the band', () => {
    order = 0;
    // Full, and quads at exactly 10: nothing is surplus, so no swap — and no room to add.
    const legs = [
      ...Array.from({ length: 5 }, () => item('legext', 2)),
      ...Array.from({ length: 4 }, () => item('legcurl', 1)),
    ];
    const fixes = suggestFixes([routine('legs', 'Legs', legs)], CAT);
    for (const f of fixes) {
      if (f.kind === 'swap') {
        const p = planBalance(after([routine('legs', 'Legs', legs)], [f]), CAT);
        expect(sets(p, f.out.muscle)).toBeGreaterThanOrEqual(MIN_SETS);
      }
    }
    expect(fixes.filter((f) => f.kind === 'add')).toHaveLength(0);
  });

  it('accounts for earlier fixes when planning later ones', () => {
    order = 0;
    // One routine, eight exercises: room for exactly one more.
    const rs = [
      routine('a', 'Full', [
        item('bench'),
        item('pulldown'),
        item('seatedrow'),
        item('ohp'),
        item('lateral'),
        item('curl'),
        item('pushdown'),
        item('squat'),
      ]),
    ];
    const fixes = suggestFixes(rs, CAT, { limit: 10 });
    const adds = fixes.filter((f) => f.kind === 'add');
    expect(adds.length).toBeLessThanOrEqual(1);
    expect(after(rs, fixes)[0]!.items.length).toBeLessThanOrEqual(MAX_EXERCISES_PER_DAY);
  });

  it('picks a named rear-delt movement, matched to the kit the routine already uses', () => {
    const rear = suggestFixes(userSplit(), CAT).find((f) => f.for.head === 'rear')!;
    expect(rear.item.exercise_id).toBe('rearrow');
    order = 0;
    const dumbbellBack = [
      routine('pull', 'Back', [item('dbrow', 4), item('dbcurl', 4)]),
      routine('push', 'Push', [item('dbpress', 6), item('dbbench', 6)]),
    ];
    const fix = suggestFixes(dumbbellBack, CAT, { limit: 10 }).find((f) => f.for.head === 'rear')!;
    expect(fix.routine_id).toBe('pull');
    expect(fix.item.exercise_id).toBe('revfly');
  });

  it('gives an unclaimed shoulder gap a lateral raise, not another press', () => {
    order = 0;
    const rs = [routine('a', 'Push', [item('bench', 4), item('pushdown', 3)])];
    // Shoulders 2 sets (assisting) → under. Front delts are covered by the bench.
    const fix = suggestFixes(rs, CAT, { limit: 10 }).find(
      (f) => f.for.muscle === 'shoulders' && !f.for.head,
    );
    expect(fix?.item.name).toBe('Lateral Raise (Dumbbell)');
  });

  it('puts a fix in the shortest routine when none trains the region', () => {
    order = 0;
    const rs = [
      routine('long', 'Long', [item('bench'), item('incline'), item('ohp')]),
      routine('short', 'Short', [item('curl')]),
    ];
    const calves = suggestFixes(rs, CAT, { limit: 10 }).find((f) => f.for.muscle === 'calves')!;
    expect(calves.routine_id).toBe('short');
  });
});

describe('applyTo', () => {
  it('adds to the end and swaps in place, without touching the input', () => {
    const items = [item('bench'), item('fly')];
    const frozen = JSON.stringify(items);
    const add: BalanceFix = {
      kind: 'add',
      id: 'x',
      routine_id: 'r',
      routine_name: 'R',
      for: { muscle: 'calves', reason: 'untrained', need: 10 },
      before: 0,
      after: 3,
      item: item('calf'),
    };
    expect(applyTo(items, add).map((i) => i.exercise_id)).toEqual(['bench', 'fly', 'calf']);
    const swap: BalanceFix = {
      ...add,
      kind: 'swap',
      index: 1,
      out: { exercise_id: 'fly', name: 'Fly', muscle: 'chest', before: 6, after: 3 },
    };
    expect(applyTo(items, swap).map((i) => i.exercise_id)).toEqual(['bench', 'calf']);
    expect(JSON.stringify(items)).toBe(frozen);
  });
});

// ----------------------------------------------------------------------------------- the map

describe('fillLevel', () => {
  it.each([
    [0, 0],
    [-2, 0],
    [Number.NaN, 0],
    [0.1, 1],
    [4.9, 1],
    [5, 2],
    [9.9, 2],
    [10, 3],
    [20, 3],
    [35, 3],
  ] as const)('%s sets → level %s', (n, want) => {
    expect(fillLevel(n)).toBe(want);
  });
});

describe('fillLevel on a session scale', () => {
  it.each([
    [0, 0],
    [1, 1],
    [2.9, 1],
    [3, 2],
    [5.9, 2],
    [6, 3],
    [12, 3],
  ] as const)('%s sets in one session → level %s', (n, want) => {
    expect(fillLevel(n, 'session')).toBe(want);
  });

  it('defaults to the week', () => {
    expect(fillLevel(6)).toBe(2);
    expect(fillLevel(6, 'week')).toBe(2);
  });
});

describe('the map covers every muscle', () => {
  it('draws every muscle somewhere, or lists it as undrawn', () => {
    const drawn = new Set<Muscle>(Object.values(REGION_MUSCLE));
    for (const m of MAP_MUSCLES) expect(drawn.has(m) || UNDRAWN.includes(m)).toBe(true);
    expect(UNDRAWN).toEqual(['abductors']);
  });

  it('draws the front of the shoulder from the front and the back from behind', () => {
    const r = planBalance([routine('a', 'A', [item('ohp', 6), item('lateral', 2)])], CAT);
    expect(regionSets(r, 'deltoids', 'front')).toBe(8);
    expect(regionSets(r, 'deltoids', 'back')).toBe(2);
    expect(regionSets(r, 'chest', 'front')).toBe(0);
    expect(regionSets(r, 'triceps', 'back')).toBe(3);
  });
});

// ----------------------------------------------------------------------------------- words

describe('formatSets', () => {
  it.each([
    [0, '0'],
    [10, '10'],
    [7.5, '7.5'],
    [7.25, '7.3'],
    [2.04, '2'],
  ] as const)('%s → %s', (n, want) => {
    expect(formatSets(n)).toBe(want);
  });
});

describe('deficitLabel', () => {
  it('names a head, a side of push and pull, or the muscle', () => {
    expect(deficitLabel({ muscle: 'shoulders', head: 'rear', reason: 'front-rear-delts' })).toBe(
      'Rear delts',
    );
    expect(deficitLabel({ muscle: 'upper back', reason: 'push-pull' })).toBe('Pulling');
    expect(deficitLabel({ muscle: 'chest', reason: 'push-pull' })).toBe('Pressing');
    expect(deficitLabel({ muscle: 'upper back', reason: 'chest-back' })).toBe('Upper back');
    expect(deficitLabel({ muscle: 'calves' })).toBe('Calves');
  });
});

describe('deficitSets', () => {
  it('measures a pair gap by its short side, a head by the head, a muscle by itself', () => {
    const r = planBalance(userSplit(), CAT);
    const d = deficits(r);
    const pull = d.find((x) => x.reason === 'push-pull')!;
    expect(pull.side).toBe('b');
    expect(deficitSets(r, pull)).toBe(r.pairs.find((p) => p.id === 'push-pull')!.b.sets);
    const rear = d.find((x) => x.head === 'rear')!;
    expect(deficitSets(r, rear)).toBe(r.delts.rear);
    const calves = d.find((x) => x.muscle === 'calves')!;
    expect(deficitSets(r, calves)).toBe(0);
  });
});

describe('describeDeficit', () => {
  it('says why, in one sentence', () => {
    expect(describeDeficit({ muscle: 'calves', reason: 'untrained', need: 10 }, 0)).toBe(
      'Nothing in your routines trains your calves.',
    );
    expect(describeDeficit({ muscle: 'biceps', reason: 'under', need: 2.5 }, 7.5)).toBe(
      'Biceps: 7.5 sets a week. 10 is where the evidence starts.',
    );
    expect(
      describeDeficit(
        { muscle: 'shoulders', head: 'rear', reason: 'front-rear-delts', side: 'b', need: 3 },
        0,
      ),
    ).toBe('Rear delts under half your front-delt work.');
    expect(
      describeDeficit({ muscle: 'upper back', reason: 'push-pull', side: 'b', need: 2 }, 13),
    ).toBe('Less pulling than pressing.');
    expect(
      describeDeficit({ muscle: 'hamstrings', reason: 'quads-hamstrings', side: 'b', need: 2 }, 3),
    ).toBe('Hamstrings under half your quad work.');
  });

  it('has a sentence for every side of every pair', () => {
    for (const p of PAIRS) {
      for (const side of ['a', 'b'] as const) {
        const muscle = side === 'a' ? p.fixA : p.fixB;
        const head = side === 'a' ? p.headA : p.headB;
        const s = describeDeficit(
          { muscle, ...(head ? { head } : {}), reason: p.id, side, need: 1 },
          0,
        );
        expect(s, `${p.id}:${side}`).not.toMatch(/behind\.$/);
        expect(s.endsWith('.')).toBe(true);
      }
    }
  });
});

describe('describeFix', () => {
  it('reads an add as where it goes and what it does', () => {
    const calves = suggestFixes(userSplit(), CAT).find((f) => f.for.muscle === 'calves')!;
    expect(describeFix(calves)).toEqual({
      title: 'Add Standing Calf Raise (Machine)',
      where: 'to Legs',
      effect: 'Calves 0 → 3 sets a week',
    });
  });

  it('reads a swap with what the outgoing muscle keeps', () => {
    const f: BalanceFix = {
      kind: 'swap',
      id: 'x',
      routine_id: 'legs',
      routine_name: 'Legs',
      for: { muscle: 'calves', reason: 'untrained', need: 10 },
      before: 0,
      after: 2,
      index: 1,
      item: item('calf', 2),
      out: {
        exercise_id: 'legext',
        name: 'Leg Extension (Machine)',
        muscle: 'quads',
        before: 18,
        after: 16,
      },
    };
    expect(describeFix(f)).toEqual({
      title: 'Swap Leg Extension (Machine) for Standing Calf Raise (Machine)',
      where: 'in Legs',
      effect: 'Calves 0 → 2 sets a week',
      cost: 'Quads keeps 16 of 18',
    });
  });

  it('names the side of a pair in its effect', () => {
    const pull = suggestFixes(userSplit(), CAT).find((f) => f.for.reason === 'push-pull')!;
    expect(describeFix(pull).effect).toMatch(/^Pulling \d/);
  });
});
