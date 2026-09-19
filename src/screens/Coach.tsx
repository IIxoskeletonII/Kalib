// SPEC §16 — where the diet is short, and the foods that close the gap.
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { AmountSheet } from '@/components/AmountSheet';
import { Card, EmptyState, ListRow, SectionHeading, Skeleton, fmt } from '@/components/ui';
import { COACH_MIN_COMPLETE_DAYS } from '@/core/coach';
import { mealSlotForTime, todayKey } from '@/core/dates';
import type { Food } from '@/core/types';
import { useCoach } from '@/hooks/useData';

export default function Coach() {
  const today = todayKey();
  const coach = useCoach(today);
  const [picked, setPicked] = useState<{ food: Food; grams: number } | null>(null);

  return (
    <div className="pb-32">
      <header className="pt-2">
        <p className="text-[14px] font-medium text-muted">Last 7 days</p>
        <h1 className="mt-0.5 text-[34px] leading-none font-extrabold tracking-[-0.03em]">Coach</h1>
      </header>

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
