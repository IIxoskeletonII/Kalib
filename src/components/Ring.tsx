import { useEffect, useState, type ReactNode } from 'react';

/**
 * Progress ring with a gradient stroke and a soft glow. Animates from empty on mount and eases
 * on every change. Over-target is drawn as a thin second arc rather than by recolouring.
 */
export function Ring({
  value,
  target,
  size = 180,
  stroke = 12,
  children,
}: {
  value: number;
  target: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = target > 0 ? value / target : 0;
  const main = Math.min(1, Math.max(0, frac));
  const over = Math.min(1, Math.max(0, frac - 1));
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const shown = mounted ? main : 0;
  const shownOver = mounted ? over : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <defs>
          <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          style={{
            filter: 'var(--glow)',
            transition: 'stroke-dashoffset 900ms var(--ease-out-soft)',
          }}
        />
        {over > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - shownOver)}
            style={{ transition: 'stroke-dashoffset 900ms var(--ease-out-soft)' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
