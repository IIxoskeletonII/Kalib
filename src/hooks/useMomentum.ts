// SPEC §20.15 — the streak and milestones, live. Re-reads when a session, a weigh-in or a
// setting changes, which covers finishing a workout, changing the aim and marking one seen.
import { useLiveQuery } from 'dexie-react-hooks';
import { momentum, type Momentum } from '@/services/momentum';

export function useMomentum(): Momentum | undefined {
  return useLiveQuery(() => momentum(), []);
}
