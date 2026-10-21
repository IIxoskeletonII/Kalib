// SPEC §20.3 — the rest countdown.
//
// The number here is recomputed from an absolute end instant on every repaint, never counted
// down (core/restTimer.ts). That is what makes it correct after the screen has been locked for
// the whole rest, which is the normal case: you put the phone down, you lift, you pick it up.
import { Minus, Plus, X } from 'lucide-react';
import { adjustRest, formatClock, isRestDone, restProgress, restRemaining } from '@/core/restTimer';
import { useNow, useRestTimer } from '@/hooks/useWorkouts';
import { clearRestTimer, setRestTimer } from '@/services/workouts';

export function RestBar() {
  const timer = useRestTimer();
  // Twice a second, so the seconds never look stuck between ticks.
  const now = useNow(timer != null, 500);
  if (!timer || isRestDone(timer, now)) return null;

  const left = restRemaining(timer, now);
  const pct = restProgress(timer, now);

  return (
    <div className="rise-in mt-3 overflow-hidden rounded-[20px] bg-surface">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          aria-label="Fifteen seconds less rest"
          // The instant of the press, not the last repaint's: a stale clock up to half a second
          // old could leave a rest ended by hand looking like one that ran out (§20.14).
          onClick={() => void setRestTimer(adjustRest(timer, -15, new Date()))}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-2 active:scale-95"
        >
          <Minus size={17} strokeWidth={2.6} aria-hidden />
        </button>

        <div className="flex-1 text-center">
          <div className="text-[22px] leading-none font-bold tabular tracking-[-0.02em]">
            {formatClock(left)}
          </div>
          <div className="text-[12px] text-muted">resting</div>
        </div>

        <button
          type="button"
          aria-label="Fifteen seconds more rest"
          onClick={() => void setRestTimer(adjustRest(timer, 15, new Date()))}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-2 active:scale-95"
        >
          <Plus size={17} strokeWidth={2.6} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Skip rest"
          onClick={() => void clearRestTimer()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-muted active:scale-95"
        >
          <X size={16} strokeWidth={2.6} aria-hidden />
        </button>
      </div>
      <div className="h-1 w-full bg-surface-2">
        <div
          className="h-full bg-accent transition-[width] duration-500 ease-[var(--ease-out-soft)]"
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
