// SPEC §20.1 — the running workout, visible from anywhere.
//
// This is the piece that lets one app hold both halves of the day. Mid-session you will want to
// log a protein shake, check what is left, or glance at the trend; without this bar that means
// navigating away from a workout with no way back to it except remembering where it was. With
// it, the session is always one tap away and the rest countdown keeps running in view.
//
// Modelled on the music-player bar every phone already has, for the same reason: people
// recognise it instantly and it never steals the screen.
import { ChevronUp } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { formatClock, isRestDone, restRemaining } from '@/core/restTimer';
import { isWorkingSet } from '@/core/sets';
import { elapsedSince, useActiveSession, useNow, useRestTimer } from '@/hooks/useWorkouts';

/** What the bar occupies, in px, for the surfaces that stack above it. Measured, not guessed. */
export const WORKOUT_BAR_H = 58;

/**
 * Whether the bar is on screen. Exported because the layout above it needs the same answer the
 * bar gives itself — when these two disagreed, the first-run seed banner was drawn exactly on
 * top of the bar, and on a screen with no tab bar it floated 88 px above the bottom edge.
 */
export const workoutBarShown = (hasSession: boolean, pathname: string): boolean =>
  hasSession && !pathname.startsWith('/train/session');

export function ActiveWorkoutBar({ liftedBy = 0 }: { liftedBy?: number }) {
  const session = useActiveSession();
  const rest = useRestTimer();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const now = useNow(session != null);

  // Not on the session screen itself, where all of this is already on the page.
  if (!session || !workoutBarShown(true, pathname)) return null;

  const elapsed = elapsedSince(session.started_at, now);
  let done = 0;
  let total = 0;
  for (const e of session.entries) {
    for (const s of e.sets) {
      total++;
      if (isWorkingSet(s)) done++;
    }
  }
  const resting = rest != null && !isRestDone(rest, now);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 mx-auto max-w-md px-3 pb-1 safe-bottom"
      // Sits above the tab bar where there is one, and on the bottom edge where there is not —
      // logging a shake mid-session happens on a full-screen flow with no tab bar under it.
      style={{ bottom: liftedBy }}
    >
      <button
        type="button"
        onClick={() => navigate('/train/session')}
        aria-label={`Back to ${session.name}, ${done} of ${total} sets done`}
        className="sheet-in pointer-events-auto flex w-full items-center gap-3 rounded-full bg-surface px-4 py-2.5 shadow-fab ring-1 ring-line active:scale-[0.99]"
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${resting ? 'bg-accent-2' : 'animate-pulse bg-accent'}`}
        />
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[14px] font-semibold">{session.name}</span>
          <span className="block text-[12px] text-muted tabular">
            {formatClock(elapsed)} · {done}/{total} sets
          </span>
        </span>
        {resting && (
          <span className="shrink-0 text-right">
            <span className="block text-[16px] leading-none font-bold tabular text-accent-2">
              {formatClock(restRemaining(rest, now))}
            </span>
            <span className="block text-[11px] text-muted">rest</span>
          </span>
        )}
        <ChevronUp size={18} className="shrink-0 text-muted" aria-hidden />
      </button>
    </div>
  );
}
