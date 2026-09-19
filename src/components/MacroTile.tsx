import type { LucideIcon } from 'lucide-react';
import { fmt } from './ui';

export type MacroKind = 'protein' | 'fiber' | 'carb' | 'fat';

const TONE: Record<MacroKind, { text: string; bar: string; chip: string }> = {
  protein: { text: 'text-protein', bar: 'bg-protein', chip: 'bg-protein/15' },
  fiber: { text: 'text-fiber', bar: 'bg-fiber', chip: 'bg-fiber/15' },
  carb: { text: 'text-carb', bar: 'bg-carb', chip: 'bg-carb/15' },
  fat: { text: 'text-fat', bar: 'bg-fat', chip: 'bg-fat/15' },
};

export function MacroTile({
  kind,
  label,
  icon: Icon,
  value,
  target,
}: {
  kind: MacroKind;
  label: string;
  icon: LucideIcon;
  value: number;
  target: number;
}) {
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const t = TONE[kind];
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full ${t.chip} ${t.text}`}
        >
          <Icon size={16} strokeWidth={2.4} aria-hidden />
        </span>
        <span className="text-[14px] font-semibold text-ink-2">{label}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-1 tabular">
        <span className="text-[24px] font-bold tracking-[-0.02em]">{fmt(value)}</span>
        <span className="text-[13px] text-muted">/ {fmt(target)} g</span>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${t.bar} transition-[width] duration-700 ease-[var(--ease-out-soft)]`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
