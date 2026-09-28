// Logging screens can be opened for a day that is not today (from the week strip on Today).
// That has to be visible, or an entry quietly lands on the wrong day.
import { CalendarDays } from 'lucide-react';
import { fromDateKey, todayKey } from '@/core/dates';

export function DateBanner({ date }: { date: string }) {
  if (date === todayKey()) return null;
  const d = fromDateKey(date);
  const label = d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return (
    <p className="mb-3 flex items-center gap-2 rounded-2xl bg-accent/12 px-4 py-2.5 text-[13px] font-medium text-accent">
      <CalendarDays size={15} strokeWidth={2.2} aria-hidden />
      Logging to {label}
    </p>
  );
}
