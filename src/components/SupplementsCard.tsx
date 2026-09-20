// SPEC §17.2 — the day's supplement checklist. Tap = taken, tap again = untaken.
import { Check, Pill } from 'lucide-react';
import { Link } from 'react-router';
import { TIMING_LABEL, formatDose } from '@/core/supplements';
import type { Supplement } from '@/core/types';
import { useSupplements, useTakenSupplements } from '@/hooks/useData';
import { setTaken } from '@/services/supplements';
import { SectionHeading } from './ui';

export function SupplementsCard({ date }: { date: string }) {
  const supplements = useSupplements();
  const taken = useTakenSupplements(date);
  if (!supplements || !taken) return null;

  if (supplements.length === 0) {
    return (
      <Link
        to="/supplements"
        className="card mt-3 flex items-center gap-3.5 px-4 py-3.5 transition-transform duration-200 ease-[var(--ease-out-soft)] active:scale-[0.985]"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
          <Pill size={18} strokeWidth={2.2} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-medium">Add supplements</span>
          <span className="block text-[13px] text-muted">
            Creatine, vitamins, minerals — with a dose worked out for you.
          </span>
        </span>
        <Chevron />
      </Link>
    );
  }

  const count = supplements.filter((s) => taken.has(s.id)).length;
  const all = count === supplements.length;

  return (
    <section className="mt-7" aria-label="Supplements">
      <SectionHeading
        trailing={
          <Link to="/supplements" className="text-accent">
            {all ? 'All taken' : `${count} of ${supplements.length}`}
          </Link>
        }
      >
        Supplements
      </SectionHeading>
      <div className="card divide-y divide-line">
        {supplements.map((s) => (
          <SupplementRow
            key={s.id}
            s={s}
            taken={taken.has(s.id)}
            onToggle={() => void setTaken(s, date, !taken.has(s.id))}
          />
        ))}
      </div>
    </section>
  );
}

function SupplementRow({
  s,
  taken,
  onToggle,
}: {
  s: Supplement;
  taken: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={taken}
      onClick={onToggle}
      className="flex min-h-16 w-full items-center gap-3.5 px-4 py-3 text-left transition-colors duration-150 first:rounded-t-[24px] last:rounded-b-[24px] active:bg-surface-2"
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-[background-color,border-color,transform] duration-200 ease-[var(--ease-spring)] ${
          taken
            ? 'scale-100 border-accent bg-accent text-on-accent'
            : 'border-surface-3 bg-transparent'
        }`}
        aria-hidden
      >
        {taken && <Check size={16} strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[16px] font-medium transition-colors ${taken ? 'text-muted' : ''}`}
        >
          {s.name}
        </span>
        <span className="block text-[13px] text-muted">{TIMING_LABEL[s.timing]}</span>
      </span>
      <span className={`shrink-0 tabular text-[15px] font-semibold ${taken ? 'text-muted' : ''}`}>
        {formatDose(s.dose, s.unit)}
      </span>
    </button>
  );
}

function Chevron() {
  return (
    <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden className="shrink-0 text-muted">
      <path
        d="M1 1l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
