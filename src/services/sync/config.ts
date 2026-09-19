// Build-time sync configuration, kept apart from the Supabase module so the shell can check it
// without loading the client library.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const syncConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
