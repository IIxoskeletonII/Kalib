// The path that failed in production: the phone reports its day, the Worker stores it, and the
// cron sends a nudge that names what is left. Each step is exercised against the real handler.
import { describe, expect, it, vi } from 'vitest';
import worker, { runReminders, type Env } from './index';
import {
  b64urlEncode,
  dueReminders,
  outstanding,
  reminderMessage,
  type StoredSubscription,
} from './push';

const ENDPOINT = 'https://web.push.apple.com/abc123';

/** Real keys: the send path encrypts for the subscriber and signs with VAPID, as in production. */
async function realKeys() {
  const ecdh = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const p256dh = b64urlEncode(
    new Uint8Array((await crypto.subtle.exportKey('raw', ecdh.publicKey)) as ArrayBuffer),
  );
  const ecdsa = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const vapidPub = b64urlEncode(
    new Uint8Array((await crypto.subtle.exportKey('raw', ecdsa.publicKey)) as ArrayBuffer),
  );
  const jwk = (await crypto.subtle.exportKey('jwk', ecdsa.privateKey)) as JsonWebKey;
  return {
    keys: { p256dh, auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))) },
    vapid: { VAPID_PUBLIC_KEY: vapidPub, VAPID_PRIVATE_KEY: jwk.d!, VAPID_SUBJECT: 'https://k' },
  };
}

/** A KV stand-in with the three calls the Worker uses. */
function kv() {
  const data = new Map<string, string>();
  return {
    data,
    async get(key: string, type?: string) {
      const raw = data.get(key);
      if (raw == null) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key: string, value: string) {
      data.set(key, value);
    },
    async delete(key: string) {
      data.delete(key);
    },
    async list() {
      return { keys: [...data.keys()].map((name) => ({ name })), list_complete: true, cursor: '' };
    },
  } as unknown as KVNamespace & { data: Map<string, string> };
}

function env(store: ReturnType<typeof kv>, vapid?: Record<string, string>): Env {
  return {
    PUSH: store,
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_ANON_KEY: 'key',
    VAPID_PUBLIC_KEY: 'pub',
    VAPID_PRIVATE_KEY: 'priv',
    ...vapid,
    ASSETS: { fetch: async () => new Response('') } as unknown as Fetcher,
  } as Env;
}

const post = (path: string, body: unknown) =>
  new Request(`https://kalib.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer a.b.c' },
    body: JSON.stringify(body),
  });

const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as ExecutionContext;

/** Supabase says who the bearer token is; everything else in the test is real code. */
function mockAuth() {
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string | URL | Request) => {
    if (String(url).includes('/auth/v1/user')) {
      return Response.json({ id: 'user-1', email: 'a@b.c' });
    }
    return new Response('', { status: 201 }); // the push service accepting a notification
  }) as typeof fetch);
}

describe('the day report survives the round trip', () => {
  it('is stored by the ping and answered by status', async () => {
    mockAuth();
    const store = kv();
    const e = env(store);
    const { keys } = await realKeys();
    const sub = { endpoint: ENDPOINT, keys };
    const subscribed = await worker.fetch(
      post('/api/push/subscribe', {
        subscription: sub,
        prefs: { weighAt: '07:30', logAt: '20:00' },
        tz: 'Europe/Rome',
        app: '0.19.0',
      }),
      e,
      ctx,
    );
    expect(subscribed.status).toBe(200);

    const day = {
      date: '2026-09-28',
      weighed: true,
      logged: true,
      supplements_left: 1,
      supplements_total: 3,
      water_left_ml: 0,
    };
    const pinged = await worker.fetch(
      post('/api/push/ping', { endpoint: ENDPOINT, day, app: '0.19.0', tz: 'Europe/Rome' }),
      e,
      ctx,
    );
    expect(pinged.status).toBe(200);

    const status = (await (
      await worker.fetch(post('/api/push/status', { endpoint: ENDPOINT }), e, ctx)
    ).json()) as { day: typeof day; app: string; registered: boolean };
    // The exact failure in production: the report reached the server and was thrown away.
    expect(status.registered).toBe(true);
    expect(status.day).toEqual(day);
    expect(status.app).toBe('0.19.0');
    vi.restoreAllMocks();
  });

  it('the cron then nudges about the untaken supplement, naming it', async () => {
    mockAuth();
    const store = kv();
    const { keys, vapid } = await realKeys();
    const e = env(store, vapid);
    const stored: StoredSubscription = {
      subscription: { endpoint: ENDPOINT, keys },
      prefs: { weighAt: '07:30', logAt: '20:00' },
      tz: 'Europe/Rome',
      day: {
        date: '2026-09-28',
        weighed: true,
        logged: true,
        supplements_left: 1,
        supplements_total: 3,
        water_left_ml: 0,
      },
      updated_at: '',
    };
    // 18:10 UTC is 20:10 in Rome: past the evening time, with the creatine still untaken.
    const now = new Date('2026-09-28T18:10:00Z');
    expect(dueReminders(stored, now)).toEqual(['log']);
    expect(reminderMessage('log', outstanding(stored, '2026-09-28')).body).toBe('1 supplement.');

    store.data.set('deadbeefdeadbeefdeadbeefdeadbeef', JSON.stringify(stored));
    const out = await runReminders(e, now);
    expect(out.sent).toBe(1);
    const after = JSON.parse(
      store.data.get('deadbeefdeadbeefdeadbeefdeadbeef')!,
    ) as StoredSubscription;
    expect(after.sent?.log).toBe('2026-09-28');
    vi.restoreAllMocks();
  });

  it('stays quiet when the same day is fully done', async () => {
    const store = kv();
    const { keys, vapid } = await realKeys();
    const e = env(store, vapid);
    store.data.set(
      'deadbeefdeadbeefdeadbeefdeadbee1',
      JSON.stringify({
        subscription: { endpoint: ENDPOINT, keys },
        prefs: { weighAt: '07:30', logAt: '20:00' },
        tz: 'Europe/Rome',
        day: {
          date: '2026-09-28',
          weighed: true,
          logged: true,
          supplements_left: 0,
          supplements_total: 3,
          water_left_ml: 0,
        },
        updated_at: '',
      }),
    );
    const out = await runReminders(e, new Date('2026-09-28T18:10:00Z'));
    expect(out.sent).toBe(0);
  });
});
