import { addDays, fromDateKey } from '@/core/dates';

/** Seven days ending today (or the selected day if it is later); the selected day is a pill. */
export function WeekStrip({
  selected,
  today,
  onSelect,
  loggedDates,
}: {
  selected: string;
  today: string;
  onSelect: (date: string) => void;
  /** Days with anything logged get a dot. */
  loggedDates?: ReadonlySet<string> | undefined;
}) {
  const end = selected > today ? selected : today;
  const days = Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
  return (
    <div className="flex justify-between" role="tablist" aria-label="Day">
      {days.map((d) => {
        const date = fromDateKey(d);
        const active = d === selected;
        const future = d > today;
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={future}
            onClick={() => onSelect(d)}
            className={`flex h-[64px] w-[42px] flex-col items-center justify-center gap-1 rounded-full transition-[background-color,color,transform] duration-200 ease-[var(--ease-out-soft)] active:scale-95 disabled:opacity-30 ${
              active ? 'bg-primary text-on-primary' : 'text-muted active:bg-surface-2'
            }`}
          >
            <span className="text-[11px] font-semibold">
              {date.toLocaleDateString(undefined, { weekday: 'narrow' })}
            </span>
            <span className={`tabular text-[16px] font-bold ${active ? '' : 'text-ink'}`}>
              {date.getDate()}
            </span>
            <span
              className={`h-1 w-1 rounded-full ${loggedDates?.has(d) ? (active ? 'bg-on-primary' : 'bg-accent') : 'bg-transparent'}`}
            />
          </button>
        );
      })}
    </div>
  );
}
