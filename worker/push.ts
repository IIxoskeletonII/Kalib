// Web Push from the Worker: RFC 8291 (aes128gcm payload encryption) and RFC 8292 (VAPID) with
// WebCrypto only — no Node, no library. Reminders (§ Retention) are sent from the cron.

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface ReminderPrefs {
  /** "HH:MM" local, or null to disable. */
  weighAt: string | null;
  logAt: string | null;
}

export interface StoredSubscription {
  subscription: PushSubscriptionJson;
  prefs: ReminderPrefs;
  /** IANA time zone, e.g. "Europe/Rome". */
  tz: string;
  lastLoggedDate?: string;
  lastWeighedDate?: string;
  /** Local date each reminder was last sent, so it fires once a day. */
  sent?: { weigh?: string; log?: string };
  /** Supabase user the subscription belongs to (records from before auth was required lack it). */
  user_id?: string;
  updated_at: string;
}

export interface PushEnv {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

// ---- base64url helpers ----

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const te = new TextEncoder();

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ---- RFC 8291: encrypt a payload for a subscription ----

export async function encryptPayload(
  sub: PushSubscriptionJson,
  payload: string,
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.keys.p256dh); // 65 bytes, uncompressed point
  const auth = b64urlDecode(sub.keys.auth); // 16 bytes
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer,
  );
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  // Workers' type for deriveBits lacks the ECDH `public` member; the runtime supports it.
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaKey } as unknown as Parameters<SubtleCrypto['deriveBits']>[0],
      local.privateKey,
      256,
    ),
  );
  const prk = await hkdf(
    auth,
    shared,
    concat(te.encode('WebPush: info\0'), uaPublic, asPublic),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, prk, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, te.encode('Content-Encoding: nonce\0'), 12);
  const plain = concat(te.encode(payload), new Uint8Array([2])); // 0x02 = last record delimiter
  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, [
    'encrypt',
  ]);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      aesKey,
      plain as BufferSource,
    ),
  );
  // Header: salt(16) | rs(4) | idlen(1) | keyid(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const header = concat(salt, rs, new Uint8Array([asPublic.length]), asPublic);
  return concat(header, cipher);
}

// ---- RFC 8292: VAPID ----

async function importVapidPrivate(env: PushEnv): Promise<CryptoKey> {
  const pub = b64urlDecode(env.VAPID_PUBLIC_KEY!);
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    d: env.VAPID_PRIVATE_KEY!,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
}

export async function vapidAuthorization(endpoint: string, env: PushEnv): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    te.encode(
      JSON.stringify({
        aud,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: env.VAPID_SUBJECT ?? 'mailto:hello@example.com',
      }),
    ),
  );
  const key = await importVapidPrivate(env);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    te.encode(`${header}.${claims}`),
  );
  return `vapid t=${header}.${claims}.${b64urlEncode(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export type PushOutcome = 'sent' | 'gone' | 'failed';
export interface PushResult {
  outcome: PushOutcome;
  /** The push service's HTTP status and the start of its body, for diagnostics. */
  status: number;
  detail: string;
}

/** Sends one notification; 'gone' means the subscription is dead and should be dropped. */
export async function sendPush(
  sub: PushSubscriptionJson,
  msg: PushMessage,
  env: PushEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<PushOutcome> {
  return (await sendPushDetailed(sub, msg, env, fetchImpl)).outcome;
}

export async function sendPushDetailed(
  sub: PushSubscriptionJson,
  msg: PushMessage,
  env: PushEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  const body = await encryptPayload(sub, JSON.stringify(msg));
  let res: Response;
  try {
    res = await fetchImpl(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidAuthorization(sub.endpoint, env),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: '3600',
        urgency: 'normal',
        ...(msg.tag ? { topic: msg.tag } : {}),
      },
      body: body as BodyInit,
    });
  } catch (err) {
    return { outcome: 'failed', status: 0, detail: (err as Error).message };
  }
  const detail = (await res.text().catch(() => '')).slice(0, 200);
  if (res.status === 404 || res.status === 410)
    return { outcome: 'gone', status: res.status, detail };
  return { outcome: res.ok ? 'sent' : 'failed', status: res.status, detail };
}

// ---- reminder logic (pure) ----

/** Local "YYYY-MM-DD" and "HH:MM" for `tz` at `now`. */
export function localClock(now: Date, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
}

export type ReminderKind = 'weigh' | 'log';

/**
 * Which reminders are due for a subscription right now: the local time has passed the
 * preferred time, the thing has not been done today, and nothing was sent today.
 */
export function dueReminders(s: StoredSubscription, now: Date): ReminderKind[] {
  const { date, time } = localClock(now, s.tz || 'UTC');
  const due: ReminderKind[] = [];
  const passed = (at: string | null) => at != null && time >= at;
  if (passed(s.prefs.weighAt) && (s.lastWeighedDate ?? '') < date && s.sent?.weigh !== date) {
    due.push('weigh');
  }
  if (passed(s.prefs.logAt) && (s.lastLoggedDate ?? '') < date && s.sent?.log !== date) {
    due.push('log');
  }
  return due;
}

export function reminderMessage(kind: ReminderKind): PushMessage {
  return kind === 'weigh'
    ? {
        title: 'Weigh-in',
        body: 'Step on the scale — it takes five seconds.',
        url: '/',
        tag: 'weigh',
      }
    : {
        title: 'Nothing logged today',
        body: 'Even a rough day beats a missing one.',
        url: '/',
        tag: 'log',
      };
}
