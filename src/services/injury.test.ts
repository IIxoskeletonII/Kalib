import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exercise, LoadType, Muscle } from '@/core/types';
import { db } from '@/db/db';
import { addExercise, deleteExercise } from '@/db/repo/exercises';
import { getSetting } from '@/db/repo/settings';
import { addRoutine, getRoutine, updateRoutine } from '@/db/repo/workouts';
import {
  INJURY_CONSENT_HEADER,
  INJURY_CONSENT_KEY,
  INJURY_CONSENT_VERSION,
  INJURY_ENDPOINT,
  InjuryHelpError,
  applySwap,
  askInjuryHelp,
  getInjuryConsent,
  giveInjuryConsent,
  withdrawInjuryConsent,
  type InjuryDeps,
} from './injury';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function exercise(
  id: string,
  name: string,
  primary: Muscle,
  equipment: string,
  load_type: LoadType = 'weight_reps',
): Promise<Exercise> {
  return addExercise(
    {
      source: 'library',
      name,
      category: 'strength',
      primary_muscle: primary,
      secondary_muscles: ['triceps'],
      equipment,
      load_type,
    },
    id,
  );
}

async function setup() {
  await exercise('bb-bench', 'Barbell Bench Press', 'chest', 'barbell');
  await exercise('db-bench', 'Dumbbell Bench Press', 'chest', 'dumbbell');
  await exercise('plank-press', 'Isometric Chest Squeeze', 'chest', 'body weight', 'time');
  await exercise('squat', 'Barbell Full Squat', 'quads', 'barbell');
  return addRoutine(
    {
      name: 'Push and legs',
      sort_order: 0,
      source: 'own',
      items: [
        {
          exercise_id: 'bb-bench',
          name: 'Barbell Bench Press',
          load_type: 'weight_reps',
          sets: 4,
          rep_low: 6,
          rep_high: 10,
          rest_sec: 150,
          superset: 'A',
          note: 'pause at the bottom',
        },
        { exercise_id: 'squat', name: 'Barbell Full Squat', load_type: 'weight_reps', sets: 3 },
      ],
    },
    'routine-1',
  );
}

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function deps(
  answer: { status?: number; body?: unknown } = {},
  opts: { online?: boolean; signedIn?: boolean; throws?: boolean } = {},
): InjuryDeps & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    online: () => opts.online ?? true,
    auth: async () => (opts.signedIn === false ? {} : { authorization: 'Bearer t' }),
    fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      if (opts.throws) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200 });
    }) as unknown as typeof fetch,
  };
}

const ADVICE = {
  result: {
    needs_doctor: false,
    summary: 'Ease the pressing, keep the legs.',
    advice: [
      {
        ref: '1',
        action: 'swap',
        reason: 'A dumbbell lets the shoulder find its own path.',
        change: '',
        swap_to: 'Dumbbell Bench Press',
      },
      {
        ref: '2',
        action: 'keep',
        reason: 'Squats leave the shoulder alone.',
        change: '',
        swap_to: '',
      },
    ],
  },
  model: 'm',
  used: 1,
  cap: 5,
};

describe('consent', () => {
  it('is absent until given, versioned, and withdrawn by setting it to nothing', async () => {
    expect(await getInjuryConsent()).toBeUndefined();
    await giveInjuryConsent(new Date('2026-10-21T10:00:00Z'));
    expect(await getInjuryConsent()).toEqual({
      version: INJURY_CONSENT_VERSION,
      at: '2026-10-21T10:00:00.000Z',
    });
    await withdrawInjuryConsent();
    expect(await getInjuryConsent()).toBeUndefined();
    expect(await getSetting(INJURY_CONSENT_KEY)).toBeNull();
  });
  it('does not count an agreement to an older version', async () => {
    const { setSetting } = await import('@/db/repo/settings');
    await setSetting(INJURY_CONSENT_KEY, { version: 'injury-v0', at: '2026-01-01T00:00:00Z' });
    expect(await getInjuryConsent()).toBeUndefined();
  });
});

describe('askInjuryHelp', () => {
  it('needs something to go on', async () => {
    const d = deps();
    await expect(askInjuryHelp('   ', {}, d)).rejects.toMatchObject({ problem: 'empty' });
    expect(d.sent).toEqual([]);
  });

  it('answers a red flag on the phone: no consent needed, nothing sent, even offline', async () => {
    const routine = await setup();
    const d = deps({}, { online: false });
    const r = await askInjuryHelp('my arm went numb and I have chest pain', { routine }, d);
    expect(r).toMatchObject({ kind: 'doctor', source: 'description' });
    if (r.kind === 'doctor') expect(r.flags.map((f) => f.id)).toEqual(['chest', 'nerve']);
    expect(d.sent).toEqual([]);
  });

  it('sends nothing without consent', async () => {
    const routine = await setup();
    const d = deps({ body: ADVICE });
    const err = await askInjuryHelp('my shoulder aches on bench', { routine }, d).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InjuryHelpError);
    expect((err as InjuryHelpError).problem).toBe('consent');
    expect(d.sent).toEqual([]);
  });

  it('says so offline, and sends nothing', async () => {
    const routine = await setup();
    await giveInjuryConsent();
    const d = deps({ body: ADVICE }, { online: false });
    await expect(askInjuryHelp('shoulder aches', { routine }, d)).rejects.toMatchObject({
      problem: 'offline',
      message: expect.stringMatching(/needs a connection/),
    });
    expect(d.sent).toEqual([]);
  });

  it('treats a failed request as being offline', async () => {
    const routine = await setup();
    await giveInjuryConsent();
    await expect(
      askInjuryHelp('shoulder aches', { routine }, deps({}, { throws: true })),
    ).rejects.toMatchObject({ problem: 'offline' });
  });

  it('needs an exercise to ask about', async () => {
    await setup();
    await giveInjuryConsent();
    const d = deps({ body: ADVICE });
    await expect(askInjuryHelp('shoulder aches', {}, d)).rejects.toMatchObject({
      problem: 'nothing',
    });
    await expect(askInjuryHelp('shoulder aches', { exercise_id: 'gone' }, d)).rejects.toMatchObject(
      {
        problem: 'nothing',
      },
    );
    expect(d.sent).toEqual([]);
  });

  it('sends the description and exercise names with the consent header, and grounds the answer', async () => {
    const routine = await setup();
    await giveInjuryConsent();
    const d = deps({ body: ADVICE });
    const r = await askInjuryHelp('  my left shoulder   aches on bench ', { routine }, d);

    expect(d.sent).toHaveLength(1);
    const s = d.sent[0]!;
    expect(s.url).toBe(INJURY_ENDPOINT);
    expect(s.headers[INJURY_CONSENT_HEADER]).toBe(INJURY_CONSENT_VERSION);
    expect(s.headers.authorization).toBe('Bearer t');
    expect(s.body.description).toBe('my left shoulder aches on bench');
    const sentText = JSON.stringify(s.body);
    // Names travel, ids and the routine itself do not.
    expect(sentText).toContain('Barbell Bench Press');
    expect(sentText).toContain('Dumbbell Bench Press');
    for (const id of [
      'bb-bench',
      'db-bench',
      'routine-1',
      'Push and legs',
      'pause at the bottom',
    ]) {
      expect(sentText).not.toContain(id);
    }

    expect(r.kind).toBe('advice');
    if (r.kind !== 'advice') return;
    expect(r.used).toBe(1);
    expect(r.cap).toBe(5);
    expect(r.advice.map((a) => [a.action, a.index, a.exercise.id, a.swap?.id])).toEqual([
      ['swap', 0, 'bb-bench', 'db-bench'],
      ['keep', 1, 'squat', undefined],
    ]);
  });

  it('asks about one exercise on its own', async () => {
    await setup();
    await giveInjuryConsent();
    const d = deps({
      body: {
        result: {
          needs_doctor: false,
          summary: '',
          advice: [{ ref: '1', action: 'keep', reason: 'ok' }],
        },
      },
    });
    const r = await askInjuryHelp('elbow aches', { exercise_id: 'squat' }, d);
    expect((d.sent[0]!.body.exercises as unknown[]).length).toBe(1);
    expect(r.kind === 'advice' && r.advice[0]!.index).toBeUndefined();
  });

  it('turns the server’s answers into problems a person can read', async () => {
    const routine = await setup();
    await giveInjuryConsent();
    const cases: [number, unknown, string, RegExp][] = [
      [401, {}, 'signin', /Sign in/],
      [429, { error: 'You have used today’s injury help.' }, 'quota', /today’s injury help/],
      [502, { error: 'Injury help service error 500' }, 'server', /service error/],
      [500, 'not json', 'server', /did not answer \(500\)/],
    ];
    for (const [status, body, problem, message] of cases) {
      await expect(
        askInjuryHelp('shoulder aches', { routine }, deps({ status, body })),
      ).rejects.toMatchObject({
        problem,
        message: expect.stringMatching(message),
      });
    }
  });

  it('shows the Worker’s red flags as a doctor answer', async () => {
    const routine = await setup();
    await giveInjuryConsent();
    const r = await askInjuryHelp(
      'shoulder aches',
      { routine },
      deps({
        body: {
          flags: [{ id: 'nerve', level: 'urgent', label: 'numbness, tingling or weakness' }],
        },
      }),
    );
    expect(r).toMatchObject({ kind: 'doctor', flags: [{ id: 'nerve' }] });
    const junk = await askInjuryHelp(
      'shoulder aches',
      { routine },
      deps({ body: { flags: 'weird' } }),
    );
    expect(junk).toMatchObject({ kind: 'doctor', flags: [{ id: 'model' }] });
  });

  it('replaces advice with a doctor when the model sounds like one', async () => {
    const routine = await setup();
    await giveInjuryConsent();
    const r = await askInjuryHelp(
      'shoulder aches',
      { routine },
      deps({
        body: {
          result: {
            needs_doctor: false,
            summary: 'This might be a torn labrum.',
            advice: [{ ref: '1', action: 'skip', reason: 'Rest it.' }],
          },
        },
      }),
    );
    expect(r).toMatchObject({ kind: 'doctor', source: 'answer' });
  });

  it('refuses an answer that is not one', async () => {
    const routine = await setup();
    await giveInjuryConsent();
    await expect(
      askInjuryHelp('shoulder aches', { routine }, deps({ body: { result: 'sure!' } })),
    ).rejects.toThrow(/shape/);
  });
});

describe('applySwap', () => {
  it('swaps in place, keeps the plan around it, and undoes exactly', async () => {
    await setup();
    const before = (await getRoutine('routine-1'))!.items;
    const undo = await applySwap('routine-1', 0, 'bb-bench', 'db-bench');
    const after = (await getRoutine('routine-1'))!.items;
    expect(after[0]).toEqual({
      exercise_id: 'db-bench',
      name: 'Dumbbell Bench Press',
      load_type: 'weight_reps',
      sets: 4,
      rep_low: 6,
      rep_high: 10,
      rest_sec: 150,
      superset: 'A',
      note: 'pause at the bottom',
    });
    expect(after[1]).toEqual(before[1]);
    await undo();
    expect((await getRoutine('routine-1'))!.items).toEqual(before);
  });

  it('drops the rep range for a timed exercise', async () => {
    await setup();
    await applySwap('routine-1', 0, 'bb-bench', 'plank-press');
    const item = (await getRoutine('routine-1'))!.items[0]!;
    expect(item).toMatchObject({ exercise_id: 'plank-press', load_type: 'time', sets: 4 });
    expect(item.rep_low).toBeUndefined();
    expect(item.rep_high).toBeUndefined();
  });

  it('refuses when the routine moved on since the advice', async () => {
    await setup();
    await updateRoutine('routine-1', { items: [(await getRoutine('routine-1'))!.items[1]!] });
    await expect(applySwap('routine-1', 0, 'bb-bench', 'db-bench')).rejects.toThrow(
      /changed since/,
    );
    await expect(applySwap('nope', 0, 'bb-bench', 'db-bench')).rejects.toThrow(/changed since/);
  });

  it('refuses an exercise that has been deleted', async () => {
    await setup();
    await deleteExercise('db-bench');
    await expect(applySwap('routine-1', 0, 'bb-bench', 'db-bench')).rejects.toThrow(/no longer/);
    expect((await getRoutine('routine-1'))!.items[0]!.exercise_id).toBe('bb-bench');
  });
});
