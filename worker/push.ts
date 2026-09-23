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

/** What the phone last told us about the day it is having. */
export interface DayState {
  /** The phone's local date these figures describe. */
  date: string;
  weighed: boolean;
  logged: boolean;
  /** Supplements still to take, and how many there are in total. */
  supplements_left: number;
  supplements_total: number;
  /** Millilitres still to drink against the day's target (0 when there is no target). */
  water_left_ml: number;
}

export interface StoredSubscription {
  subscription: PushSubscriptionJson;
  prefs: ReminderPrefs;
  /** IANA time zone, e.g. "Europe/Rome". */
  tz: string;
  lastLoggedDate?: string;
  lastWeighedDate?: string;
  /** The checklist as of the phone's last word on it (§17 water and supplements). */
  day?: DayState;
  /** The last send that did not arrive, so a silent failure has somewhere to be seen. */
  last_error?: { at: string; kind: ReminderKind; status: number; detail: string };
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
/** The day's checklist as the server understands it, ignoring anything stale. */
export function outstanding(
  s: StoredSubscription,
  date: string,
): {
  weigh: boolean;
  log: boolean;
  supplements: number;
  water_ml: number;
  any: boolean;
} {
  const day = s.day?.date === date ? s.day : undefined;
  // Without a fresh day report, fall back to the two date markers the phone has always sent.
  const weigh = day ? !day.weighed : (s.lastWeighedDate ?? '') < date;
  const log = day ? !day.logged : (s.lastLoggedDate ?? '') < date;
  const supplements = day?.supplements_left ?? 0;
  const water_ml = day?.water_left_ml ?? 0;
  return { weigh, log, supplements, water_ml, any: log || supplements > 0 || water_ml > 0 };
}

/**
 * The morning nudge fires when the day has not been weighed; the evening one when anything on
 * the day's checklist is still undone — food, supplements or water (§17), not only food.
 */
export function dueReminders(s: StoredSubscription, now: Date): ReminderKind[] {
  const { date, time } = localClock(now, s.tz || 'UTC');
  const left = outstanding(s, date);
  const due: ReminderKind[] = [];
  const passed = (at: string | null) => at != null && time >= at;
  if (passed(s.prefs.weighAt) && left.weigh && s.sent?.weigh !== date) due.push('weigh');
  if (passed(s.prefs.logAt) && left.any && s.sent?.log !== date) due.push('log');
  return due;
}

/**
 * When each reminder will next be considered, in the subscriber's own clock. A reminder that
 * is due right now reads as today; one whose day is already done (or whose time has passed)
 * moves to tomorrow. This is what the app shows so the feature is never invisible.
 */
export function nextReminderAt(
  s: StoredSubscription,
  now: Date,
): { weigh: string | null; log: string | null } {
  const { date } = localClock(now, s.tz || 'UTC');
  const tomorrow = addLocalDay(date);
  const left = outstanding(s, date);
  const when = (at: string | null, outstandingNow: boolean, sentOn: string | undefined) => {
    if (!at) return null;
    if (outstandingNow && sentOn !== date) return `${date} ${at}`;
    return `${tomorrow} ${at}`;
  };
  return {
    weigh: when(s.prefs.weighAt, left.weigh, s.sent?.weigh),
    log: when(s.prefs.logAt, left.any, s.sent?.log),
  };
}

/** Next calendar day for a local YYYY-MM-DD, without touching time zones. */
export function addLocalDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

/** Plain English for what is left, longest-standing first: "2 vitamins and 1.4 L of water". */
export function outstandingText(left: ReturnType<typeof outstanding>): string {
  const parts: string[] = [];
  if (left.log) parts.push('nothing logged');
  if (left.supplements > 0) {
    parts.push(`${left.supplements} ${left.supplements === 1 ? 'supplement' : 'supplements'}`);
  }
  if (left.water_ml > 0) {
    const l = left.water_ml / 1000;
    parts.push(`${l >= 1 ? `${l.toFixed(1)} L` : `${Math.round(left.water_ml)} ml`} of water`);
  }
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`;
}

export function reminderMessage(
  kind: ReminderKind,
  left?: ReturnType<typeof outstanding>,
): PushMessage {
  if (kind === 'weigh') {
    return {
      title: 'Weigh-in',
      body: 'Step on the scale — it takes five seconds.',
      url: '/',
      tag: 'weigh',
    };
  }
  const text = left ? outstandingText(left) : '';
  if (!text || (left && left.log && left.supplements === 0 && left.water_ml === 0)) {
    return {
      title: 'Nothing logged today',
      body: 'Even a rough day beats a missing one.',
      url: '/',
      tag: 'log',
    };
  }
  return {
    title: 'Still to do today',
    body: `${text.charAt(0).toUpperCase()}${text.slice(1)}.`,
    url: '/',
    tag: 'log',
  };
}
