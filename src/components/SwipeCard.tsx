// One card of a deck: drag right to accept, left to decline, with the stamps fading in, or
// use the two buttons underneath. The pointer mechanics match SwipeRow (capture only once
// the gesture is clearly horizontal, prevent Safari's scroll takeover, treat a cancel as a
// release), which is what makes it work on iOS as well as with a mouse.
import { Check, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

const COMMIT_PX = 100;

export function SwipeCard({
  id,
  children,
  onCommit,
  yesLabel,
  noLabel,
  yesStamp,
  noStamp,
  busy = false,
  className = '',
}: {
  /** The card's identity; callers also pass it as `key` so the next card starts fresh. */
  id: string;
  children: ReactNode;
  onCommit: (dir: 'left' | 'right') => void;
  yesLabel: string;
  noLabel: string;
  yesStamp: string;
  noStamp: string;
  /** Accepting is in progress: keep the card off screen and the buttons quiet. */
  busy?: boolean;
  className?: string;
}) {
  const [dx, setDx] = useState(0);
  const [flying, setFlying] = useState<'left' | 'right' | null>(null);
  const start = useRef<{ x: number; y: number; id: number; captured: boolean } | null>(null);
  const travel = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // React registers touch listeners as passive; Safari needs this one not to be.
    const el = cardRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (start.current?.captured) e.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, [id]);

  const commit = (dir: 'left' | 'right') => {
    if (flying || busy) return;
    setFlying(dir);
    window.setTimeout(() => onCommit(dir), 220);
  };

  const finish = () => {
    const st = start.current;
    start.current = null;
    const t = travel.current;
    travel.current = 0;
    if (st?.captured && t > COMMIT_PX) commit('right');
    else if (st?.captured && t < -COMMIT_PX) commit('left');
    else setDx(0);
  };

  const rot = dx / 18;
  const x = flying === 'right' || busy ? 600 : flying === 'left' ? -600 : dx;
  const yesOpacity = Math.min(1, Math.max(0, dx / 90));
  const noOpacity = Math.min(1, Math.max(0, -dx / 90));

  return (
    <>
      <div className="relative select-none">
        <div
          key={id}
          ref={cardRef}
          className={`card rise-in relative p-5 ${flying || busy || dx === 0 ? 'transition-transform duration-300 ease-[var(--ease-spring)]' : ''} ${className}`}
          style={{ transform: `translateX(${x}px) rotate(${rot}deg)`, touchAction: 'pan-y' }}
          onPointerDown={(e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if (busy) return;
            start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, captured: false };
            travel.current = 0;
          }}
          onPointerMove={(e) => {
            const st = start.current;
            if (!st) return;
            const mx = e.clientX - st.x;
            const my = e.clientY - st.y;
            if (!st.captured) {
              if (Math.abs(mx) < 8 || Math.abs(mx) < Math.abs(my) * 1.2) return;
              st.captured = true;
              try {
                (e.currentTarget as HTMLElement).setPointerCapture(st.id);
              } catch {
                /* a pointer that is already gone cannot be captured */
              }
            }
            travel.current = mx;
            setDx(mx);
          }}
          onPointerUp={(e) => {
            const st = start.current;
            if (st?.captured) {
              try {
                (e.currentTarget as HTMLElement).releasePointerCapture(st.id);
              } catch {
                /* already released */
              }
            }
            finish();
          }}
          onPointerCancel={finish}
        >
          <span
            className="absolute top-4 left-4 rounded-full bg-accent px-3 py-1 text-[12px] font-bold text-on-accent"
            style={{ opacity: yesOpacity }}
          >
            {yesStamp}
          </span>
          <span
            className="absolute top-4 right-4 rounded-full bg-surface-3 px-3 py-1 text-[12px] font-bold text-ink-2"
            style={{ opacity: noOpacity }}
          >
            {noStamp}
          </span>
          {children}
        </div>
      </div>
      <div className="mt-4 flex justify-center gap-6">
        <button
          type="button"
          aria-label={noLabel}
          disabled={busy}
          onClick={() => commit('left')}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-ink-2 shadow-card transition-transform duration-200 active:scale-90 disabled:opacity-50"
        >
          <X size={24} strokeWidth={2.4} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={yesLabel}
          disabled={busy}
          onClick={() => commit('right')}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-card transition-transform duration-200 active:scale-90 disabled:opacity-50"
        >
          <Check size={24} strokeWidth={2.4} aria-hidden />
        </button>
      </div>
    </>
  );
}
