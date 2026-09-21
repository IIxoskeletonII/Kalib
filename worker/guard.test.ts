import { describe, expect, it } from 'vitest';
import {
  admitEstimate,
  isPushEndpoint,
  mayEstimate,
  requireUser,
  underLimit,
  type QuotaStore,
} from './guard';

const env = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_x' };
const jwt = 'aaa.bbb.ccc';

function req(auth?: string): Request {
  return new Request('https://kalib.test/api/estimate', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  });
}

describe('requireUser', () => {
  it('asks Supabase who the bearer token is and caches the answer', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify({ id: 'u1', email: 'a@b.c' }), { status: 200 });
    }) as typeof fetch;
    const a = await requireUser(req(`Bearer ${jwt}`), env, fetchImpl, 1000);
    const b = await requireUser(req(`Bearer ${jwt}`), env, fetchImpl, 2000);
    expect(a).toEqual({ id: 'u1', email: 'a@b.c' });
    expect(b).toEqual(a);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://proj.supabase.co/auth/v1/user');
    expect(calls[0]!.headers.apikey).toBe('sb_publishable_x');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${jwt}`);
  });

  it('is null without a token, with a malformed token, when Supabase says no, or when unconfigured', async () => {
    const deny = (async () => new Response('{"msg":"bad"}', { status: 401 })) as typeof fetch;
    const never = (async () => {
      throw new Error('should not be called');
    }) as typeof fetch;
    expect(await requireUser(req(), env, never)).toBeNull();
    expect(await requireUser(req('Bearer not-a-jwt'), env, never)).toBeNull();
    expect(await requireUser(req('Basic abc'), env, never)).toBeNull();
    expect(await requireUser(req('Bearer x.y.z'), env, deny)).toBeNull();
    expect(await requireUser(req(`Bearer ${jwt}`), {}, never)).toBeNull();
  });

  it('accepts the VITE_-prefixed names from .env.local as uploaded by `wrangler secret bulk`', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ id: 'u9' }), { status: 200 });
    }) as typeof fetch;
    const viteEnv = {
      VITE_SUPABASE_URL: 'https://proj.supabase.co/',
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_y',
    };
    expect(await requireUser(req('Bearer v.i.te'), viteEnv, fetchImpl)).toEqual({
      id: 'u9',
      email: null,
    });
    expect(calls).toEqual(['https://proj.supabase.co/auth/v1/user']);
  });

  it('treats a Supabase outage as not signed in rather than open', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect(await requireUser(req('Bearer d.e.f'), env, down)).toBeNull();
  });
});

function memoryStore(): QuotaStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(k) {
      return data.get(k) ?? null;
    },
    async put(k, v) {
      data.set(k, v);
    },
  };
}

describe('admitEstimate', () => {
  it('counts per user and globally, and stops at each cap', async () => {
    const store = memoryStore();
    const e = { ESTIMATE_DAILY_USER: '2', ESTIMATE_DAILY_TOTAL: '3' };
    const now = new Date('2026-09-21T10:00:00Z');
    expect(await admitEstimate(store, 'u1', e, now)).toEqual({
      ok: true,
      usedToday: 1,
      capUser: 2,
    });
    expect(await admitEstimate(store, 'u1', e, now)).toEqual({
      ok: true,
      usedToday: 2,
      capUser: 2,
    });
    expect(await admitEstimate(store, 'u1', e, now)).toEqual({ ok: false, reason: 'user' });
    expect(await admitEstimate(store, 'u2', e, now)).toEqual({
      ok: true,
      usedToday: 1,
      capUser: 2,
    });
    expect(await admitEstimate(store, 'u2', e, now)).toEqual({ ok: false, reason: 'total' });
    expect(store.data.get('quota:estimate:2026-09-21:all')).toBe('3');
  });

  it('starts fresh on a new day and falls back to sane defaults', async () => {
    const store = memoryStore();
    const bad = { ESTIMATE_DAILY_USER: '-5', ESTIMATE_DAILY_TOTAL: 'lots' };
    const r = await admitEstimate(store, 'u1', bad, new Date('2026-09-21T23:59:00Z'));
    expect(r).toEqual({ ok: true, usedToday: 1, capUser: 30 });
    const next = await admitEstimate(store, 'u1', bad, new Date('2026-09-22T00:01:00Z'));
    expect(next).toEqual({ ok: true, usedToday: 1, capUser: 30 });
  });
});

describe('mayEstimate', () => {
  it('is open to any signed-in user unless an allow-list is set', () => {
    const me = { id: 'u1', email: 'Me@Example.com' };
    const stranger = { id: 'u2', email: 'x@y.z' };
    const noEmail = { id: 'u3', email: null };
    expect(mayEstimate(stranger, {})).toBe(true);
    expect(mayEstimate(noEmail, { ESTIMATE_ALLOWED_EMAILS: ' ' })).toBe(true);
    const env = { ESTIMATE_ALLOWED_EMAILS: 'me@example.com, partner@example.com' };
    expect(mayEstimate(me, env)).toBe(true);
    expect(mayEstimate(stranger, env)).toBe(false);
    expect(mayEstimate(noEmail, env)).toBe(false);
  });
});

describe('isPushEndpoint', () => {
  it('accepts the browsers’ push services over https only', () => {
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc:APA91b')).toBe(true);
    expect(isPushEndpoint('https://web.push.apple.com/QGxyz')).toBe(true);
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/gAAAA')).toBe(true);
    expect(isPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
  });

  it('rejects anything that could turn the cron into a relay', () => {
    expect(isPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(isPushEndpoint('https://evil.example/collect')).toBe(false);
    expect(isPushEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false);
    expect(isPushEndpoint('https://user:pw@web.push.apple.com/x')).toBe(false);
    expect(isPushEndpoint('https://10.0.0.1/x')).toBe(false);
    expect(isPushEndpoint(42)).toBe(false);
    expect(isPushEndpoint('not a url')).toBe(false);
  });
});

describe('underLimit', () => {
  it('is permissive without a binding and follows the binding when present', async () => {
    expect(await underLimit(undefined, 'k')).toBe(true);
    expect(await underLimit({ limit: async () => ({ success: false }) }, 'k')).toBe(false);
    expect(await underLimit({ limit: async () => ({ success: true }) }, 'k')).toBe(true);
  });
});
