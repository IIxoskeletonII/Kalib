// SPEC §20.4 / §20.7 — the two training settings: what unit the pad asks for, and whether the
// week's calories lean toward the days you lift.
//
// The copy here is deliberately unexcited. The evidence is that calorie cycling and flat intake
// produce the same weight change at an equal weekly deficit, that carbohydrate has no
// independent effect on hypertrophy, and that nutrient timing barely moves fat loss or lean
// mass. So this is an adherence feature and says so. Implying a metabolic benefit would be the
// easy copy and the dishonest one.
import { useEffect, useState } from 'react';
import { Card, SectionHeading, Segmented, fmt } from '@/components/ui';
import type { DayBudget } from '@/core/trainingDays';
import type { WeightUnit } from '@/core/types';
import { setSetting } from '@/db/repo/settings';
import { useWeightUnit } from '@/hooks/useWorkouts';
import {
  getEnergyBridge,
  setEnergyBridge,
  weekPreview,
  weekShape,
  type EnergyBridge,
} from '@/services/trainingDays';
import { WEIGHT_UNIT_KEY } from '@/services/workouts';

const UNITS: { value: WeightUnit; label: string }[] = [
  { value: 'kg', label: 'Kilograms' },
  { value: 'lb', label: 'Pounds' },
];

/** Four options is what Segmented is for, and Appearance directly below uses one. */
const DIFFERENCES: { value: string; label: string }[] = [
  { value: '0', label: 'Off' },
  { value: '150', label: '+150' },
  { value: '300', label: '+300' },
  { value: '500', label: '+500' },
];

/** Monday-first initials, matching the Train week strip. */
const WEEKDAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function TrainingCard() {
  const unit = useWeightUnit();
  const [bridge, setBridge] = useState<EnergyBridge | null>(null);
  const [pattern, setPattern] = useState<number[] | null>(null);
  const [week, setWeek] = useState<DayBudget[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getEnergyBridge().then((b) => !cancelled && setBridge(b));
    void weekShape(new Date().toLocaleDateString('en-CA')).then(
      (s) => !cancelled && setPattern(s.pattern),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // The shape is re-read whenever the setting changes, so the preview is of what is actually
  // stored rather than of what the control last said.
  useEffect(() => {
    if (bridge == null) return;
    let cancelled = false;
    void weekPreview().then((w) => !cancelled && setWeek(w?.applied ? w.days : null));
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const update = async (patch: Partial<EnergyBridge>) => {
    await setEnergyBridge(patch);
    setBridge(await getEnergyBridge());
  };

  return (
    <section>
      <SectionHeading>Training</SectionHeading>
      <Card className="space-y-5 p-5">
        <div>
          <p className="mb-2 text-[15px] font-semibold">Weight unit</p>
          <Segmented
            value={unit}
            options={UNITS}
            onChange={(u) => void setSetting(WEIGHT_UNIT_KEY, u)}
          />
          <p className="mt-2 text-[13px] leading-snug text-muted">
            Everything is stored in kilograms whichever you pick, so switching never rewrites your
            history — it changes what the pad asks for and what is shown.
          </p>
        </div>

        <div className="border-t border-line pt-5">
          <p className="text-[15px] font-semibold">Eat more on training days</p>
          <p className="mt-1 text-[13px] leading-snug text-muted">
            The same weekly calories, leaning toward the days you lift. The total does not change:
            your measured burn already includes the gym. This is for eating when you are hungry, not
            a metabolic effect — over a week, cycling and flat intake come out the same.
          </p>

          <div className="mt-3">
            <Segmented
              value={bridge == null || !bridge.enabled ? '0' : String(bridge.difference_kcal)}
              options={DIFFERENCES}
              onChange={(v) => {
                const d = Number(v);
                void update(d === 0 ? { enabled: false } : { enabled: true, difference_kcal: d });
              }}
            />
            <p className="mt-1.5 px-1 text-[12px] text-muted">
              kcal more on a training day than a rest day
            </p>
          </div>

          {week && <WeekShape days={week} />}

          {bridge?.enabled && (
            <p className="mt-3 text-[13px] leading-snug text-muted">
              {pattern == null ? null : pattern.length === 0 ? (
                <>
                  Nothing is moving yet: it takes a couple of weeks of sessions before the days you
                  train can be told from the days you happened to. Until then the budget stays flat.
                </>
              ) : (
                <>
                  Reading {pattern.map((d) => WEEKDAY_LABEL[d]).join(', ')} as your training days,
                  from what you have actually done. A day you train anyway counts on the day.
                </>
              )}
            </p>
          )}
        </div>
      </Card>
    </section>
  );
}

/**
 * The week at a glance: seven bars, training days in accent.
 *
 * Only two figures are printed, not seven. Every training day carries the same number and so
 * does every rest day, so seven labels would be the same two values five times over — and
 * MASTER's rule when a line cannot carry everything is to carry fewer numbers.
 */
function WeekShape({ days }: { days: DayBudget[] }) {
  const values = days.map((d) => d.kcal);
  const max = Math.max(...values);
  const min = Math.min(...values);
  // Scale against the span rather than against zero: the difference is a few hundred kcal on
  // a couple of thousand, and from zero every bar would look identical.
  const span = Math.max(1, max - min);
  const training = days.find((d) => d.training);
  const rest = days.find((d) => !d.training);

  return (
    <div className="mt-4">
      <div className="flex items-end gap-1.5" aria-hidden>
        {days.map((d) => (
          <div key={d.date} className="flex-1">
            {/* Narrow, so a full radius reads as a capsule rather than a circle: at column
                width these were as wide as they were tall and came out as blobs. */}
            <div
              className={`mx-auto w-2.5 rounded-full transition-[height] duration-700 ease-[var(--ease-out-soft)] ${
                d.training ? 'bg-accent' : 'bg-surface-3'
              }`}
              style={{ height: 8 + ((d.kcal - min) / span) * 34 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {days.map((d) => (
          <div
            key={d.date}
            className={`flex-1 text-center text-[11px] font-semibold ${
              d.training ? 'text-ink-2' : 'text-muted'
            }`}
          >
            {new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}
          </div>
        ))}
      </div>
      {training && rest && (
        <p className="mt-2 text-[12px] text-muted tabular">
          Training {fmt(training.kcal)} kcal · rest {fmt(rest.kcal)} kcal
        </p>
      )}
    </div>
  );
}
