import { Flame, Scale, TrendingDown, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { TrendChart } from '@/components/TrendChart';
import { Card, Chip, EmptyState, ListRow, Row, SectionHeading, Segmented } from '@/components/ui';
import { WeighInSheet } from '@/components/WeighInSheet';
import { addDays, fromDateKey, todayKey } from '@/core/dates';
import { computeTrend, trendDelta } from '@/core/trend';
import { fmt } from '@/components/ui';
import { setSetting } from '@/db/repo/settings';
import { useSetting, useTdee, useWeighIns } from '@/hooks/useData';

type Range = '28' | '84' | 'all';
const RANGES: { value: Range; label: string }[] = [
  { value: '28', label: '4 weeks' },
  { value: '84', label: '12 weeks' },
  { value: 'all', label: 'All' },
];

export default function Trend() {
  const weighIns = useWeighIns();
  const showRaw = useSetting<boolean>('show_raw_weight', false);
  const tdee = useTdee();
  const [range, setRange] = useState<Range>('28');
  const [editDate, setEditDate] = useState<string | null>(null);
  const today = todayKey();

  const all = useMemo(() => computeTrend(weighIns ?? [], undefined, today), [weighIns, today]);
  const points = useMemo(() => {
    if (range === 'all') return all;
    const from = addDays(today, -Number(range));
    return all.filter((p) => p.date >= from);
  }, [all, range, today]);

  const latest = all.at(-1);
  const d7 = trendDelta(all, 7);
  const d28 = trendDelta(all, 28);
  const sinceStart = all.length > 1 ? latest!.trend - all[0]!.trend : undefined;
  const weighedDays = all.filter((p) => p.weighed).length;

  return (
    <div className="pb-32">
      <header className="pt-2">
        <p className="text-[14px] font-medium text-muted">Smoothed weight</p>
        <h1 className="mt-0.5 text-[34px] leading-none font-extrabold tracking-[-0.03em]">Trend</h1>
      </header>

      {latest ? (
        <Card className="mt-6 p-5">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[13px] font-semibold text-muted">Trend weight</div>
              <div className="display mt-1">
                {latest.trend.toFixed(1)}
                <span className="ml-1.5 text-[20px] font-medium text-muted">kg</span>
              </div>
            </div>
            {d7 != null && (
              <div
                className={`flex items-center gap-1 pb-1 text-[14px] tabular ${d7 <= 0 ? 'text-fiber' : 'text-fat'}`}
              >
                {d7 <= 0 ? (
                  <TrendingDown size={16} aria-hidden />
                ) : (
                  <TrendingUp size={16} aria-hidden />
                )}
                {d7 > 0 ? '+' : ''}
                {d7.toFixed(2)} kg in 7 days
              </div>
            )}
          </div>
          <div className="mt-4">
            {points.length >= 2 ? (
              <TrendChart points={points} showRaw={showRaw} />
            ) : (
              <p className="py-10 text-center text-[14px] text-muted">
                Two or more weigh-ins needed for a chart.
              </p>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <Segmented value={range} options={RANGES} onChange={setRange} className="flex-1" />
            <Chip active={showRaw} onClick={() => setSetting('show_raw_weight', !showRaw)}>
              Raw
            </Chip>
          </div>
        </Card>
      ) : (
        <div>
          <EmptyState
            icon={Scale}
            title="No weigh-ins yet"
            body="Weigh in daily from the Today screen; the trend appears after two days."
          />
        </div>
      )}

      {latest && (
        <Card className="mt-3 divide-y divide-line">
          {d28 != null && <Row label="Last 28 days" value={signed(d28)} sub="kg" />}
          {sinceStart != null && <Row label="Since start" value={signed(sinceStart)} sub="kg" />}
          <Row label="Days weighed" value={String(weighedDays)} sub={`of ${all.length}`} />
        </Card>
      )}

      {tdee && (
        <section className="mt-7">
          <SectionHeading
            trailing={
              tdee.published ? `applied ${fmt(tdee.published.tdee)} kcal` : 'not applied yet'
            }
          >
            <span className="inline-flex items-center gap-2">
              <Flame size={16} className="text-accent" aria-hidden />
              Measured burn
            </span>
          </SectionHeading>
          <Card className="p-5">
            {tdee.result.status === 'ok' ? (
              <>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-[13px] font-semibold text-muted">
                      TDEE, last {tdee.result.estimate.window_days} days
                    </div>
                    <div className="display mt-1">
                      {fmt(tdee.result.estimate.tdee_kcal)}
                      <span className="ml-1.5 text-[20px] font-medium text-muted">kcal</span>
                    </div>
                  </div>
                  <div className="pb-1 text-right text-[14px] tabular text-muted">
                    ±{fmt((tdee.result.estimate.ci_high - tdee.result.estimate.ci_low) / 2)}
                    <span className="block text-[12px]">95% interval</span>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center tabular">
                  <Mini
                    label="Logged"
                    value={`${tdee.result.estimate.logged_days}/${tdee.result.estimate.window_days}`}
                  />
                  <Mini
                    label="Weighed"
                    value={`${tdee.result.estimate.weighed_days}/${tdee.result.estimate.window_days}`}
                  />
                  <Mini
                    label="Data quality"
                    value={`${Math.round(tdee.result.estimate.data_quality * 100)}%`}
                  />
                </div>
                <p className="mt-3 text-[13px] leading-snug text-muted">
                  {tdee.formula != null && `Formula said ${fmt(tdee.formula)}. `}
                  {tdee.published
                    ? `Targets run on ${fmt(tdee.published.tdee)} since ${fromDateKey(tdee.published.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}; each Monday moves it up to 150 kcal toward the measurement.`
                    : tdee.pending
                      ? 'On hold: more than 600 kcal from the formula — see Today.'
                      : 'Formula kept this week; next check Monday.'}
                </p>
              </>
            ) : tdee.result.status === 'calibrating' ? (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-[15px] font-semibold">Calibrating</span>
                  <span className="text-[13px] text-muted tabular">
                    day {tdee.result.day} of {tdee.result.first_estimate_day}
                  </span>
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-700 ease-[var(--ease-out-soft)]"
                    style={{
                      width: `${Math.min(100, (tdee.result.day / tdee.result.first_estimate_day) * 100)}%`,
                    }}
                  />
                </div>
                <p className="mt-3 text-[13px] leading-snug text-muted">
                  The first ten days are water and glycogen, not fat, so they never count. From day{' '}
                  {tdee.result.first_estimate_day} your real daily burn is measured from what you
                  logged and how the trend moved — then it replaces the formula, 150 kcal a week at
                  most.
                </p>
              </>
            ) : (
              <>
                <span className="text-[15px] font-semibold">Not enough data yet</span>
                <p className="mt-2 text-[13px] leading-snug text-muted tabular">
                  In the last {tdee.result.window_days} days: {tdee.result.logged_days} fully logged
                  days of {tdee.result.need_logged} needed, {tdee.result.weighed_days} weigh-ins of{' '}
                  {tdee.result.need_weighed}. Log whole days and weigh in daily and it fills in.
                </p>
              </>
            )}
          </Card>
        </section>
      )}

      {weighIns && weighIns.length > 0 && (
        <section className="mt-7">
          <SectionHeading>Weigh-ins</SectionHeading>
          <Card className="divide-y divide-line">
            {[...weighIns]
              .reverse()
              .slice(0, 14)
              .map((w) => (
                <ListRow
                  key={w.id}
                  onClick={() => setEditDate(w.date)}
                  title={fromDateKey(w.date).toLocaleDateString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                  value={`${w.weight_kg.toFixed(1)} kg`}
                />
              ))}
          </Card>
        </section>
      )}

      <WeighInSheet
        open={editDate != null}
        date={editDate ?? today}
        current={weighIns?.find((w) => w.date === editDate)?.weight_kg}
        previous={weighIns?.filter((w) => editDate != null && w.date < editDate).at(-1)?.weight_kg}
        onClose={() => setEditDate(null)}
      />
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[12px] font-semibold text-muted">{label}</div>
      <div className="mt-0.5 text-[16px] font-bold tracking-[-0.01em]">{value}</div>
    </div>
  );
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
}
