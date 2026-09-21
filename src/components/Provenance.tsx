// SPEC §7.4 — how much of today's number is weighed, and how much of it carries vitamin data.
// One tappable line in the hero; the sheet names the entries behind the uncertainty.
import { Info } from 'lucide-react';
import { useMemo } from 'react';
import { calorieConfidence, hasAnyMicros, microCoverage } from '@/core/nutrition';
import type { LogEntry } from '@/core/types';
import { Sheet, fmt } from './ui';

function textTone(p: number): string {
  return p >= 0.85 ? 'text-ink-2' : p >= 0.6 ? 'text-kcal' : 'text-fat';
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** "92% weighed · 78% vitamins" — the figure carries the tone once it drops below 85%. */
export function ProvenanceLine({
  entries,
  onOpen,
}: {
  entries: readonly LogEntry[];
  onOpen: () => void;
}) {
  const conf = useMemo(() => calorieConfidence(entries), [entries]);
  const cov = useMemo(() => microCoverage(entries), [entries]);
  if (conf == null || cov == null) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Where today’s numbers come from"
      className="shrink-0 whitespace-nowrap text-[12px] tabular"
    >
      <span className={`font-semibold ${textTone(conf)}`}>{pct(conf)}</span> weighed
      <span className="mx-1.5 text-surface-3">·</span>
      <span className={`font-semibold ${textTone(cov)}`}>{pct(cov)}</span> vitamins
    </button>
  );
}

export function ProvenanceSheet({
  open,
  onClose,
  entries,
}: {
  open: boolean;
  onClose: () => void;
  entries: readonly LogEntry[];
}) {
  const conf = calorieConfidence(entries) ?? 0;
  const cov = microCoverage(entries) ?? 0;
  const estimates = entries.filter((e) => e.confidence !== 'high');
  const blind = entries.filter((e) => !hasAnyMicros(e.micros));
  return (
    <Sheet open={open} onClose={onClose} title="Where today’s numbers come from">
      <p className="text-[14px] leading-snug text-muted">
        <span className="font-semibold text-ink">{pct(conf)}</span> of today’s calories are weighed
        against a database, a barcode or a batch. The rest is estimated.{' '}
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
        To tighten it: weigh instead of guessing, scan packaged foods, and turn a repeated estimate
        into one of your own foods with real numbers.
      </p>
    </Sheet>
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
