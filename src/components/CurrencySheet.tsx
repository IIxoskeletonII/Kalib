// SPEC §18.3 — which money the planner counts in. The three this household uses are one tap
// away; everything else is a search away.
import { Check, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CURRENCIES, QUICK_CURRENCIES, currencyOf } from '@/core/currency';
import { Chip } from './ui';

export function CurrencySheet({
  current,
  onPick,
}: {
  current: string;
  onPick: (code: string) => void;
}) {
  const [query, setQuery] = useState('');
  const code = currencyOf(current).code;
  const q = query.trim().toLowerCase();
  const list = useMemo(
    () =>
      q
        ? CURRENCIES.filter(
            (c) =>
              c.code.toLowerCase().includes(q) ||
              c.name.toLowerCase().includes(q) ||
              c.symbol.toLowerCase().includes(q),
          )
        : CURRENCIES,
    [q],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {QUICK_CURRENCIES.map((qc) => {
          const c = currencyOf(qc);
          return (
            <Chip key={qc} active={code === qc} onClick={() => onPick(qc)}>
              {c.symbol} {c.code}
            </Chip>
          );
        })}
      </div>

      <div className="relative">
        <Search
          size={17}
          strokeWidth={2}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search currencies"
          aria-label="Search currencies"
          className="h-12 w-full rounded-full bg-surface-2 pr-4 pl-11 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
        />
      </div>

      <ul className="max-h-[46vh] overflow-y-auto rounded-2xl bg-surface-2/60">
        {list.map((c) => (
          <li key={c.code}>
            <button
              type="button"
              onClick={() => onPick(c.code)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span className="w-10 shrink-0 text-[15px] font-semibold">{c.symbol}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]">{c.name}</span>
                <span className="block text-[12px] text-muted tabular">{c.code}</span>
              </span>
              {c.code === code && <Check size={17} className="shrink-0 text-accent" aria-hidden />}
            </button>
          </li>
        ))}
        {list.length === 0 && (
          <li className="px-4 py-6 text-center text-[14px] text-muted">
            Nothing matches “{query}”.
          </li>
        )}
      </ul>
    </div>
  );
}
