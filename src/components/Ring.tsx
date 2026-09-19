import type { ReactNode } from 'react';

/**
 * Progress ring. Over-target is drawn as a thin second arc on top rather than by recolouring
 * the ring (colour carries identity, not judgement — MASTER.md).
 */
export function Ring({
  value,
  target,
  size = 132,
  stroke = 11,
  color = 'var(--kcal)',
  children,
}: {
  value: number;
  target: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = target > 0 ? value / target : 0;
  const main = Math.min(1, Math.max(0, frac));
  const over = Math.min(1, Math.max(0, frac - 1));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
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
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - main)}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
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
            strokeDashoffset={c * (1 - over)}
            className="transition-[stroke-dashoffset] duration-500 ease-out"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
