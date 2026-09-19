import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { subscribeSync, type SyncStatus } from '@/services/sync/manager';

export function useSync(): { status: SyncStatus; session: Session | null } {
  const [state, setState] = useState<{ status: SyncStatus; session: Session | null }>({
    status: { state: 'off' },
    session: null,
  });
  useEffect(() => subscribeSync((status, session) => setState({ status, session })), []);
  return state;
}
