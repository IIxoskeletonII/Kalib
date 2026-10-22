// SPEC §20.17 — choosing the days you train.
//
// Seven days, Monday first, each a toggle; that is the whole control for most people. Under it,
// for anyone whose week moves around, a count with no fixed days, and Auto, which hands the
// number back to the app (§20.15). Fixed days and a count are one or the other, never both: a
// "four a week" that also names three days would be two plans.
import { Chip } from '@/components/ui';
import {
  describeWeekdays,
  EMPTY_PLAN,
  flexiblePlan,
  MAX_DAYS_A_WEEK,
  MIN_DAYS_A_WEEK,
  toggleWeekday,
  weekdayName,
  WEEKDAYS_MONDAY_FIRST,
  type TrainingPlan,
} from '@/core/schedule';

const COUNTS = Array.from(
  { length: MAX_DAYS_A_WEEK - MIN_DAYS_A_WEEK + 1 },
  (_, i) => MIN_DAYS_A_WEEK + i,
);

export function DaysPicker({
  plan,
  onChange,
}: {
  plan: TrainingPlan;
  onChange: (next: TrainingPlan) => void;
}) {
  const fixed = plan.weekdays.length > 0;
  return (
    <div>
      <div role="group" aria-label="Training days" className="flex justify-between gap-1">
        {WEEKDAYS_MONDAY_FIRST.map((d) => {
          const on = plan.weekdays.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              aria-label={weekdayName(d, 'long')}
              onClick={() => onChange(toggleWeekday(plan, d))}
              className={`hit flex h-11 w-11 items-center justify-center rounded-full text-[14px] font-semibold transition-[transform,background-color,color] duration-200 active:scale-90 ${
                on ? 'bg-primary text-on-primary' : 'bg-surface-2 text-ink-2 active:bg-surface-3'
              }`}
            >
              {weekdayName(d).slice(0, 1)}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[14px] text-ink-2" aria-live="polite">
        {fixed
          ? `${plan.weekdays.length} ${plan.weekdays.length === 1 ? 'day' : 'days'} a week: ${describeWeekdays(plan.weekdays)}.`
          : plan.per_week != null
            ? `${plan.per_week} ${plan.per_week === 1 ? 'day' : 'days'} a week, on whichever days suit.`
            : 'No days chosen. The app reads your week from what you do.'}
      </p>

      <div className="mt-4 text-[13px] font-semibold text-muted" id="days-flexible">
        No fixed days
      </div>
      {/* Wraps rather than scrolls: eight chips fit two rows at phone width, and a rail would
          hide the higher counts off the edge. */}
      <div role="group" aria-labelledby="days-flexible" className="mt-2 flex flex-wrap gap-2">
        <Chip active={!fixed && plan.per_week == null} onClick={() => onChange(EMPTY_PLAN)}>
          Auto
        </Chip>
        {COUNTS.map((n) => (
          <Chip
            key={n}
            active={!fixed && plan.per_week === n}
            aria-label={`${n} ${n === 1 ? 'day' : 'days'} a week, any days`}
            onClick={() => onChange(flexiblePlan(n))}
            className="w-11 px-0"
          >
            {n}
          </Chip>
        ))}
      </div>
    </div>
  );
}
