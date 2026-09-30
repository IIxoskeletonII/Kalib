// SPEC §4.1 — the switch for cycle-aware trend weight, and what it is doing once it is on.
//
// Off by default and never inferred from anything: the app has no business guessing this. Once
// on, a "Period started today" row appears in the weigh-in sheet, and the trend chart shades
// the days it expects retention on. Nothing is hidden and no reading is altered — the filter is
// told to trust those days less, which is a different and more honest thing.
import { CalendarHeart, Trash2 } from 'lucide-react';
import { cycleDay, DEFAULT_CYCLE_DAYS } from '@/core/cycle';
import { fromDateKey, todayKey } from '@/core/dates';
import { useCycle } from '@/hooks/useData';
import { addCycleStart, removeCycleStart, setCycleAware } from '@/services/cycle';
import { Button, Card, IconButton, SectionHeading } from './ui';

const shortDate = (d: string) =>
  fromDateKey(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function CycleCard() {
  const today = todayKey();
  const cycle = useCycle(today);
  const day = cycleDay(today, cycle.starts);
  const recent = [...cycle.starts].reverse().slice(0, 3);

  return (
    <section>
      <SectionHeading trailing={cycle.enabled ? (day != null ? `day ${day}` : 'on') : undefined}>
        Cycle
      </SectionHeading>
      <Card>
        <button
          type="button"
          role="switch"
          aria-checked={cycle.enabled}
          onClick={() => void setCycleAware(!cycle.enabled)}
          className="flex w-full items-center gap-4 px-5 py-4 text-left active:bg-surface-2"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <CalendarHeart size={18} strokeWidth={2.2} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-medium">Cycle-aware trend</span>
            <span className="block text-[13px] leading-snug text-muted">
              Water retention in the days around a period can move the scale a kilo or two. With
              this on, the trend expects it instead of reading it as weight gained.
            </span>
          </span>
          <span
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${
              cycle.enabled ? 'bg-primary' : 'bg-surface-3'
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-surface shadow transition-[left] duration-200 ${
                cycle.enabled ? 'left-6' : 'left-1'
              }`}
            />
          </span>
        </button>

        {cycle.enabled && (
          <div className="border-t border-line p-4 pt-3">
            {cycle.starts.length === 0 ? (
              <p className="mb-3 text-[13px] leading-snug text-muted">
                Nothing logged yet. Tick <span className="font-medium">Period started today</span>{' '}
                in the weigh-in sheet when it begins, or add today here.
              </p>
            ) : (
              <>
                <p className="mb-2 text-[13px] text-muted">
                  {cycle.starts.length} logged · cycle{' '}
                  {cycle.starts.length > 1
                    ? `${cycle.length} days`
                    : `assumed ${DEFAULT_CYCLE_DAYS} days`}
                </p>
                <div className="mb-3 divide-y divide-line">
                  {recent.map((d) => (
                    <div key={d} className="flex items-center justify-between py-1.5">
                      <span className="text-[14px]">{shortDate(d)}</span>
                      <IconButton
                        icon={Trash2}
                        label={`Remove ${shortDate(d)}`}
                        className="h-9 w-9 rounded-lg text-danger"
                        onClick={() => void removeCycleStart(d)}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
            {!cycle.starts.includes(today) && (
              <Button className="w-full" onClick={() => void addCycleStart(today)}>
                Started today
              </Button>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}
