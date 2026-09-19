import { useMemo, useState } from 'react';
import { TrendChart } from '@/components/TrendChart';
import { Card, Chip, Row } from '@/components/ui';
import { WeighInSheet } from '@/components/WeighInSheet';
import { addDays, todayKey } from '@/core/dates';
import { computeTrend, trendDelta } from '@/core/trend';
import { setSetting } from '@/db/repo/settings';
import { useSetting, useWeighIns } from '@/hooks/useData';

const RANGES = [
  { label: '4w', days: 28 },
  { label: '12w', days: 84 },
  { label: 'All', days: 0 },
] as const;

export default function Trend() {
  const weighIns = useWeighIns();
  const showRaw = useSetting<boolean>('show_raw_weight', false);
  const [range, setRange] = useState<number>(28);
  const [editDate, setEditDate] = useState<string | null>(null);
  const today = todayKey();

  const all = useMemo(() => computeTrend(weighIns ?? [], undefined, today), [weighIns, today]);
  const points = useMemo(() => {
    if (range === 0) return all;
    const from = addDays(today, -range);
    return all.filter((p) => p.date >= from);
  }, [all, range, today]);

  const latest = all.at(-1);
  const d7 = trendDelta(all, 7);
  const d28 = trendDelta(all, 28);
  const sinceStart = all.length > 1 ? latest!.trend - all[0]!.trend : undefined;
  const weighedDays = all.filter((p) => p.weighed).length;

  return (
    <div className="space-y-4 pb-20">
      <h1 className="text-lg font-semibold">Weight trend</h1>

      <Card>
        {points.length >= 2 ? (
          <TrendChart points={points} showRaw={showRaw} />
        ) : (
          <p className="py-10 text-center text-sm text-muted">
            Two or more weigh-ins needed for a chart.
          </p>
        )}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex gap-2">
            {RANGES.map((r) => (
              <Chip
                key={r.label}
                active={range === r.days}
                onClick={() => setRange(r.days)}
                className="h-8 px-3 text-xs"
              >
                {r.label}
              </Chip>
            ))}
          </div>
          <Chip
            active={showRaw}
            onClick={() => setSetting('show_raw_weight', !showRaw)}
            className="h-8 px-3 text-xs"
          >
            {showRaw ? 'Raw shown' : 'Show raw'}
          </Chip>
        </div>
      </Card>

      {latest && (
        <Card>
          <Row label="Trend now" value={`${latest.trend.toFixed(1)} kg`} />
          {d7 != null && <Row label="Last 7 days" value={signed(d7)} sub="kg" />}
          {d28 != null && <Row label="Last 28 days" value={signed(d28)} sub="kg" />}
          {sinceStart != null && <Row label="Since start" value={signed(sinceStart)} sub="kg" />}
          <Row label="Weigh-ins" value={String(weighedDays)} sub={`of ${all.length} days`} />
        </Card>
      )}

      {weighIns && weighIns.length > 0 && (
        <Card className="divide-y divide-line p-0">
          {[...weighIns]
            .reverse()
            .slice(0, 14)
            .map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setEditDate(w.date)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <span className="text-muted">{w.date}</span>
                <span className="tabular">{w.weight_kg.toFixed(1)} kg</span>
              </button>
            ))}
        </Card>
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
