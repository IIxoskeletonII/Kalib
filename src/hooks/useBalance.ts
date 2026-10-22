// SPEC §20.18 — the routines' balance, live. Re-reads when a routine or the library changes,
// which covers applying a fix, its undo, and editing a routine by hand.
import { useLiveQuery } from 'dexie-react-hooks';
import type { BalanceReport } from '@/core/balance';
import { balance, routineBalance, type Balance } from '@/services/balance';

export function useBalance(): Balance | undefined {
  return useLiveQuery(() => balance(), []);
}

/** One routine on its own. `null` once read and found missing. */
export function useRoutineBalance(
  routine_id: string | undefined,
): BalanceReport | null | undefined {
  return useLiveQuery(
    async () => (routine_id ? ((await routineBalance(routine_id)) ?? null) : null),
    [routine_id],
  );
}
