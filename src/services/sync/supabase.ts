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

/** Emails a sign-in link and, when the email template includes {{ .Token }}, a 6-digit code. */
export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await supabase().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
  });
  if (error) throw new Error(error.message);
}

/** Signs in with the emailed code. Works inside the installed app even when the email was
 * opened in Safari, which has its own storage. */
export async function verifyCode(email: string, code: string): Promise<void> {
  const { error } = await supabase().auth.verifyOtp({ email, token: code.trim(), type: 'email' });
  if (error) throw new Error(error.message);
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
