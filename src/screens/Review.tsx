// Week in review as a page of its own: readable in one screen, shareable as text.
import { Check, ChevronLeft, Share2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, IconButton, fmt } from '@/components/ui';
import { addDays, fromDateKey, todayKey } from '@/core/dates';
import type { MicroStat, WeekReview } from '@/core/review';
import { useCoach, useTdee, useWeekOverview, useWeighIns } from '@/hooks/useData';
import { computeTrend } from '@/core/trend';
import { shareText } from '@/platform/share';

export default function Review() {
  const navigate = useNavigate();
  const today = todayKey();
  const from = addDays(today, -6);
  const week = useWeekOverview(today);
  const tdee = useTdee();
  const coach = useCoach(today);
  const weighIns = useWeighIns();
  const [shared, setShared] = useState<'copied' | null>(null);

  const trend = computeTrend(weighIns ?? [], undefined, today);
  const first = trend.find((p) => p.date >= from);
  const last = trend.at(-1);
  const range = `${fromDateKey(from).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${fromDateKey(today).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;

  const r = week?.review;
  const low = week?.panel.stats.filter((m) => m.ratio < 0.85).slice(0, 5) ?? [];
  const measured = tdee?.result.status === 'ok' ? tdee.result.estimate : undefined;

  const summary = () => {
    const lines = [`Kalib — week of ${range}`];
    if (r && r.completeDays > 0) {
      lines.push(
        `Calories: ${fmt(r.avgKcal)} a day of ${fmt(r.avgTarget)} target (${Math.round(r.adherence * 100)}%) over ${r.completeDays} full ${r.completeDays === 1 ? 'day' : 'days'}`,
      );
      lines.push(
        `Protein ${fmt(r.avgProtein)} g of ${fmt(r.proteinTarget)} · Fiber ${fmt(r.avgFiber)} g of ${fmt(r.fiberTarget)}`,
      );
    }
    if (first && last && r && r.weighedDays >= 2) {
      lines.push(
        `Weight trend: ${first.trend.toFixed(1)} → ${last.trend.toFixed(1)} kg (${last.trend - first.trend > 0 ? '+' : ''}${(last.trend - first.trend).toFixed(1)}), ${r.weighedDays} weigh-ins`,
      );
    }
    if (measured) {
      lines.push(
        `Measured TDEE: ${fmt(measured.tdee_kcal)} kcal (±${fmt((measured.ci_high - measured.ci_low) / 2)})${tdee?.published ? `, applied ${fmt(tdee.published.tdee)}` : ''}`,
      );
    }
    if (r?.calorieConfidence != null && r.microCoverage != null) {
      lines.push(
        `Weighed ${Math.round(r.calorieConfidence * 100)}% · vitamin data ${Math.round(r.microCoverage * 100)}%`,
      );
    }
    if (low.length > 0) {
      lines.push(
        `Low this week: ${low.map((m) => `${m.label.toLowerCase()} ${fmt(m.average, m.average < 10 ? 1 : 0)}/${fmt(m.rda, m.rda < 10 ? 1 : 0)} ${m.unit}`).join(', ')}`,
      );
    }
    return lines.join('\n');
  };

  const share = async () => {
    const outcome = await shareText(`Kalib — week of ${range}`, summary());
    if (outcome === 'copied') {
      setShared('copied');
      setTimeout(() => setShared(null), 1800);
    }
  };

  return (
    <div className="pb-32">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={() => navigate(-1)} />
        <div className="flex-1">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">Week in review</h1>
          <p className="text-[13px] text-muted">{range}</p>
        </div>
        <Button size="sm" variant="primary" icon={shared ? Check : Share2} onClick={share}>
          {shared ? 'Copied' : 'Share'}
        </Button>
      </div>

      {!r ? null : r.completeDays === 0 ? (
        <Card className="mt-5 p-5 text-[14px] text-muted">
          No full days logged this week yet. A day counts once it reaches 60% of its target.
        </Card>
      ) : (
        <>
          <section className="mt-6 px-1">
            <div className="text-[13px] font-semibold text-muted">Calories a day</div>
            <div className="mt-0.5 flex items-baseline gap-2 tabular">
              <span className="text-[40px] leading-none font-extrabold tracking-[-0.03em]">
                {fmt(r.avgKcal)}
              </span>
              <span className="text-[15px] text-muted">
                of {fmt(r.avgTarget)} ·{' '}
                <span className={toneFor(r.adherence)}>{Math.round(r.adherence * 100)}%</span>
              </span>
            </div>
            <div className="mt-1 text-[13px] text-muted">
              {r.completeDays} full {r.completeDays === 1 ? 'day' : 'days'} · {r.weighedDays}{' '}
              weigh-ins
            </div>
          </section>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Stat
              label="Protein"
              value={`${fmt(r.avgProtein)} g`}
              sub={`of ${fmt(r.proteinTarget)} g a day`}
              good={r.avgProtein >= 0.85 * r.proteinTarget}
            />
            <Stat
              label="Fiber"
              value={`${fmt(r.avgFiber)} g`}
              sub={`of ${fmt(r.fiberTarget)} g a day`}
              good={r.avgFiber >= 0.85 * r.fiberTarget}
            />
            {first && last && r.weighedDays >= 2 && (
              <Stat
                label="Trend weight"
                value={`${last.trend.toFixed(1)} kg`}
                sub={`${last.trend - first.trend > 0 ? '+' : ''}${(last.trend - first.trend).toFixed(1)} kg this week`}
                good={last.trend - first.trend <= 0}
              />
            )}
            {measured && (
              <Stat
                label="Measured burn"
                value={`${fmt(measured.tdee_kcal)} kcal`}
                sub={`±${fmt((measured.ci_high - measured.ci_low) / 2)} · ${tdee?.published ? `applied ${fmt(tdee.published.tdee)}` : 'not applied yet'}`}
                good
              />
            )}
          </div>

          {r.calorieConfidence != null && r.microCoverage != null && (
            <p className="mt-4 px-1 text-[13px] text-muted tabular">
              {Math.round(r.calorieConfidence * 100)}% of calories weighed ·{' '}
              {Math.round(r.microCoverage * 100)}% carried vitamin data
            </p>
          )}

          {coach?.kind === 'gap' && (
            <Card className="mt-5 px-4 py-3 text-[14px]">
              <span className="font-semibold">{coach.result.gap.label}</span> is running low —{' '}
              {fmt(coach.result.gap.average, coach.result.gap.unit === 'g' ? 0 : 1)} of{' '}
              {fmt(coach.result.gap.target, coach.result.gap.unit === 'g' ? 0 : 1)}{' '}
              {coach.result.gap.unit} a day.
            </Card>
          )}

          {low.length > 0 && (
            <section className="mt-6">
              <div className="mb-2 px-1 text-[13px] font-semibold text-muted">
                Below 85% of the reference intake
              </div>
              <Card className="divide-y divide-line">
                {low.map((m) => (
                  <LowRow key={m.key} m={m} />
                ))}
              </Card>
            </section>
          )}
        </>
      )}

      <p className="mt-6 px-1 text-[12px] leading-snug text-muted">
        Share sends this as plain text — readable in any chat or email. Nothing leaves the phone
        otherwise.
      </p>
    </div>
  );
}

function toneFor(adherence: number): string {
  return adherence >= 0.85 && adherence <= 1.05
    ? 'text-accent'
    : adherence > 1.05
      ? 'text-fat'
      : 'text-kcal';
}

function Stat({
  label,
  value,
  sub,
  good,
}: {
  label: string;
  value: string;
  sub: string;
  good: boolean;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[12px] font-semibold text-muted">{label}</div>
      <div
        className={`mt-1 text-[20px] leading-none font-bold tracking-[-0.02em] tabular ${good ? '' : 'text-kcal'}`}
      >
        {value}
      </div>
      <div className="mt-1 text-[12px] text-muted tabular">{sub}</div>
    </div>
  );
}

function LowRow({ m }: { m: MicroStat }) {
  const dp = m.average < 10 ? 1 : 0;
  return (
    <div className="flex items-baseline justify-between px-4 py-2.5 text-[14px] tabular">
      <span>{m.label}</span>
      <span className="text-muted">
        <span className="font-semibold text-ink">{fmt(m.average, dp)}</span> / {fmt(m.rda, dp)}{' '}
        {m.unit}
        <span className="ml-2 inline-block w-10 text-right font-semibold text-kcal">
          {Math.round(m.ratio * 100)}%
        </span>
      </span>
    </div>
  );
}

export type { WeekReview };
