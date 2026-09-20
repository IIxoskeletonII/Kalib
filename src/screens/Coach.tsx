// SPEC §16 — where the diet is short, and the foods that close the gap — plus the v2 week in
// review and the §7.4 micronutrient panel, all over the same seven days.
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { AmountSheet } from '@/components/AmountSheet';
import { Card, EmptyState, ListRow, SectionHeading, Skeleton, fmt } from '@/components/ui';
import { COACH_MIN_COMPLETE_DAYS, MICRO_COVERAGE_FLOOR } from '@/core/coach';
import { mealSlotForTime, todayKey } from '@/core/dates';
import type { MicroStat, WeekReview } from '@/core/review';
import type { Food } from '@/core/types';
import { useCoach, useWeekOverview } from '@/hooks/useData';

export default function Coach() {
  const today = todayKey();
  const coach = useCoach(today);
  const week = useWeekOverview(today);
  const [picked, setPicked] = useState<{ food: Food; grams: number } | null>(null);
  const [showAllMicros, setShowAllMicros] = useState(false);

  return (
    <div className="pb-32">
      <header className="pt-2">
        <p className="text-[14px] font-medium text-muted">Last 7 days</p>
        <h1 className="mt-0.5 text-[34px] leading-none font-extrabold tracking-[-0.03em]">Coach</h1>
      </header>

      {week && week.review.completeDays > 0 && <WeekCard r={week.review} />}

      {coach === undefined && (
        <Card className="mt-6 space-y-3 p-5">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </Card>
      )}

      {coach?.kind === 'quiet' && (
        <Card className="mt-6">
          <EmptyState
            icon={Sparkles}
            title="Nothing to fix yet"
            body={`Once ${COACH_MIN_COMPLETE_DAYS} full days are logged this week, anything running short shows up here with foods that close the gap.`}
          />
        </Card>
      )}

      {coach?.kind === 'closed' && (
        <Card className="mt-6">
          <EmptyState
            icon={Sparkles}
            title={`${coach.nutrientLabel} is on target`}
            body="Averaged over the last week. Keep it up."
          />
        </Card>
      )}

      {coach?.kind === 'gap' && (
        <section className="mt-6">
          <Card className="p-5">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-accent">
              <Sparkles size={16} aria-hidden />
              Running low
            </div>
            <h2 className="mt-2 text-[24px] font-bold tracking-[-0.02em]">
              {coach.result.gap.label}
            </h2>
            <p className="mt-1 text-[15px] leading-snug text-muted tabular">
              Averaging {fmt(coach.result.gap.average, coach.result.gap.unit === 'g' ? 0 : 1)}{' '}
              {coach.result.gap.unit} a day against a target of{' '}
              {fmt(coach.result.gap.target, coach.result.gap.unit === 'g' ? 0 : 1)}{' '}
              {coach.result.gap.unit}, over {coach.result.gap.days} logged days.
            </p>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-700 ease-[var(--ease-out-soft)]"
                style={{ width: `${Math.min(100, coach.result.gap.ratio * 100)}%` }}
              />
            </div>
          </Card>

          {coach.result.recommendations.length > 0 && (
            <div className="mt-7">
              <SectionHeading>Foods that close the gap</SectionHeading>
              <Card className="divide-y divide-line">
                {coach.result.recommendations.map((r) => (
                  <ListRow
                    key={r.food.id}
                    onClick={() => setPicked({ food: r.food, grams: r.grams })}
                    wrapTitle
                    title={r.food.name.split(',').slice(0, 2).join(',')}
                    subtitle={`${fmt(r.grams)} g · ${fmt(r.kcal)} kcal${r.familiar ? ' · you log this already' : ''}`}
                    value={`+${fmt(r.adds, coach.result.gap.unit === 'g' ? 0 : 1)} ${coach.result.gap.unit}`}
                    valueSub={coach.result.gap.label.toLowerCase()}
                  />
                ))}
              </Card>
              <p className="mt-3 px-1 text-[13px] text-muted">
                Tap one to log it. The message stays until the weekly average reaches target.
              </p>
            </div>
          )}
        </section>
      )}

      {week && (
        <section className="mt-7">
          <SectionHeading
            trailing={
              week.panel.stats.length > 0
                ? `${week.panel.stats.length} of ${week.panel.stats.length + week.panel.unknown.length} tracked`
                : undefined
            }
          >
            Micronutrients
          </SectionHeading>
          {week.panel.stats.length === 0 ? (
            <Card>
              <EmptyState
                icon={Sparkles}
                title="Not enough vitamin data yet"
                body={`Averages appear once a full day carries micronutrient data for at least ${Math.round(MICRO_COVERAGE_FLOOR * 100)}% of its calories. Weighed database foods do; quick adds do not.`}
              />
            </Card>
          ) : (
            <>
              <Card className="divide-y divide-line">
                {(showAllMicros ? week.panel.stats : week.panel.stats.slice(0, 8)).map((m) => (
                  <MicroRow key={m.key} m={m} days={week.panel.daysComplete} />
                ))}
              </Card>
              {week.panel.stats.length > 8 && (
                <button
                  type="button"
                  className="mt-3 w-full text-center text-[14px] font-semibold text-accent"
                  onClick={() => setShowAllMicros((v) => !v)}
                >
                  {showAllMicros ? 'Show the lowest eight' : `Show all ${week.panel.stats.length}`}
                </button>
              )}
              <p className="mt-3 px-1 text-[13px] leading-snug text-muted">
                Daily averages against the adult reference intake. Each nutrient is judged only on
                full days whose food carried data for it; supplements you ticked off count.
                {week.panel.unknown.length > 0 && (
                  <> No data yet for {week.panel.unknown.map((u) => u.label).join(', ')}.</>
                )}
              </p>
            </>
          )}
        </section>
      )}

      <AmountSheet
        open={picked != null}
        food={picked?.food}
        date={today}
        initialGrams={picked?.grams}
        initialSlot={mealSlotForTime(new Date())}
        entryMethod="search"
        onClose={() => setPicked(null)}
      />
    </div>
  );
}

function WeekCard({ r }: { r: WeekReview }) {
  const adherenceTone =
    r.adherence <= 1.05 && r.adherence >= 0.85
      ? 'text-accent'
      : r.adherence > 1.05
        ? 'text-fat'
        : 'text-kcal';
  return (
    <Card className="mt-6 px-5 py-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] font-semibold text-ink-2">This week</span>
        <span className="text-[13px] text-muted tabular">
          {r.completeDays} full {r.completeDays === 1 ? 'day' : 'days'} · {r.weighedDays} weigh-ins
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 tabular">
        <Stat
          label="Calories"
          value={fmt(r.avgKcal)}
          sub={`of ${fmt(r.avgTarget)}`}
          tone={adherenceTone}
        />
        <Stat
          label="Protein"
          value={`${fmt(r.avgProtein)} g`}
          sub={`of ${fmt(r.proteinTarget)}`}
          tone={r.avgProtein >= 0.85 * r.proteinTarget ? 'text-accent' : 'text-kcal'}
        />
        <Stat
          label="Fiber"
          value={`${fmt(r.avgFiber)} g`}
          sub={`of ${fmt(r.fiberTarget)}`}
          tone={r.avgFiber >= 0.85 * r.fiberTarget ? 'text-accent' : 'text-kcal'}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[13px] text-muted tabular">
        {r.weightDelta != null && (
          <span>
            Trend{' '}
            <span className={`font-semibold ${r.weightDelta <= 0 ? 'text-fiber' : 'text-fat'}`}>
              {r.weightDelta > 0 ? '+' : ''}
              {r.weightDelta.toFixed(1)} kg
            </span>
          </span>
        )}
        {r.calorieConfidence != null && (
          <span>
            Weighed{' '}
            <span className="font-semibold text-ink-2">
              {Math.round(r.calorieConfidence * 100)}%
            </span>
          </span>
        )}
        {r.microCoverage != null && (
          <span>
            Vitamin data{' '}
            <span className="font-semibold text-ink-2">{Math.round(r.microCoverage * 100)}%</span>
          </span>
        )}
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <div>
      <div className="text-[12px] font-semibold text-muted">{label}</div>
      <div className={`mt-0.5 text-[17px] font-bold tracking-[-0.01em] ${tone}`}>{value}</div>
      <div className="text-[12px] text-muted">{sub}</div>
    </div>
  );
}

function MicroRow({ m, days }: { m: MicroStat; days: number }) {
  const pct = Math.min(1, m.ratio);
  const bar = m.ratio >= 0.85 ? 'bg-accent' : m.ratio >= 0.5 ? 'bg-kcal' : 'bg-fat';
  const dp = m.average < 10 && m.average !== Math.round(m.average) ? 1 : 0;
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-medium">
          {m.label}
          {m.days < days && (
            <span className="ml-1.5 text-[12px] font-normal text-muted">
              {m.days} of {days} days
            </span>
          )}
        </span>
        <span className="shrink-0 text-[13px] text-muted tabular">
          <span className="font-semibold text-ink">{fmt(m.average, dp)}</span> / {fmt(m.rda, dp)}{' '}
          {m.unit}
          <span className="ml-2 inline-block w-10 text-right font-semibold text-ink-2">
            {Math.round(m.ratio * 100)}%
          </span>
        </span>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${bar} transition-[width] duration-700 ease-[var(--ease-out-soft)]`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
