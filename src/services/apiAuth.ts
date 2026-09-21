// The Worker's paid and state-writing endpoints (estimate, reminders) want to know who is
// asking: they accept the Supabase session token and verify it server-side (worker/guard.ts).
// Nothing here loads the Supabase client unless a session can exist at all.
import { syncConfigured } from '@/services/sync/config';

/** `Authorization` for the Worker, or `{}` when nobody is signed in. */
export async function authHeaders(): Promise<Record<string, string>> {
  if (!syncConfigured) return {};
  const m = await import('@/services/sync/supabase');
  const session = await m.getSession();
  return session ? { authorization: `Bearer ${session.access_token}` } : {};
}

export async function isSignedIn(): Promise<boolean> {
  return 'authorization' in (await authHeaders());
}
