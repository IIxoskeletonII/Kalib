import { describe, expect, it } from 'vitest';
import { buildExerciseDoc, type ExerciseDoc } from './exerciseSearch';
import {
  MAX_ALTERNATIVES,
  MAX_DESCRIPTION,
  MAX_EXERCISES,
  alternativesFor,
  buildInjuryRequest,
  buildTargets,
  cleanDescription,
  groundAdvice,
  groundSwap,
  parseInjuryResponse,
  readAnswer,
} from './injury';
import type { ExerciseCategory, Muscle } from './types';

function doc(
  id: string,
  name: string,
  primary: Muscle,
  equipment: string,
  secondary: Muscle[] = [],
  category: ExerciseCategory = 'strength',
  source: 'library' | 'custom' = 'library',
): ExerciseDoc {
  return buildExerciseDoc({
    id,
    name,
    equipment,
    primary_muscle: primary,
    secondary_muscles: secondary,
    category,
    source,
  });
}

const CATALOGUE: ExerciseDoc[] = [
  doc('bb-bench', 'Barbell Bench Press', 'chest', 'barbell', ['triceps', 'shoulders']),
  doc('db-bench', 'Dumbbell Bench Press', 'chest', 'dumbbell', ['triceps']),
  doc('db-floor', 'Dumbbell Floor Press', 'chest', 'dumbbell', ['triceps']),
  doc('cable-fly', 'Cable Fly', 'chest', 'cable'),
  doc('machine-press', 'Lever Chest Press', 'chest', 'leverage machine', ['triceps']),
  doc('push-up', 'Push-up', 'chest', 'body weight', ['triceps']),
  doc('incline-bb', 'Barbell Incline Bench Press', 'chest', 'barbell', ['triceps']),
  doc('chest-stretch', 'Chest Stretch', 'chest', 'body weight', [], 'stretching'),
  doc('squat', 'Barbell Full Squat', 'quads', 'barbell', ['glutes']),
  doc('leg-press', 'Sled Leg Press', 'quads', 'sled machine', ['glutes']),
  doc('goblet', 'Dumbbell Goblet Squat', 'quads', 'dumbbell', ['glutes']),
  doc('ohp', 'Barbell Overhead Press', 'shoulders', 'barbell', ['triceps']),
  doc('landmine', 'Landmine Press', 'shoulders', 'barbell', ['chest']),
  doc('db-ohp', 'Dumbbell Shoulder Press', 'shoulders', 'dumbbell', ['triceps']),
  doc(
    'my-own-press',
    'My Pec Press',
    'chest',
    'leverage machine',
    ['triceps'],
    'strength',
    'custom',
  ),
];

const ROUTINE = [
  { exercise_id: 'bb-bench', index: 0 },
  { exercise_id: 'squat', index: 1 },
  { exercise_id: 'ohp', index: 2 },
];

describe('cleanDescription', () => {
  it('collapses whitespace and caps the length', () => {
    expect(cleanDescription('  left   shoulder\n\naches  ')).toBe('left shoulder aches');
    expect(cleanDescription('a'.repeat(1000))).toHaveLength(MAX_DESCRIPTION);
  });
});

describe('alternativesFor', () => {
  const bench = CATALOGUE[0]!;
  it('offers strength movements for the same main muscle, never itself', () => {
    const alts = alternativesFor(bench, CATALOGUE, new Set(['bb-bench']));
    expect(alts.length).toBeGreaterThan(3);
    for (const a of alts) {
      expect(a.primary_muscle).toBe('chest');
      expect(a.category).toBe('strength');
      expect(a.id).not.toBe('bb-bench');
    }
    expect(alts.map((a) => a.id)).not.toContain('chest-stretch');
  });
  it('leaves out what the routine already has', () => {
    const alts = alternativesFor(bench, CATALOGUE, new Set(['bb-bench', 'db-bench']));
    expect(alts.map((a) => a.id)).not.toContain('db-bench');
  });
  it('spreads the first picks across equipment', () => {
    const alts = alternativesFor(bench, CATALOGUE, new Set());
    const firstFour = new Set(alts.slice(0, 4).map((a) => a.equipment));
    expect(firstFour.size).toBe(4);
  });
  it('respects the limit and is deterministic', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      doc(`x${i}`, `Variation ${i} Press`, 'chest', i % 2 ? 'cable' : 'dumbbell'),
    );
    const a = alternativesFor(bench, [...CATALOGUE, ...many], new Set());
    const b = alternativesFor(bench, [...CATALOGUE, ...many], new Set());
    expect(a).toHaveLength(MAX_ALTERNATIVES);
    expect(a.map((d) => d.id)).toEqual(b.map((d) => d.id));
  });
  it('can find nothing', () => {
    const lonely = doc('calf', 'Calf Raise', 'calves', 'body weight');
    expect(alternativesFor(lonely, [lonely], new Set())).toEqual([]);
  });
});

describe('buildTargets and buildInjuryRequest', () => {
  it('numbers exercises and keeps their routine positions', () => {
    const targets = buildTargets(ROUTINE, CATALOGUE);
    expect(targets.map((t) => [t.ref, t.index, t.doc.id])).toEqual([
      ['1', 0, 'bb-bench'],
      ['2', 1, 'squat'],
      ['3', 2, 'ohp'],
    ]);
  });
  it('skips exercises the catalogue does not have, without leaving a gap in the refs', () => {
    const targets = buildTargets(
      [{ exercise_id: 'gone', index: 0 }, ...ROUTINE.map((r) => ({ ...r, index: r.index + 1 }))],
      CATALOGUE,
    );
    expect(targets.map((t) => t.ref)).toEqual(['1', '2', '3']);
    expect(targets[0]!.index).toBe(1);
  });
  it('caps a long routine', () => {
    const long = Array.from({ length: 30 }, (_, i) => ({ exercise_id: 'squat', index: i }));
    expect(buildTargets(long, CATALOGUE)).toHaveLength(MAX_EXERCISES);
  });
  it('sends names, muscles, equipment and alternatives, and nothing else', () => {
    const req = buildInjuryRequest('  my left shoulder aches  ', buildTargets(ROUTINE, CATALOGUE));
    expect(req.description).toBe('my left shoulder aches');
    expect(req.exercises[0]).toEqual({
      ref: '1',
      name: 'Barbell Bench Press',
      muscles: expect.arrayContaining(['Chest', 'Triceps']),
      equipment: 'barbell',
      alternatives: expect.arrayContaining(['Dumbbell Bench Press']),
    });
    // No ids travel: the library's and the person's own exercise ids stay on the phone.
    const json = JSON.stringify(req);
    for (const id of ['bb-bench', 'db-bench', 'my-own-press', 'squat"'])
      expect(json).not.toContain(id);
    expect(Object.keys(req.exercises[0]!).sort()).toEqual(
      ['alternatives', 'equipment', 'muscles', 'name', 'ref'].sort(),
    );
  });
});

describe('parseInjuryResponse', () => {
  const refs = new Set(['1', '2', '3']);
  const good = {
    needs_doctor: false,
    summary: 'Keep legs, ease pressing.',
    advice: [
      {
        ref: '1',
        action: 'swap',
        reason: 'Lets the shoulder rotate.',
        change: '',
        swap_to: 'Dumbbell Bench Press',
      },
      { ref: '2', action: 'keep', reason: 'No shoulder load.', change: '', swap_to: '' },
      {
        ref: '3',
        action: 'modify',
        reason: 'Less range.',
        change: 'Press from eye level up.',
        swap_to: '',
      },
    ],
  };

  it('copies a well-formed answer', () => {
    const p = parseInjuryResponse(good, refs);
    expect(p.summary).toBe('Keep legs, ease pressing.');
    expect(p.advice.map((a) => a.action)).toEqual(['swap', 'keep', 'modify']);
    expect(p.advice[2]!.change).toBe('Press from eye level up.');
  });
  it('refuses something that is not an answer at all', () => {
    for (const bad of [null, undefined, 'text', 42, [], { summary: 'x' }, { advice: 'none' }]) {
      expect(() => parseInjuryResponse(bad, refs)).toThrow(/shape/);
    }
  });
  it('drops unknown refs, repeats, unknown actions and junk entries', () => {
    const p = parseInjuryResponse(
      {
        advice: [
          null,
          'swap',
          { ref: '9', action: 'keep' },
          { ref: '1', action: 'explode' },
          { ref: '1', action: 'keep', reason: 'first' },
          { ref: '1', action: 'skip', reason: 'second' },
          { ref: 2, action: ' KEEP ' },
        ],
      },
      refs,
    );
    expect(p.advice).toEqual([
      { ref: '1', action: 'keep', reason: 'first', change: '', swap_to: '' },
      { ref: '2', action: 'keep', reason: '', change: '', swap_to: '' },
    ]);
  });
  it('ignores extra fields and fields that do not belong to the action', () => {
    const p = parseInjuryResponse(
      {
        needs_doctor: 'yes',
        summary: 5,
        diagnosis: 'tendinopathy',
        advice: [
          { ref: '2', action: 'keep', reason: 'ok', change: 'go heavier', swap_to: 'X', extra: 1 },
        ],
      },
      refs,
    );
    expect(p.needs_doctor).toBe(false);
    expect(p.summary).toBe('');
    expect(p.advice[0]).toEqual({
      ref: '2',
      action: 'keep',
      reason: 'ok',
      change: '',
      swap_to: '',
    });
    expect(JSON.stringify(p)).not.toContain('tendinopathy');
  });
  it('caps oversized text and oversized lists', () => {
    const p = parseInjuryResponse(
      {
        summary: 'word '.repeat(500),
        advice: Array.from({ length: 50 }, (_, i) => ({
          ref: String((i % 3) + 1),
          action: 'keep',
          reason: 'y'.repeat(5000),
        })),
      },
      refs,
    );
    expect(p.summary.length).toBeLessThanOrEqual(220);
    expect(p.advice).toHaveLength(3);
    for (const a of p.advice) expect(a.reason.length).toBeLessThanOrEqual(220);
  });
  it('accepts an empty list', () => {
    expect(parseInjuryResponse({ advice: [] }, refs).advice).toEqual([]);
  });
});

describe('groundSwap', () => {
  const targets = buildTargets(ROUTINE, CATALOGUE);
  const bench = targets[0]!;
  const inRoutine = new Set(ROUTINE.map((r) => r.exercise_id));

  it('takes an exact name, in any case or punctuation', () => {
    expect(groundSwap('dumbbell bench press', bench, CATALOGUE, inRoutine)?.id).toBe('db-bench');
    expect(groundSwap('Dumbbell  Bench-Press!', bench, CATALOGUE, inRoutine)?.id).toBe('db-bench');
  });
  it('takes an exact name from the wider library too', () => {
    const narrow = { ...bench, alternatives: [] };
    expect(groundSwap('Lever Chest Press', narrow, CATALOGUE, inRoutine)?.id).toBe('machine-press');
  });
  it('takes a near-exact name among the alternatives', () => {
    expect(groundSwap('Dumbbell Floor Presses', bench, CATALOGUE, inRoutine)?.id).toBe('db-floor');
    expect(groundSwap('Floor Press', bench, CATALOGUE, inRoutine)?.id).toBe('db-floor');
  });
  it('refuses what is not there, or is too loose a match', () => {
    expect(groundSwap('Banded Hex Press', bench, CATALOGUE, inRoutine)).toBeUndefined();
    expect(groundSwap('Press', bench, CATALOGUE, inRoutine)).toBeUndefined();
    expect(groundSwap('', bench, CATALOGUE, inRoutine)).toBeUndefined();
    expect(groundSwap('!!!', bench, CATALOGUE, inRoutine)).toBeUndefined();
  });
  it('never swaps an exercise for itself or for one already in the routine', () => {
    expect(groundSwap('Barbell Bench Press', bench, CATALOGUE, inRoutine)).toBeUndefined();
    expect(groundSwap('Barbell Overhead Press', bench, CATALOGUE, inRoutine)).toBeUndefined();
  });
  it('never swaps in a stretch', () => {
    expect(groundSwap('Chest Stretch', bench, CATALOGUE, inRoutine)).toBeUndefined();
  });
});

describe('groundAdvice and readAnswer', () => {
  const targets = buildTargets(ROUTINE, CATALOGUE);
  const refs = new Set(targets.map((t) => t.ref));
  const answer = (advice: object[], extra: object = {}) =>
    parseInjuryResponse({ needs_doctor: false, summary: 'Ease pressing.', advice, ...extra }, refs);

  it('grounds swaps and puts the advice in routine order', () => {
    const out = groundAdvice(
      answer([
        { ref: '3', action: 'modify', reason: 'r3', change: 'Seated, lighter.' },
        { ref: '1', action: 'swap', reason: 'r1', swap_to: 'Dumbbell Bench Press' },
      ]),
      targets,
      CATALOGUE,
    );
    expect(out.map((a) => [a.ref, a.action, a.index])).toEqual([
      ['1', 'swap', 0],
      ['3', 'modify', 2],
    ]);
    expect(out[0]!.swap?.id).toBe('db-bench');
    expect(out[1]!.change).toBe('Seated, lighter.');
  });
  it('turns an ungrounded swap into "leave it out", keeping the name it gave', () => {
    const out = groundAdvice(
      answer([{ ref: '1', action: 'swap', reason: 'r', swap_to: 'Zercher Hover Press' }]),
      targets,
      CATALOGUE,
    );
    expect(out[0]).toMatchObject({ action: 'skip', unmatched: 'Zercher Hover Press' });
    expect(out[0]!.swap).toBeUndefined();
  });
  it('turns a swap that names nothing into "leave it out"', () => {
    const out = groundAdvice(
      answer([{ ref: '1', action: 'swap', reason: 'r' }]),
      targets,
      CATALOGUE,
    );
    expect(out[0]).toMatchObject({ action: 'skip' });
    expect(out[0]!.unmatched).toBeUndefined();
  });
  it('gives advice when nothing is wrong', () => {
    const r = readAnswer(
      answer([{ ref: '2', action: 'keep', reason: 'Legs are fine.' }]),
      targets,
      CATALOGUE,
    );
    expect(r.kind).toBe('advice');
  });
  it('defers to a doctor when the model says so', () => {
    const r = readAnswer(answer([], { needs_doctor: true }), targets, CATALOGUE);
    expect(r).toMatchObject({ kind: 'doctor', source: 'answer' });
  });
  it('defers to a doctor when the model talks like one', () => {
    for (const reason of [
      'This could be a torn labrum.',
      'Numbness here means a nerve is involved.',
      'Go to urgent care first.',
    ]) {
      const r = readAnswer(answer([{ ref: '1', action: 'skip', reason }]), targets, CATALOGUE);
      expect(r.kind, reason).toBe('doctor');
    }
  });
  it('checks the summary and the change, not only the reason', () => {
    expect(
      readAnswer(answer([], { summary: 'Seek urgent medical attention.' }), targets, CATALOGUE)
        .kind,
    ).toBe('doctor');
    expect(
      readAnswer(
        answer([{ ref: '3', action: 'modify', reason: 'ok', change: 'Call 911 if it pops.' }]),
        targets,
        CATALOGUE,
      ).kind,
    ).toBe('doctor');
  });
  it('lets a caution through', () => {
    const r = readAnswer(
      answer([
        {
          ref: '1',
          action: 'modify',
          reason: 'Stop if you feel tingling.',
          change: 'Two reps short of failure.',
        },
      ]),
      targets,
      CATALOGUE,
    );
    expect(r.kind).toBe('advice');
  });
});
