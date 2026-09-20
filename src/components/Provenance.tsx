// SPEC §7.4 — how much of today's number is weighed, and how much of it carries vitamin data.
// Two meters under the ring; tapping them names the entries behind the uncertainty.
import { Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { calorieConfidence, hasAnyMicros, microCoverage } from '@/core/nutrition';
import type { LogEntry } from '@/core/types';
import { Sheet, fmt } from './ui';

export function ProvenanceRow({ entries }: { entries: readonly LogEntry[] }) {
  const [open, setOpen] = useState(false);
  const conf = useMemo(() => calorieConfidence(entries), [entries]);
  const cov = useMemo(() => microCoverage(entries), [entries]);
  if (conf == null || cov == null) return null;

  const estimates = entries.filter((e) => e.confidence !== 'high');
  const blind = entries.filter((e) => !hasAnyMicros(e.micros));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Where today’s numbers come from"
        className="mt-4 grid w-full grid-cols-2 gap-3 border-t border-line pt-4 text-left"
      >
        <Meter label="Weighed" pct={conf} sub="of today’s kcal" />
        <Meter label="Vitamin data" pct={cov} sub="of today’s kcal" align="right" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Where today’s numbers come from">
        <p className="text-[14px] leading-snug text-muted">
          <span className="font-semibold text-ink">{pct(conf)}</span> of today’s calories are
          weighed against a database, a barcode or a batch. The rest is estimated.{' '}
          <span className="font-semibold text-ink">{pct(cov)}</span> carry micronutrient data — the
          vitamin verdicts only rest on that share.
        </p>

        {estimates.length > 0 && (
          <Group
            title="Estimated"
            items={estimates}
            note="typed in or guessed; counts at medium confidence"
          />
        )}
        {blind.length > 0 && (
          <Group title="No vitamin data" items={blind} note="counts for calories and macros only" />
        )}
        {estimates.length === 0 && blind.length === 0 && (
          <p className="mt-5 flex items-center gap-2 text-[14px] text-ink-2">
            <Info size={16} className="text-accent" aria-hidden />
            Every entry today is weighed and carries micronutrient data.
          </p>
        )}
        <p className="mt-5 text-[13px] leading-snug text-muted">
          To tighten it: weigh instead of guessing, scan packaged foods, and turn a repeated
          estimate into one of your own foods with real numbers.
        </p>
      </Sheet>
    </>
  );
}

function Group({ title, items, note }: { title: string; items: LogEntry[]; note: string }) {
  const kcal = items.reduce((a, e) => a + e.kcal, 0);
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <span className="text-[13px] font-semibold text-muted">{title}</span>
        <span className="text-[13px] text-muted tabular">{fmt(kcal)} kcal</span>
      </div>
      <div className="card divide-y divide-line">
        {items.map((e) => (
          <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1 truncate text-[15px]">{e.name}</span>
            <span className="shrink-0 text-[13px] text-muted tabular">{fmt(e.kcal)} kcal</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 px-1 text-[12px] text-muted">{note}</p>
    </div>
  );
}

function tone(p: number): string {
  return p >= 0.85 ? 'bg-accent' : p >= 0.6 ? 'bg-kcal' : 'bg-fat';
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function Meter({
  label,
  pct: p,
  sub,
  align = 'left',
}: {
  label: string;
  pct: number;
  sub: string;
  align?: 'left' | 'right';
}) {
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <div className="text-[12px] font-semibold text-muted">{label}</div>
      <div className="mt-0.5 text-[18px] font-bold tracking-[-0.01em] tabular">
        {pct(p)}
        <span className="ml-1 text-[12px] font-medium text-muted">{sub}</span>
      </div>
      <div
        className={`mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-2 ${align === 'right' ? 'flex justify-end' : ''}`}
      >
        <div
          className={`h-full rounded-full ${tone(p)} transition-[width] duration-700 ease-[var(--ease-out-soft)]`}
          style={{ width: `${p * 100}%` }}
        />
      </div>
    </div>
  );
}
