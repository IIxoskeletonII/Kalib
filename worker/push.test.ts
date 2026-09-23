import { describe, expect, it } from 'vitest';
import {
  b64urlDecode,
  b64urlEncode,
  dueReminders,
  encryptPayload,
  localClock,
  nextReminderAt,
  outstanding,
  reminderMessage,
  sendPush,
  vapidAuthorization,
  type StoredSubscription,
} from './push';

const te = new TextEncoder();
const td = new TextDecoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8),
  );
}

/** A fake browser: its own ECDH key pair and auth secret, and RFC 8291 decryption. */
async function fakeSubscriber() {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const subscription = {
    endpoint: 'https://push.example.com/send/abc',
    keys: { p256dh: b64urlEncode(pub), auth: b64urlEncode(auth) },
  };
  const decrypt = async (msg: Uint8Array) => {
    const salt = msg.slice(0, 16);
    const idlen = msg[20]!;
    const asPublic = msg.slice(21, 21 + idlen);
    const cipher = msg.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey(
      'raw',
      asPublic,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const shared = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'ECDH', public: asKey } as unknown as Parameters<SubtleCrypto['deriveBits']>[0],
        kp.privateKey,
        256,
      ),
    );
    const info = new Uint8Array([...te.encode('WebPush: info\0'), ...pub, ...asPublic]);
    const prk = await hkdf(auth, shared, info, 32);
    const cek = await hkdf(salt, prk, te.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, prk, te.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher),
    );
    expect(plain[plain.length - 1]).toBe(2);
    return td.decode(plain.slice(0, -1));
  };
  return { subscription, decrypt };
}

async function vapidEnv() {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey;
  return {
    env: {
      VAPID_PUBLIC_KEY: b64urlEncode(pub),
      VAPID_PRIVATE_KEY: jwk.d!,
      VAPID_SUBJECT: 'mailto:test@example.com',
    },
    publicKey: kp.publicKey,
  };
}

describe('RFC 8291 payload encryption', () => {
  it('a subscriber can decrypt what the Worker encrypts', async () => {
    const s = await fakeSubscriber();
    const msg = await encryptPayload(s.subscription, '{"title":"Weigh-in","body":"héllo"}');
    // salt(16) rs(4) idlen(1) key(65) + ciphertext + 16-byte tag
    expect(msg.length).toBeGreaterThan(86 + 16);
    expect(new DataView(msg.buffer).getUint32(16)).toBe(4096);
    expect(await s.decrypt(msg)).toBe('{"title":"Weigh-in","body":"héllo"}');
  });
});

describe('VAPID', () => {
  it('produces a JWT the public key verifies, for the endpoint origin', async () => {
    const { env, publicKey } = await vapidEnv();
    const auth = await vapidAuthorization('https://push.example.com/send/abc', env);
    const m = auth.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(m[2]).toBe(env.VAPID_PUBLIC_KEY);
    const [h, c, sig] = m[1]!.split('.');
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      b64urlDecode(sig!),
      te.encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
    const claims = JSON.parse(td.decode(b64urlDecode(c!)));
    expect(claims.aud).toBe('https://push.example.com');
    expect(claims.sub).toBe('mailto:test@example.com');
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it('sendPush posts the right headers and maps 410 to gone', async () => {
    const { env } = await vapidEnv();
    const s = await fakeSubscriber();
    let seen: RequestInit | undefined;
    const ok: typeof fetch = (async (_u: unknown, init?: RequestInit) => {
      seen = init;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    expect(await sendPush(s.subscription, { title: 'a', body: 'b', tag: 'weigh' }, env, ok)).toBe(
      'sent',
    );
    const h = seen!.headers as Record<string, string>;
    expect(h['content-encoding']).toBe('aes128gcm');
    expect(h.authorization).toMatch(/^vapid t=/);
    expect(h.topic).toBe('weigh');
    const gone: typeof fetch = (async () =>
      new Response(null, { status: 410 })) as unknown as typeof fetch;
    expect(await sendPush(s.subscription, { title: 'a', body: 'b' }, env, gone)).toBe('gone');
  });
});

describe('reminders', () => {
  const base: StoredSubscription = {
    subscription: { endpoint: 'e', keys: { p256dh: '', auth: '' } },
    prefs: { weighAt: '07:30', logAt: '20:00' },
    tz: 'Europe/Rome',
    updated_at: '',
  };
  // 2026-09-21 18:15 UTC = 20:15 in Rome (CEST)
  const evening = new Date('2026-09-21T18:15:00Z');
  const morning = new Date('2026-09-21T05:00:00Z'); // 07:00 Rome

  it('reads the local clock in the subscriber’s zone', () => {
    expect(localClock(evening, 'Europe/Rome')).toEqual({ date: '2026-09-21', time: '20:15' });
    expect(localClock(evening, 'America/New_York')).toEqual({ date: '2026-09-21', time: '14:15' });
  });

  it('fires once the time has passed and the thing is undone today', () => {
    expect(dueReminders(base, morning)).toEqual([]); // 07:00 < 07:30
    expect(dueReminders(base, evening)).toEqual(['weigh', 'log']);
    expect(
      dueReminders(
        { ...base, lastWeighedDate: '2026-09-21', lastLoggedDate: '2026-09-21' },
        evening,
      ),
    ).toEqual([]);
    expect(dueReminders({ ...base, lastLoggedDate: '2026-09-20' }, evening)).toEqual([
      'weigh',
      'log',
    ]);
  });

  it('sends each reminder at most once a day and respects disabled ones', () => {
    expect(dueReminders({ ...base, sent: { weigh: '2026-09-21' } }, evening)).toEqual(['log']);
    expect(dueReminders({ ...base, prefs: { weighAt: null, logAt: '20:00' } }, evening)).toEqual([
      'log',
    ]);
    expect(
      dueReminders({ ...base, sent: { weigh: '2026-09-20', log: '2026-09-21' } }, evening),
    ).toEqual(['weigh']);
  });
});

describe('nextReminderAt', () => {
  const base: StoredSubscription = {
    subscription: { endpoint: 'https://web.push.apple.com/x', keys: { p256dh: '', auth: '' } },
    prefs: { weighAt: '07:30', logAt: '20:00' },
    tz: 'Europe/Rome',
    updated_at: '',
  };
  // 2026-09-23T06:00Z is 08:00 in Rome: past the weigh time, before the evening check.
  const now = new Date('2026-09-23T06:00:00Z');

  it('says today for a window still open and tomorrow for one already satisfied', () => {
    expect(nextReminderAt({ ...base, lastWeighedDate: '2026-09-22' }, now).weigh).toBe(
      '2026-09-23 07:30',
    );
    expect(nextReminderAt({ ...base, lastWeighedDate: '2026-09-23' }, now).weigh).toBe(
      '2026-09-24 07:30',
    );
    expect(nextReminderAt({ ...base, lastLoggedDate: '2026-09-22' }, now).log).toBe(
      '2026-09-23 20:00',
    );
    expect(nextReminderAt({ ...base, lastLoggedDate: '2026-09-23' }, now).log).toBe(
      '2026-09-24 20:00',
    );
  });

  it('moves to tomorrow once today has been sent, and is null when switched off', () => {
    const sent = { ...base, lastWeighedDate: '2026-09-22', sent: { weigh: '2026-09-23' } };
    expect(nextReminderAt(sent, now).weigh).toBe('2026-09-24 07:30');
    expect(nextReminderAt({ ...base, prefs: { weighAt: null, logAt: null } }, now)).toEqual({
      weigh: null,
      log: null,
    });
  });

  it('rolls the date correctly across a month end', () => {
    const eom = new Date('2026-09-30T06:00:00Z');
    expect(nextReminderAt({ ...base, lastWeighedDate: '2026-09-30' }, eom).weigh).toBe(
      '2026-10-01 07:30',
    );
  });
});

describe('the daily cycle', () => {
  const s: StoredSubscription = {
    subscription: { endpoint: 'https://web.push.apple.com/x', keys: { p256dh: '', auth: '' } },
    prefs: { weighAt: '07:30', logAt: '20:00' },
    tz: 'Europe/Rome',
    lastWeighedDate: '2026-09-22',
    lastLoggedDate: '2026-09-22',
    updated_at: '',
  };

  it('fires the weigh-in nudge the morning after, then falls silent once weighed', () => {
    // 05:20 UTC = 07:20 Rome: before the window.
    expect(dueReminders(s, new Date('2026-09-23T05:20:00Z'))).toEqual([]);
    // 05:30 UTC = 07:30 Rome: due.
    expect(dueReminders(s, new Date('2026-09-23T05:30:00Z'))).toEqual(['weigh']);
    // Sent once, it does not repeat that day.
    const after = { ...s, sent: { weigh: '2026-09-23' } };
    expect(dueReminders(after, new Date('2026-09-23T06:30:00Z'))).toEqual([]);
    // Weighing in silences it even before it was sent.
    expect(
      dueReminders({ ...s, lastWeighedDate: '2026-09-23' }, new Date('2026-09-23T05:30:00Z')),
    ).toEqual([]);
  });

  it('fires the evening check only when nothing was logged that day', () => {
    expect(dueReminders(s, new Date('2026-09-23T18:00:00Z'))).toEqual(['weigh', 'log']);
    expect(
      dueReminders(
        { ...s, lastWeighedDate: '2026-09-23', lastLoggedDate: '2026-09-23' },
        new Date('2026-09-23T18:00:00Z'),
      ),
    ).toEqual([]);
  });
});

describe('the day’s checklist (§17 + reminders)', () => {
  const base: StoredSubscription = {
    subscription: { endpoint: 'https://web.push.apple.com/x', keys: { p256dh: '', auth: '' } },
    prefs: { weighAt: '07:30', logAt: '20:00' },
    tz: 'Europe/Rome',
    updated_at: '',
  };
  const evening = new Date('2026-09-23T18:10:00Z'); // 20:10 in Rome
  const day = (over: Partial<NonNullable<StoredSubscription['day']>>) => ({
    date: '2026-09-23',
    weighed: true,
    logged: true,
    supplements_left: 0,
    supplements_total: 3,
    water_left_ml: 0,
    ...over,
  });

  it('nudges in the evening when the creatine is still untaken, even though food was logged', () => {
    const s = { ...base, day: day({ supplements_left: 1 }) };
    expect(dueReminders(s, evening)).toEqual(['log']);
    const msg = reminderMessage('log', outstanding(s, '2026-09-23'));
    expect(msg.title).toBe('Still to do today');
    expect(msg.body).toBe('1 supplement.');
  });

  it('names everything that is left, in one sentence', () => {
    const s = { ...base, day: day({ logged: false, supplements_left: 2, water_left_ml: 1400 }) };
    expect(reminderMessage('log', outstanding(s, '2026-09-23')).body).toBe(
      'Nothing logged, 2 supplements and 1.4 L of water.',
    );
  });

  it('stays quiet once the whole checklist is done', () => {
    expect(dueReminders({ ...base, day: day({}) }, evening)).toEqual([]);
  });

  it('still nudges to weigh in when the morning is unweighed', () => {
    const s = { ...base, day: day({ weighed: false }) };
    expect(dueReminders(s, new Date('2026-09-23T05:40:00Z'))).toEqual(['weigh']);
    expect(reminderMessage('weigh').title).toBe('Weigh-in');
  });

  it('ignores a report from another day and falls back to the date markers', () => {
    const stale = {
      ...base,
      day: day({ date: '2026-09-22', logged: true }),
      lastLoggedDate: '2026-09-22',
      lastWeighedDate: '2026-09-22',
    };
    expect(dueReminders(stale, evening)).toEqual(['weigh', 'log']);
    expect(reminderMessage('log', outstanding(stale, '2026-09-23')).title).toBe(
      'Nothing logged today',
    );
  });

  it('water alone is enough to nudge', () => {
    const s = { ...base, day: day({ water_left_ml: 900 }) };
    expect(dueReminders(s, evening)).toEqual(['log']);
    expect(reminderMessage('log', outstanding(s, '2026-09-23')).body).toBe('900 ml of water.');
  });
});
