// Swipe-to-act on list rows, the iOS way: swipe left reveals Delete (a full swipe commits),
// swipe right reveals one contextual action. Vertical scrolling is untouched (touch-action:
// pan-y); one row is open at a time; taps on the content close an open row.
import { Trash2, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface SwipeAction {
  label: string;
  icon: LucideIcon;
  onAction: () => void;
  /** Colour of the revealed pane. */
  tone?: 'accent' | 'danger';
}

const REVEAL = 84; // px of pane revealed on a partial swipe
const COMMIT = 0.5; // share of row width for a full swipe
let closeOpen: (() => void) | null = null;

export function SwipeRow({
  children,
  onDelete,
  leading,
  className = '',
  deleteLabel = 'Delete',
}: {
  children: ReactNode;
  /** Trailing (swipe-left) destructive action. */
  onDelete?: (() => void) | undefined;
  /** Leading (swipe-right) action. */
  leading?: SwipeAction | undefined;
  className?: string;
  deleteLabel?: string;
}) {
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const start = useRef<{ x: number; y: number; id: number; captured: boolean } | null>(null);
  const open = useRef(0);
  /** Undamped travel; the commit decision reads this, the transform shows the damped value. */
  const raw = useRef(0);
  const ref = useRef<HTMLDivElement>(null);

  const settle = (to: number) => {
    setAnimating(true);
    setDx(to);
    open.current = to;
    if (to !== 0) {
      closeOpen?.();
      closeOpen = () => {
        setAnimating(true);
        setDx(0);
        open.current = 0;
        closeOpen = null;
      };
    }
  };

  useEffect(
    () => () => {
      if (open.current !== 0) closeOpen = null;
    },
    [],
  );

  const commitDelete = () => {
    if (!onDelete) return;
    setLeaving(true);
    setAnimating(true);
    setDx(-(ref.current?.offsetWidth ?? 400));
    window.setTimeout(onDelete, 180);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, captured: false };
    setAnimating(false);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (!s.captured) {
      if (Math.abs(mx) < 10 || Math.abs(mx) < Math.abs(my) * 1.2) return;
      s.captured = true;
      (e.currentTarget as HTMLElement).setPointerCapture(s.id);
    }
    let next = open.current + mx;
    if (next < 0 && !onDelete) next = 0;
    if (next > 0 && !leading) next = 0;
    raw.current = next;
    // Rubber-band the displayed travel past the reveal width.
    const limit = REVEAL * 1.6;
    if (Math.abs(next) > limit) next = Math.sign(next) * (limit + (Math.abs(next) - limit) * 0.35);
    setDx(next);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (!s.captured) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(s.id);
    const width = ref.current?.offsetWidth ?? 400;
    const travel = raw.current;
    raw.current = 0;
    if (travel <= -width * COMMIT && onDelete) {
      commitDelete();
      return;
    }
    if (travel >= width * COMMIT && leading) {
      settle(0);
      leading.onAction();
      return;
    }
    if (travel < -REVEAL / 2) settle(-REVEAL);
    else if (travel > REVEAL / 2) settle(REVEAL);
    else settle(0);
  };

  const onClickCapture = (e: React.MouseEvent) => {
    // A tap while open closes the row instead of activating the content.
    if (open.current !== 0 && !(e.target as HTMLElement).closest('[data-swipe-action]')) {
      e.stopPropagation();
      e.preventDefault();
      settle(0);
    }
  };

  const leadTone = leading?.tone === 'danger' ? 'bg-danger' : 'bg-accent';
  return (
    <div
      ref={ref}
      className={`relative overflow-hidden ${leaving ? 'max-h-0 transition-[max-height] duration-200' : ''} ${className}`}
      style={leaving ? { maxHeight: 0 } : undefined}
    >
      {leading && (
        <button
          type="button"
          data-swipe-action
          onClick={() => {
            settle(0);
            leading.onAction();
          }}
          className={`absolute inset-y-0 left-0 flex w-[84px] flex-col items-center justify-center gap-1 text-[11px] font-semibold text-on-accent ${leadTone}`}
          style={{ opacity: dx > 0 ? 1 : 0 }}
          tabIndex={dx > 0 ? 0 : -1}
        >
          <leading.icon size={20} strokeWidth={2.2} aria-hidden />
          {leading.label}
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          data-swipe-action
          onClick={commitDelete}
          className="absolute inset-y-0 right-0 flex w-[84px] flex-col items-center justify-center gap-1 bg-danger text-[11px] font-semibold text-white"
          style={{ opacity: dx < 0 ? 1 : 0 }}
          tabIndex={dx < 0 ? 0 : -1}
        >
          <Trash2 size={20} strokeWidth={2.2} aria-hidden />
          {deleteLabel}
        </button>
      )}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        className={`relative bg-surface ${animating ? 'transition-transform duration-300 ease-[var(--ease-spring)]' : ''}`}
        style={{ transform: `translateX(${dx}px)`, touchAction: 'pan-y' }}
      >
        {children}
      </div>
    </div>
  );
}
