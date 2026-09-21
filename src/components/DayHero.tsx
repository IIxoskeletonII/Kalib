// The numbers on Today, set directly on the page: what is left, a budget bar, the four
// macros, and one line each for where the target comes from and how much is weighed (§7.4).
import { Beef, Droplets, Leaf, Wheat, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { ScaledFood } from '@/core/nutrition';
import type { DailyTarget, LogEntry } from '@/core/types';
import { ProvenanceLine, ProvenanceSheet } from './Provenance';
import { RollingNumber } from './RollingNumber';
import { fmt } from './ui';

type MacroKind = 'protein' | 'fiber' | 'carb' | 'fat';
const MACROS: { kind: MacroKind; label: string; icon: LucideIcon; text: string; bar: string }[] = [
  { kind: 'protein', label: 'Protein', icon: Beef, text: 'text-protein', bar: 'bg-protein' },
  { kind: 'fiber', label: 'Fiber', icon: Leaf, text: 'text-fiber', bar: 'bg-fiber' },
  { kind: 'carb', label: 'Carbs', icon: Wheat, text: 'text-carb', bar: 'bg-carb' },
  { kind: 'fat', label: 'Fat', icon: Droplets, text: 'text-fat', bar: 'bg-fat' },
];
const VALUE: Record<MacroKind, (t: ScaledFood) => number> = {
  protein: (t) => t.protein_g,
  fiber: (t) => t.fiber_g,
  carb: (t) => t.carb_g,
  fat: (t) => t.fat_g,
};
const TARGET: Record<MacroKind, (t: DailyTarget) => number> = {
  protein: (t) => t.protein_g,
  fiber: (t) => t.fiber_g,
  carb: (t) => t.carb_g,
  fat: (t) => t.fat_g,
};

export function DayHero({
  totals,
  target,
  dayTarget,
  bankShift,
  note,
  entries,
}: {
  totals: ScaledFood;
  target: DailyTarget;
  /** The banked target the budget runs on (§5). */
  dayTarget: number;
  bankShift: number;
  /** Where the target comes from (formula / measured / calibration state). */
  note: string;
  entries: readonly LogEntry[];
}) {
  const remaining = dayTarget - totals.kcal;
  const over = remaining < 0;
  const pct = Math.min(1, totals.kcal / Math.max(1, dayTarget));
  const [provOpen, setProvOpen] = useState(false);

  return (
    <section aria-label="Today’s numbers" className="px-1">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[13px] font-semibold text-muted">
            {over ? 'Over today' : 'Left today'}
          </div>
          <div className="display mt-0.5 flex items-baseline">
            <RollingNumber value={Math.abs(remaining)} />
            <span className="ml-1.5 text-[18px] font-medium text-muted">kcal</span>
          </div>
        </div>
        <div className="pb-1.5 text-right text-[13px] leading-snug text-muted tabular">
          <span className="block">
            Eaten <span className="font-semibold text-ink-2">{fmt(totals.kcal)}</span>
          </span>
          <span className="block">
            Target <span className="font-semibold text-ink-2">{fmt(dayTarget)}</span>
            {bankShift !== 0 && (
              <span className={bankShift > 0 ? 'text-fiber' : 'text-fat'}>
                {' '}
                {bankShift > 0 ? '+' : ''}
                {fmt(bankShift)}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="mt-3.5 h-[6px] w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out-soft)] ${
            over ? 'bg-ink' : 'bg-[linear-gradient(90deg,var(--accent),var(--accent-2))]'
          }`}
          style={{ width: `${pct * 100}%`, filter: over ? undefined : 'var(--glow)' }}
        />
      </div>

      <div className="mt-5 grid grid-cols-4 gap-3">
        {MACROS.map((m) => (
          <MacroColumn
            key={m.kind}
            m={m}
            value={VALUE[m.kind](totals)}
            target={TARGET[m.kind](target)}
          />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-[12px] text-muted">
        <span className="truncate">{note}</span>
        {entries.length > 0 && (
          <ProvenanceLine entries={entries} onOpen={() => setProvOpen(true)} />
        )}
      </div>
      <ProvenanceSheet open={provOpen} onClose={() => setProvOpen(false)} entries={entries} />
    </section>
  );
}

function MacroColumn({
  m,
  value,
  target,
}: {
  m: (typeof MACROS)[number];
  value: number;
  target: number;
}) {
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  return (
    <div>
      <div className={`flex items-center gap-1 text-[12px] font-semibold ${m.text}`}>
        <m.icon size={12} strokeWidth={2.4} aria-hidden />
        {m.label}
      </div>
      <div className="mt-1 text-[16px] font-bold tabular">
        {fmt(value)}
        <span className="text-[11px] font-medium text-muted"> / {fmt(target)}</span>
      </div>
      <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${m.bar} transition-[width] duration-700 ease-[var(--ease-out-soft)]`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
