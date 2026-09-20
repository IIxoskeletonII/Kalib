// Supabase: auth (magic link) and the SyncRemote adapter. The anon key is a public key; row
// access is enforced by RLS (supabase/migrations/0001_init.sql).
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Row, SyncRemote, SyncTable } from './engine';

import { SUPABASE_ANON_KEY as KEY, SUPABASE_URL as URL, syncConfigured } from './config';

export { syncConfigured };

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!syncConfigured) throw new Error('Sync is not configured in this build.');
  client ??= createClient(URL!, KEY!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export async function getSession(): Promise<Session | null> {
  if (!syncConfigured) return null;
  return (await supabase().auth.getSession()).data.session;
}

/** Creates the account and signs in immediately (requires "Confirm email" off in Supabase Auth). */
export async function signUpWithPassword(email: string, password: string): Promise<void> {
  const { data, error } = await supabase().auth.signUp({ email, password });
  if (error) throw new Error(friendlyAuthError(error.message));
  if (!data.session) {
    throw new Error(
      'Account created, but email confirmation is switched on in Supabase. Turn off "Confirm email" under Authentication → Providers → Email, then sign in.',
    );
  }
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyAuthError(error.message));
}

/** Sends the reset link through Supabase's built-in mailer (rate-limited, but no SMTP setup). */
export async function sendPasswordReset(email: string): Promise<void> {
  // The site root is always an allowed redirect; the app shows the reset screen wherever it lands.
  const { error } = await supabase().auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw new Error(friendlyAuthError(error.message));
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase().auth.updateUser({ password });
  if (error) throw new Error(friendlyAuthError(error.message));
}

function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password.';
  if (/user already registered/i.test(message))
    return 'That email already has an account — sign in instead.';
  if (/password should be at least/i.test(message)) return 'Use at least 8 characters.';
  if (/email not confirmed/i.test(message)) {
    return 'Email confirmation is switched on in Supabase. Turn off "Confirm email" under Authentication → Providers → Email.';
  }
  return message;
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
}

/** Postgres returns `+00:00` timestamps; the local store compares ISO strings, so normalise. */
const TIMESTAMPS = ['created_at', 'updated_at', 'deleted_at', 'logged_at'];
function normalize(row: Record<string, unknown>): Row {
  const out: Record<string, unknown> = { ...row };
  for (const k of TIMESTAMPS) {
    const v = out[k];
    if (typeof v === 'string') out[k] = new Date(v).toISOString();
  }
  // Optional columns come back as null; the local rows leave them undefined.
  for (const k of Object.keys(out)) if (out[k] === null && k !== 'deleted_at') delete out[k];
  return out as Row;
}

function conflictKey(table: SyncTable): string {
  return table === 'settings' ? 'user_id,key' : 'id';
}

export function supabaseRemote(userId: string): SyncRemote {
  const sb = supabase();
  return {
    userId,
    async push(table, rows) {
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await sb
          .from(table)
          .upsert(rows.slice(i, i + 200), { onConflict: conflictKey(table) });
        if (error) throw new Error(`${table}: ${error.message}`);
      }
    },
    async pull(table, since) {
      const out: Row[] = [];
      let cursor = since;
      for (;;) {
        let q = sb.from(table).select('*').order('updated_at', { ascending: true }).limit(500);
        if (cursor) q = q.gt('updated_at', cursor);
        const { data, error } = await q;
        if (error) throw new Error(`${table}: ${error.message}`);
        const page = (data ?? []).map(normalize);
        out.push(...page);
        if (page.length < 500) break;
        cursor = page[page.length - 1]!.updated_at;
      }
      return out;
    },
  };
}
