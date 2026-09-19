import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { subscribeSync, type SyncStatus } from '@/services/sync/manager';

export function useSync(): { status: SyncStatus; session: Session | null; recovery: boolean } {
  const [state, setState] = useState<{
    status: SyncStatus;
    session: Session | null;
    recovery: boolean;
  }>({ status: { state: 'off' }, session: null, recovery: false });
  useEffect(
    () => subscribeSync((status, session, recovery) => setState({ status, session, recovery })),
    [],
  );
  return state;
}
