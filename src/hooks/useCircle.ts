// SPEC §21 — the circle, for the screen. Two kinds of read: the server's (circles, the board),
// fetched when asked and when the account changes; and the phone's own (settings, this week's
// numbers), live from Dexie like every other hook here.
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useState } from 'react';
import type { BoardRow, CircleWeek } from '@/core/circle';
import { useSync } from '@/hooks/useSync';
import {
  circle,
  CircleError,
  getCircleSettings,
  myWeeks,
  type CircleSettings,
  type CircleSummary,
} from '@/services/circle';
import { syncConfigured } from '@/services/sync/config';

export type CirclesState =
  | { kind: 'unconfigured' }
  | { kind: 'signed-out' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; circles: CircleSummary[] };

/** The circles you are in. Publishes your weeks on the way, so the board you see includes them. */
export function useCircles(): { state: CirclesState; reload: () => Promise<void> } {
  const { session } = useSync();
  const signedIn = session != null;
  const [state, setState] = useState<CirclesState>(
    !syncConfigured
      ? { kind: 'unconfigured' }
      : signedIn
        ? { kind: 'loading' }
        : { kind: 'signed-out' },
  );

  const reload = useCallback(async () => {
    if (!syncConfigured) return setState({ kind: 'unconfigured' });
    if (!signedIn) return setState({ kind: 'signed-out' });
    try {
      const circles = await circle.mine();
      if (circles.length > 0) {
        // A board without your own latest week on it would be wrong about you of all people.
        await circle.publish().catch(() => 0);
      }
      setState({ kind: 'ready', circles });
    } catch (err) {
      const e = err instanceof CircleError ? err : new CircleError('unknown', String(err));
      setState(
        e.kind === 'signed-out' ? { kind: 'signed-out' } : { kind: 'error', message: e.message },
      );
    }
  }, [signedIn]);

  useEffect(() => {
    let live = true;
    // Deferred a tick so the effect does not set state synchronously while rendering.
    void Promise.resolve().then(() => {
      if (live) void reload();
    });
    return () => {
      live = false;
    };
  }, [reload]);

  return { state, reload };
}

export type BoardState =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; rows: BoardRow[] };

export function useBoard(circleId: string | undefined, version = 0): BoardState {
  const [state, setState] = useState<{ id?: string; v: number; s: BoardState }>({
    v: -1,
    s: { kind: 'loading' },
  });
  useEffect(() => {
    if (!circleId) return;
    let live = true;
    void circle
      .board(circleId)
      .then((rows) => live && setState({ id: circleId, v: version, s: { kind: 'ready', rows } }))
      .catch(
        (err: unknown) =>
          live &&
          setState({
            id: circleId,
            v: version,
            s: { kind: 'error', message: err instanceof Error ? err.message : String(err) },
          }),
      );
    return () => {
      live = false;
    };
  }, [circleId, version]);
  // A board for another circle, or from before a reload, is not this one.
  return state.id === circleId && state.v === version ? state.s : { kind: 'loading' };
}

export function useCircleSettings(): CircleSettings | undefined {
  return useLiveQuery(() => getCircleSettings(), []);
}

/** Your weeks as they would be published, recomputed as you train. */
export function useMyWeeks(): CircleWeek[] | undefined {
  return useLiveQuery(() => myWeeks(), []);
}
