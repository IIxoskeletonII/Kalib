// SPEC §22 — one switch for every measurement in the app. Near the top of Settings because it
// changes what every other screen says.
import type { UnitSystem } from '@/core/measure';
import { useUnits } from '@/hooks/useUnits';
import { setUnitSystem } from '@/services/units';
import { SectionHeading, Segmented } from './ui';

export const UNIT_SYSTEM_OPTIONS: { value: UnitSystem; label: string }[] = [
  { value: 'metric', label: 'Metric' },
  { value: 'us', label: 'US' },
];

/** What each choice means, said plainly so nobody has to flip it to find out. */
export const UNIT_SYSTEM_HINT: Record<UnitSystem, string> = {
  metric: 'kg, cm, litres and grams.',
  us: 'Pounds, feet and inches, fluid ounces and ounces.',
};

export function UnitsCard() {
  const units = useUnits();
  const system = units?.system ?? 'metric';
  return (
    <section aria-label="Units">
      <SectionHeading>Units</SectionHeading>
      <Segmented
        value={system}
        options={UNIT_SYSTEM_OPTIONS}
        onChange={(s) => void setUnitSystem(s)}
      />
      <p className="mt-2 px-1 text-[13px] leading-snug text-muted">
        {UNIT_SYSTEM_HINT[system]} Calories stay kcal and macros stay grams, as US labels print
        them. Everything is stored in metric, so switching never rewrites what you have logged.
      </p>
    </section>
  );
}
