import { Scale, TrendingDown, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { TrendChart } from '@/components/TrendChart';
import { Card, Chip, EmptyState, ListRow, Row, SectionHeading, Segmented } from '@/components/ui';
import { WeighInSheet } from '@/components/WeighInSheet';
import { addDays, fromDateKey, todayKey } from '@/core/dates';
import { computeTrend, trendDelta } from '@/core/trend';
import { setSetting } from '@/db/repo/settings';
import { useSetting, useWeighIns } from '@/hooks/useData';

type Range = '28' | '84' | 'all';
const RANGES: { value: Range; label: string }[] = [
  { value: '28', label: '4 weeks' },
  { value: '84', label: '12 weeks' },
  { value: 'all', label: 'All' },
];

export default function Trend() {
  const weighIns = useWeighIns();
  const showRaw = useSetting<boolean>('show_raw_weight', false);
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

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
}
