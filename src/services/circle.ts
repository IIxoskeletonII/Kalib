// SPEC §21 — the circle, between the phone and the server.
//
// Everything is computed here, on the phone, from the phone's own history (core/circle.ts), and
// what goes to the server is the result: a few integers a week. The server's functions
// (supabase/migrations/0009_circle.sql) accept nothing else and hand back nothing else.
//
// Nothing is published until you are in a circle. The server refuses a publish from someone in
// none, and this side does not try.
import {
  circleWeeks,
  rankBoard,
  type BoardRow,
  type BoardWeek,
  type CircleWeek,
} from '@/core/circle';
import { todayKey } from '@/core/dates';
import { getCurrentProfile } from '@/db/repo/profiles';
import { getSetting, setSetting } from '@/db/repo/settings';
import { listWeighIns } from '@/db/repo/weighIns';
import { listSessions } from '@/db/repo/workouts';
import { getEasyWeeks } from './block';
import { getAims } from './momentum';
import { syncConfigured } from './sync/config';

export const CIRCLE_SETTINGS_KEY = 'circle';
/** Whether this account is in any circle, so the background publish need not ask the server. */
export const CIRCLE_MEMBER_KEY = 'circle_member';

/**
 * The circle's own settings: only hard mode. How many days a week you mean to train is the
 * streak's aim (§20.15, `setAim`), one number for the whole app; a `commitment` stored here by
 * an earlier build is ignored and dropped on the next write.
 */
export interface CircleSettings {
  /** Day hard mode was switched on, `YYYY-MM-DD`; absent when off. */
  hard_since?: string;
}

export interface CircleSummary {
  id: string;
  name: string;
  role: 'owner' | 'member';
  display_name: string;
  members: number;
}

export interface Invite {
  /** `ABCDE-FGHJK`. Shown once: the server keeps only its hash. */
  code: string;
  expires_at: string;
}

export type CircleErrorKind =
  | 'unconfigured'
  | 'signed-out'
  | 'offline'
  | 'invalid-code'
  | 'throttled'
  | 'full'
  | 'too-many'
  | 'not-owner'
  | 'not-member'
  | 'bad-name'
  | 'unknown';

export class CircleError extends Error {
  constructor(
    readonly kind: CircleErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CircleError';
  }
}

/** What the server said, in words a person can act on. */
export function circleError(raw: unknown): CircleError {
  if (raw instanceof CircleError) return raw;
  const message =
    raw instanceof Error ? raw.message : String((raw as { message?: unknown })?.message ?? raw);
  const name = /1 to (\d+) characters/.exec(message);
  if (name) return new CircleError('bad-name', `Names are 1 to ${name[1]} characters.`);
  const known: [RegExp, CircleErrorKind, string][] = [
    [/not signed in|JWT|401/i, 'signed-out', 'Sign in to use a circle.'],
    [/too many attempts/, 'throttled', 'Too many wrong codes. Try again in an hour.'],
    [/circle is full/, 'full', 'That circle is full — twelve is the most.'],
    [/too many circles/, 'too-many', 'You are in five circles already. Leave one first.'],
    [/only the owner/, 'not-owner', 'Only the circle’s owner can do that.'],
    [/not a member|not in a circle/, 'not-member', 'You are not in that circle any more.'],
    [
      /Failed to fetch|NetworkError|network|fetch failed|Load failed/i,
      'offline',
      'No connection. The circle needs one.',
    ],
  ];
  for (const [re, kind, text] of known) if (re.test(message)) return new CircleError(kind, text);
  return new CircleError('unknown', 'That did not work. Try again in a moment.');
}

/** One call to a server function. Injected so the tests can stand in for Supabase. */
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

/** The real thing: the signed-in Supabase client, or a refusal saying why there is none. */
const supabaseRpc: Rpc = async (fn, args) => {
  if (!syncConfigured) {
    throw new CircleError('unconfigured', 'This copy of Kalib has no server to share through.');
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new CircleError('offline', 'No connection. The circle needs one.');
  }
  const m = await import('./sync/supabase');
  if (!(await m.getSession())) throw new CircleError('signed-out', 'Sign in to use a circle.');
  const { data, error } = await m.supabase().rpc(fn, args);
  if (error) throw error;
  return data;
};

export async function getCircleSettings(): Promise<CircleSettings> {
  const stored = await getSetting<unknown>(CIRCLE_SETTINGS_KEY);
  const since =
    stored != null && typeof stored === 'object'
      ? (stored as { hard_since?: unknown }).hard_since
      : undefined;
  return typeof since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(since)
    ? { hard_since: since }
    : {};
}

/** Switching off forgets the rating: hard mode switched back on starts again from the start. */
export async function setHardMode(on: boolean, today = todayKey()): Promise<void> {
  const { hard_since } = await getCircleSettings();
  await setSetting(CIRCLE_SETTINGS_KEY, on ? { hard_since: hard_since ?? today } : {});
}

/**
 * This phone's weeks, as they would be published. Computed only; nothing is sent. Reads every
 * session, as the streak does (services/momentum.ts): the aim and the month's skips are the
 * streak's, and a window would read them differently from Train.
 */
export async function myWeeks(today = todayKey()): Promise<CircleWeek[]> {
  const [settings, sessions, weighIns, profile, easyWeeks, aims] = await Promise.all([
    getCircleSettings(),
    listSessions(),
    listWeighIns(),
    getCurrentProfile(),
    getEasyWeeks(),
    getAims(),
  ]);
  return circleWeeks({
    sessions,
    weighIns,
    ...(profile ? { sex: profile.sex } : {}),
    easyWeeks,
    aims,
    ...(settings.hard_since ? { hardSince: settings.hard_since } : {}),
    today,
  });
}

/** Exactly the fields the server accepts; anything else on a week stays on the phone. */
export function toPayload(weeks: readonly CircleWeek[]): Record<string, unknown>[] {
  return weeks.map((w) => ({
    week: w.week,
    planned: w.planned,
    done: w.done,
    consistency: w.consistency,
    progress: w.progress ?? null,
    score: w.score,
    flagged: Math.min(99, w.flagged),
    hard: w.hard,
    rating: w.rating ?? null,
  }));
}

function asSummary(row: Record<string, unknown>): CircleSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    role: row.role === 'owner' ? 'owner' : 'member',
    display_name: String(row.display_name),
    members: Number(row.members),
  };
}

function asBoardWeek(row: Record<string, unknown>): BoardWeek | undefined {
  if (row.week == null) return undefined;
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    member_id: String(row.member_id),
    display_name: String(row.display_name),
    is_me: row.is_me === true,
    is_owner: row.is_owner === true,
    week: String(row.week).slice(0, 10),
    planned: Number(row.planned),
    done: Number(row.done),
    consistency: Number(row.consistency),
    progress: n(row.progress),
    score: Number(row.score),
    flagged: Number(row.flagged),
    hard: row.hard === true,
    rating: n(row.rating),
  };
}

/** Throttle for the background publish: memory only, so it never writes or syncs anything. */
const PUBLISH_EVERY_MS = 6 * 60 * 60 * 1000;
let lastPublished = 0;

export function circleApi(rpc: Rpc = supabaseRpc) {
  const call = async (fn: string, args: Record<string, unknown> = {}) => {
    try {
      return await rpc(fn, args);
    } catch (err) {
      throw circleError(err);
    }
  };

  const remember = async (circles: readonly CircleSummary[]) => {
    const member = circles.length > 0;
    if ((await getSetting<boolean>(CIRCLE_MEMBER_KEY)) !== member) {
      await setSetting(CIRCLE_MEMBER_KEY, member);
    }
  };

  const api = {
    async mine(): Promise<CircleSummary[]> {
      const rows = ((await call('circle_mine')) ?? []) as Record<string, unknown>[];
      const circles = rows.map(asSummary);
      await remember(circles);
      return circles;
    },

    async create(name: string, displayName: string): Promise<string> {
      const id = String(await call('circle_create', { p_name: name, p_display_name: displayName }));
      await setSetting(CIRCLE_MEMBER_KEY, true);
      await api.publish();
      return id;
    },

    async invite(circleId: string): Promise<Invite> {
      const rows = (await call('circle_invite', { p_circle: circleId })) as Record<
        string,
        unknown
      >[];
      const row = rows?.[0];
      if (!row) throw new CircleError('unknown', 'No code came back. Try again.');
      return { code: String(row.code), expires_at: String(row.expires_at) };
    },

    async revokeInvites(circleId: string): Promise<void> {
      await call('circle_revoke_invites', { p_circle: circleId });
    },

    /** The circle joined. A wrong, expired or revoked code is one error: which, is not said. */
    async join(code: string, displayName: string): Promise<string> {
      const cleaned = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (cleaned.length !== 10) {
        throw new CircleError(
          'invalid-code',
          'A code is ten letters and numbers, like ABCDE-23456.',
        );
      }
      const id = await call('circle_join', { p_code: cleaned, p_display_name: displayName });
      if (id == null) {
        throw new CircleError(
          'invalid-code',
          'That code did not work. It may have expired or been replaced.',
        );
      }
      await setSetting(CIRCLE_MEMBER_KEY, true);
      await api.publish();
      return String(id);
    },

    /** Leaving your last circle deletes everything you published; the server sees to it. */
    async leave(circleId: string): Promise<void> {
      await call('circle_leave', { p_circle: circleId });
      await api.mine();
    },

    async remove(circleId: string, memberId: string): Promise<void> {
      await call('circle_remove', { p_circle: circleId, p_member: memberId });
    },

    async rename(circleId: string, displayName: string): Promise<void> {
      await call('circle_rename_me', { p_circle: circleId, p_display_name: displayName });
    },

    /** Sends this phone's weeks. Does nothing, and sends nothing, outside a circle. */
    async publish(today = todayKey()): Promise<number> {
      if (!(await getSetting<boolean>(CIRCLE_MEMBER_KEY))) return 0;
      const weeks = toPayload(await myWeeks(today));
      try {
        const n = Number(await call('circle_publish', { p_weeks: weeks }));
        lastPublished = Date.now();
        return n;
      } catch (err) {
        // Removed from every circle on the server since this phone last looked.
        if (err instanceof CircleError && err.kind === 'not-member') {
          await setSetting(CIRCLE_MEMBER_KEY, false);
          return 0;
        }
        throw err;
      }
    },

    async board(circleId: string, today = todayKey()): Promise<BoardRow[]> {
      const rows = ((await call('circle_board', { p_circle: circleId })) ?? []) as Record<
        string,
        unknown
      >[];
      // A member who has published nothing still belongs on the board, unranked.
      const weeks: BoardWeek[] = [];
      const silent: BoardRow[] = [];
      for (const row of rows) {
        const w = asBoardWeek(row);
        if (w) weeks.push(w);
        else {
          silent.push({
            member_id: String(row.member_id),
            display_name: String(row.display_name),
            is_me: row.is_me === true,
            is_owner: row.is_owner === true,
            done: 0,
            planned: 0,
            hard: false,
            weeks: 0,
          });
        }
      }
      return [...rankBoard(weeks, today), ...silent];
    },
  };
  return api;
}

export const circle = circleApi();

/**
 * The background publish, after a sync: keeps the board current without anyone opening it.
 * Quiet by design — at most every six hours, never outside a circle, and a failure waits for
 * the next one rather than telling anybody.
 */
export async function publishInBackground(api = circle, now = Date.now()): Promise<void> {
  if (now - lastPublished < PUBLISH_EVERY_MS) return;
  if (!(await getSetting<boolean>(CIRCLE_MEMBER_KEY))) return;
  try {
    await api.publish();
    lastPublished = now;
  } catch {
    // Offline, signed out, or the server is down: the next sync tries again.
  }
}

/** For tests: forget when the last publish happened. */
export function resetPublishThrottle(): void {
  lastPublished = 0;
}
