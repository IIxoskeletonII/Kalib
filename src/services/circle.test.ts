import { beforeEach, describe, expect, it } from 'vitest';
import { RATING_START } from '@/core/circle';
import { addDays, todayKey } from '@/core/dates';
import type { WorkoutSet } from '@/core/types';
import { db } from '@/db/db';
import { getSetting, setSetting } from '@/db/repo/settings';
import { saveProfileSnapshot } from '@/db/repo/profiles';
import { upsertWeighIn } from '@/db/repo/weighIns';
import { addSession } from '@/db/repo/workouts';
import {
  circle,
  CIRCLE_MEMBER_KEY,
  CIRCLE_SETTINGS_KEY,
  circleApi,
  circleError,
  getCircleSettings,
  myWeeks,
  publishInBackground,
  resetPublishThrottle,
  setHardMode,
  toPayload,
  type Rpc,
} from './circle';
import { momentum, setAim } from './momentum';
import { syncConfigured } from './sync/config';

beforeEach(async () => {
  await db.delete();
  await db.open();
  resetPublishThrottle();
});

/** A stand-in server: records every call and answers from a table of canned replies. */
function fakeServer(
  replies: Record<string, unknown | ((args: Record<string, unknown>) => unknown)> = {},
) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc: Rpc = async (fn, args) => {
    calls.push({ fn, args });
    const r = replies[fn];
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? (r as (a: Record<string, unknown>) => unknown)(args) : r;
  };
  return { calls, api: circleApi(rpc) };
}

const set = (weight_kg: number, reps: number): WorkoutSet => ({
  kind: 'normal',
  done: true,
  weight_kg,
  reps,
});

async function trained(daysAgo: number, kg = 100, name = 'Bench press') {
  const at = new Date();
  at.setDate(at.getDate() - daysAgo);
  at.setHours(12, 0, 0, 0);
  return addSession({
    started_at: at.toISOString(),
    ended_at: new Date(at.getTime() + 3_600_000).toISOString(),
    name: 'Push day',
    note: 'felt strong, left shoulder twinge',
    entries: [
      {
        exercise_id: 'bench',
        name,
        load_type: 'weight_reps',
        sets: [set(kg, 1), set(kg * 0.8, 5)],
      },
    ],
  });
}

const MINE = [{ id: 'c1', name: 'Home', role: 'owner', display_name: 'Eli', members: 2 }];

describe('publishing', () => {
  it('sends nothing at all before you are in a circle', async () => {
    await trained(2);
    const { calls, api } = fakeServer();
    expect(await api.publish()).toBe(0);
    await publishInBackground(api);
    expect(calls).toEqual([]);
  });

  it('sends five weeks of integers and not one thing they were computed from', async () => {
    await saveProfileSnapshot({
      sex: 'male',
      birth_date: '1990-01-01',
      height_cm: 180,
      activity_level: 'moderate',
      mode: 'cut',
      goal_rate_kg_per_week: -0.5,
    } as never);
    await upsertWeighIn(addDays(todayKey(), -40), 83.4);
    for (const d of [3, 10, 17, 24, 38, 45]) await trained(d, 100 + (45 - d) / 10);
    await setSetting(CIRCLE_MEMBER_KEY, true);
    const { calls, api } = fakeServer({ circle_publish: 5 });
    expect(await api.publish()).toBe(5);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe('circle_publish');
    const weeks = calls[0]!.args.p_weeks as Record<string, unknown>[];
    expect(weeks).toHaveLength(5);
    const allowed = [
      'week',
      'planned',
      'done',
      'consistency',
      'progress',
      'score',
      'flagged',
      'hard',
      'rating',
    ];
    for (const w of weeks) {
      expect(Object.keys(w).sort()).toEqual([...allowed].sort());
      expect(w.week).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${w.week as string}T12:00:00`).getDay()).toBe(1);
      for (const k of allowed.filter((x) => x !== 'week' && x !== 'hard')) {
        const v = w[k];
        expect(v === null || Number.isInteger(v), `${k} = ${String(v)}`).toBe(true);
      }
    }
    const sent = JSON.stringify(calls[0]!.args);
    for (const secret of [
      'Bench',
      'bench',
      'Push',
      'shoulder',
      '83.4',
      'weight',
      'kg',
      'note',
      'male',
      'cut',
    ]) {
      expect(sent).not.toContain(secret);
    }
  });

  it('stops trying when the server says you are in no circle any more', async () => {
    await setSetting(CIRCLE_MEMBER_KEY, true);
    const { api } = fakeServer({ circle_publish: new Error('circle: not in a circle') });
    expect(await api.publish()).toBe(0);
    expect(await getSetting(CIRCLE_MEMBER_KEY)).toBe(false);
  });

  it('passes other failures on to whoever asked', async () => {
    await setSetting(CIRCLE_MEMBER_KEY, true);
    const { api } = fakeServer({ circle_publish: new TypeError('Failed to fetch') });
    await expect(api.publish()).rejects.toMatchObject({ kind: 'offline' });
    expect(await getSetting(CIRCLE_MEMBER_KEY)).toBe(true);
  });

  it('publishes in the background at most every six hours, and fails quietly', async () => {
    await setSetting(CIRCLE_MEMBER_KEY, true);
    const { calls, api } = fakeServer({ circle_publish: 5 });
    const t = Date.now() + 7 * 3_600_000;
    await publishInBackground(api, t);
    await publishInBackground(api, t + 3_600_000);
    expect(calls).toHaveLength(1);
    await publishInBackground(api, t + 7 * 3_600_000);
    expect(calls).toHaveLength(2);

    resetPublishThrottle();
    const broken = fakeServer({ circle_publish: new TypeError('Failed to fetch') });
    await expect(publishInBackground(broken.api)).resolves.toBeUndefined();
  });

  it('caps the flagged count at what the server accepts', () => {
    const [w] = toPayload([
      {
        week: '2026-10-19',
        planned: 3,
        done: 1,
        consistency: 33,
        score: 33,
        flagged: 400,
        hard: false,
      },
    ]);
    expect(w).toEqual({
      week: '2026-10-19',
      planned: 3,
      done: 1,
      consistency: 33,
      progress: null,
      score: 33,
      flagged: 99,
      hard: false,
      rating: null,
    });
  });
});

describe('membership', () => {
  it('remembers whether you are in a circle from what the server says', async () => {
    const { api } = fakeServer({ circle_mine: MINE });
    expect(await api.mine()).toEqual(MINE);
    expect(await getSetting(CIRCLE_MEMBER_KEY)).toBe(true);
    const empty = fakeServer({ circle_mine: [] });
    expect(await empty.api.mine()).toEqual([]);
    expect(await getSetting(CIRCLE_MEMBER_KEY)).toBe(false);
  });

  it('creating a circle makes you a member and publishes straight away', async () => {
    const { calls, api } = fakeServer({ circle_create: 'c1', circle_publish: 5 });
    expect(await api.create('Home', 'Eli')).toBe('c1');
    expect(calls.map((c) => c.fn)).toEqual(['circle_create', 'circle_publish']);
    expect(calls[0]!.args).toEqual({ p_name: 'Home', p_display_name: 'Eli' });
  });

  it('cleans a typed code, and refuses a malformed one without asking the server', async () => {
    const { calls, api } = fakeServer({ circle_join: 'c1', circle_publish: 5 });
    expect(await api.join(' abcde 23456 ', 'Sam')).toBe('c1');
    expect(calls[0]).toEqual({
      fn: 'circle_join',
      args: { p_code: 'ABCDE23456', p_display_name: 'Sam' },
    });
    expect(calls[1]!.fn).toBe('circle_publish');

    const none = fakeServer();
    await expect(none.api.join('ABC', 'Sam')).rejects.toMatchObject({ kind: 'invalid-code' });
    await expect(none.api.join('', 'Sam')).rejects.toMatchObject({ kind: 'invalid-code' });
    expect(none.calls).toEqual([]);
  });

  it('says a code did not work, without saying why', async () => {
    const { api } = fakeServer({ circle_join: null });
    await expect(api.join('ABCDE-23456', 'Sam')).rejects.toMatchObject({
      kind: 'invalid-code',
      message: expect.stringMatching(/did not work/),
    });
    expect(await getSetting(CIRCLE_MEMBER_KEY)).toBeUndefined();
  });

  it('leaving asks the server again, so the last circle left turns publishing off', async () => {
    await setSetting(CIRCLE_MEMBER_KEY, true);
    const { calls, api } = fakeServer({ circle_leave: null, circle_mine: [] });
    await api.leave('c1');
    expect(calls.map((c) => c.fn)).toEqual(['circle_leave', 'circle_mine']);
    expect(await getSetting(CIRCLE_MEMBER_KEY)).toBe(false);
    expect(await api.publish()).toBe(0);
  });

  it('hands back the code an invite made, and says so when there was none', async () => {
    const { api } = fakeServer({
      circle_invite: [{ code: 'ABCDE-23456', expires_at: '2026-10-28T10:00:00Z' }],
    });
    expect(await api.invite('c1')).toEqual({
      code: 'ABCDE-23456',
      expires_at: '2026-10-28T10:00:00Z',
    });
    const empty = fakeServer({ circle_invite: [] });
    await expect(empty.api.invite('c1')).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('removes and renames by the circle’s own ids', async () => {
    const { calls, api } = fakeServer();
    await api.remove('c1', 'm2');
    await api.rename('c1', 'Sammy');
    await api.revokeInvites('c1');
    expect(calls).toEqual([
      { fn: 'circle_remove', args: { p_circle: 'c1', p_member: 'm2' } },
      { fn: 'circle_rename_me', args: { p_circle: 'c1', p_display_name: 'Sammy' } },
      { fn: 'circle_revoke_invites', args: { p_circle: 'c1' } },
    ]);
  });
});

describe('the board', () => {
  it('ranks the members who published and lists the silent ones after, unranked', async () => {
    const today = '2026-10-21';
    const row = (member: string, name: string, week: string, score: number) => ({
      member_id: member,
      display_name: name,
      is_me: member === 'm1',
      is_owner: member === 'm1',
      week,
      planned: 3,
      done: 3,
      consistency: score,
      progress: null,
      score,
      flagged: 0,
      hard: false,
      rating: null,
    });
    const { api } = fakeServer({
      circle_board: [
        row('m1', 'Eli', '2026-10-12', 80),
        row('m2', 'Sam', '2026-10-12', 95),
        { member_id: 'm3', display_name: 'New', is_me: false, is_owner: false, week: null },
      ],
    });
    const board = await api.board('c1', today);
    expect(board.map((b) => [b.display_name, b.rank, b.score])).toEqual([
      ['Sam', 1, 95],
      ['Eli', 2, 80],
      ['New', undefined, undefined],
    ]);
    expect(board[1]!.is_me).toBe(true);
  });
});

describe('errors', () => {
  it.each([
    ['circle: not signed in', 'signed-out'],
    ['circle: too many attempts', 'throttled'],
    ['circle: circle is full', 'full'],
    ['circle: in too many circles', 'too-many'],
    ['circle: only the owner can invite', 'not-owner'],
    ['circle: not a member', 'not-member'],
    ['circle: name must be 1 to 24 characters', 'bad-name'],
    ['Failed to fetch', 'offline'],
    ['something nobody planned for', 'unknown'],
  ])('%s → %s', (message, kind) => {
    expect(circleError(new Error(message)).kind).toBe(kind);
  });

  it('says how long a name may be', () => {
    expect(circleError(new Error('circle: name must be 1 to 24 characters')).message).toBe(
      'Names are 1 to 24 characters.',
    );
  });

  it('reads a Supabase error object, which is not an Error', () => {
    expect(circleError({ message: 'circle: circle is full', code: '54000' }).kind).toBe('full');
  });

  it('never shows the raw server text', () => {
    const e = circleError(
      new Error('ERROR: relation "public.circle_scores" violates check constraint'),
    );
    expect(e.message).not.toMatch(/circle_scores|constraint/);
  });

  it('refuses plainly without a server, or without a session', async () => {
    // Which one depends on the checkout: a clone has no .env.local, and the tests never sign in.
    await expect(circle.mine()).rejects.toMatchObject({
      kind: syncConfigured ? 'signed-out' : 'unconfigured',
    });
  });
});

describe('settings', () => {
  it('keeps only hard mode, and ignores a commitment stored by an earlier build', async () => {
    await setSetting(CIRCLE_SETTINGS_KEY, { commitment: 4, hard_since: '2026-10-01' });
    expect(await getCircleSettings()).toEqual({ hard_since: '2026-10-01' });
    await setSetting(CIRCLE_SETTINGS_KEY, { commitment: 4 });
    expect(await getCircleSettings()).toEqual({});
    for (const junk of ['x', 5, null, [], { hard_since: 12 }, { hard_since: 'yesterday' }]) {
      await setSetting(CIRCLE_SETTINGS_KEY, junk);
      expect(await getCircleSettings()).toEqual({});
    }
  });

  it('drops an old commitment on the next write', async () => {
    await setSetting(CIRCLE_SETTINGS_KEY, { commitment: 4 });
    await setHardMode(true, '2026-10-01');
    expect(await getSetting(CIRCLE_SETTINGS_KEY)).toEqual({ hard_since: '2026-10-01' });
  });

  it('starts hard mode today, keeps its start if switched on again, and forgets it when off', async () => {
    await setHardMode(true, '2026-10-01');
    await setHardMode(true, '2026-10-20');
    expect(await getCircleSettings()).toEqual({ hard_since: '2026-10-01' });
    await setHardMode(false);
    expect(await getSetting(CIRCLE_SETTINGS_KEY)).toEqual({});
    expect(await getCircleSettings()).toEqual({});
  });

  it('computes this phone’s weeks from its own history and the run’s aim', async () => {
    const today = todayKey();
    await setAim(2, addDays(today, -60));
    // Five weeks back is always before the oldest week shown, whatever day today is.
    await trained(35);
    await trained(1);
    await setHardMode(true, today);
    const weeks = await myWeeks(today);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.planned === 2)).toBe(true);
    expect(weeks.at(-1)).toMatchObject({ hard: true, rating: RATING_START });
    expect(weeks.reduce((s, w) => s + w.done, 0)).toBe(1);
  });

  it('changing the aim changes this week’s plan, and never a week already over', async () => {
    const today = todayKey();
    await setAim(2, addDays(today, -60));
    await trained(35);
    await trained(8);
    const before = await myWeeks(today);
    expect(before.map((w) => w.planned)).toEqual([2, 2, 2, 2, 2]);

    await setAim(4, today);
    const after = await myWeeks(today);
    expect(after.slice(0, -1).map((w) => w.planned)).toEqual([2, 2, 2, 2]);
    expect(after.at(-1)!.planned).toBe(4);
    // One number in the app: the run on Train reads the same aim this week.
    expect((await momentum(today)).streak.this_week.aim).toBe(4);

    // Back to Auto: the aim is read from the weeks, again for this week only.
    await setAim(null, today);
    const auto = await myWeeks(today);
    expect(auto.slice(0, -1).map((w) => w.planned)).toEqual([2, 2, 2, 2]);
    expect(auto.at(-1)!.planned).toBe((await momentum(today)).streak.this_week.aim);
  });

  it('plans by Auto when no aim was ever set, as the run does', async () => {
    const today = todayKey();
    for (const d of [2, 4, 9, 11, 16, 18, 23, 25, 30, 32]) await trained(d);
    const weeks = await myWeeks(today);
    const streak = (await momentum(today)).streak;
    expect(weeks.at(-1)!.planned).toBe(streak.this_week.aim);
    expect(weeks.map((w) => w.planned)).toEqual(streak.history.slice(-5).map((w) => w.aim));
  });

  it('publishes only this week for someone who has never trained', async () => {
    const weeks = await myWeeks(todayKey());
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ done: 0, consistency: 0 });
  });

  it('shares the run’s skips: hard mode cannot forgive what the month already spent', async () => {
    // Seven weeks of training, then nothing for the last five and a half: what the month spent
    // on the run before hard mode came on is spent for hard mode too.
    const today = todayKey();
    await setAim(3, addDays(today, -120));
    for (let d = 40; d <= 90; d += 2) await trained(d);
    await setHardMode(true, addDays(today, -28));
    const weeks = await myWeeks(today);
    const rated = weeks.filter((w) => w.rating != null);
    expect(rated.length).toBeGreaterThan(0);
    // Three or more empty judged weeks, of which a month's skips can cover at most one.
    expect(rated.at(-1)!.rating!).toBeLessThan(RATING_START);
  });
});
