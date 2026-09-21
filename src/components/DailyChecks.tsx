// The three things to do every day besides eating — weigh in, drink, take what you take — as
// one row of equal tiles. Each tile's own action is one tap; the detail lives in a sheet.
import { Check, Droplets, Pill, Plus, Scale } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { TIMING_LABEL, formatDose } from '@/core/supplements';
import type { Supplement, WeighIn } from '@/core/types';
import { DEFAULT_GLASS_ML, WATER_GLASS_KEY, sumWater } from '@/core/water';
import { addWater } from '@/db/repo/water';
import { useSetting, useSupplements, useTakenSupplements, useWaterLogs } from '@/hooks/useData';
import { setTaken } from '@/services/supplements';
import { WaterSheet } from './WaterSheet';
import { WeighInSheet } from './WeighInSheet';
import { Sheet } from './ui';

export function DailyChecks({
  date,
  waterTargetMl,
  todaysWeighIn,
  previousWeighIn,
  trendKg,
}: {
  date: string;
  waterTargetMl: number;
  todaysWeighIn: WeighIn | undefined;
  previousWeighIn: WeighIn | undefined;
  trendKg: number | undefined;
}) {
  const [open, setOpen] = useState<'weight' | 'water' | 'supplements' | null>(null);
  const [pulse, setPulse] = useState(0);
  const logs = useWaterLogs(date);
  const glass = useSetting<number>(WATER_GLASS_KEY, DEFAULT_GLASS_ML);
  const supplements = useSupplements();
  const taken = useTakenSupplements(date);
  const water = sumWater(logs ?? []);
  const takenCount = supplements?.filter((s) => taken?.has(s.id)).length ?? 0;
  const allTaken =
    supplements != null && supplements.length > 0 && takenCount === supplements.length;

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Tile
          icon={Scale}
          label="Weight"
          onClick={() => setOpen('weight')}
          value={todaysWeighIn ? todaysWeighIn.weight_kg.toFixed(1) : undefined}
          unit="kg"
          sub={
            todaysWeighIn
              ? trendKg != null
                ? `trend ${trendKg.toFixed(1)}`
                : 'logged'
              : previousWeighIn
                ? `last ${previousWeighIn.weight_kg.toFixed(1)}`
                : 'not yet'
          }
          cta={todaysWeighIn ? undefined : 'Log'}
        />
        <Tile
          icon={Droplets}
          label="Water"
          tone="water"
          onClick={() => setOpen('water')}
          value={(water / 1000).toLocaleString(undefined, {
            maximumFractionDigits: 1,
            minimumFractionDigits: 1,
          })}
          unit="L"
          sub={`of ${(waterTargetMl / 1000).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}`}
          action={{
            label: `Add ${glass} ml of water`,
            onClick: () => {
              void addWater(date, glass);
              setPulse((n) => n + 1);
            },
          }}
          pulse={pulse}
          fill={waterTargetMl > 0 ? Math.min(1, water / waterTargetMl) : 0}
        />
        <Tile
          icon={Pill}
          label="Vitamins"
          onClick={() => setOpen('supplements')}
          value={
            supplements && supplements.length > 0
              ? `${takenCount}/${supplements.length}`
              : undefined
          }
          sub={
            supplements && supplements.length > 0 ? (allTaken ? 'all taken' : 'taken') : 'none yet'
          }
          cta={supplements && supplements.length > 0 ? undefined : 'Add'}
          done={allTaken}
        />
      </div>

      <WeighInSheet
        open={open === 'weight'}
        date={date}
        current={todaysWeighIn?.weight_kg}
        previous={previousWeighIn?.weight_kg}
        onClose={() => setOpen(null)}
      />
      <WaterSheet
        open={open === 'water'}
        date={date}
        logs={logs ?? []}
        glass={glass}
        targetMl={waterTargetMl}
        onClose={() => setOpen(null)}
      />
      <SupplementsSheet
        open={open === 'supplements'}
        date={date}
        supplements={supplements ?? []}
        taken={taken}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  unit,
  sub,
  cta,
  action,
  fill,
  done,
  tone = 'accent',
  pulse = 0,
  onClick,
}: {
  icon: typeof Scale;
  label: string;
  value?: string | undefined;
  unit?: string;
  sub: string;
  /** Text shown in place of a value when there is nothing yet. */
  cta?: string | undefined;
  /** A second, one-tap action in the corner (water: + one glass). */
  action?: { label: string; onClick: () => void } | undefined;
  /** 0–1 progress drawn as a hairline at the bottom. */
  fill?: number | undefined;
  done?: boolean | undefined;
  tone?: 'accent' | 'water';
  /** Increment to pop the value (a glass was just added). */
  pulse?: number;
  onClick: () => void;
}) {
  const iconTone = tone === 'water' ? 'text-accent-2' : 'text-accent';
  return (
    <div className="card relative flex min-h-[104px] flex-col justify-between overflow-hidden px-3.5 pt-3 pb-3">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="absolute inset-0 rounded-[24px] transition-transform duration-200 ease-[var(--ease-out-soft)] active:scale-[0.97]"
      />
      <div className="pointer-events-none relative flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
        <Icon size={13} strokeWidth={2.4} aria-hidden className={iconTone} />
        <span className="truncate">{label}</span>
        {done && <Check size={13} strokeWidth={3} aria-hidden className="ml-auto text-accent" />}
      </div>
      <div className="pointer-events-none relative mt-2 flex items-end justify-between gap-1">
        <div className="min-w-0 tabular">
          {value != null ? (
            <div
              key={pulse}
              className={`origin-left text-[20px] leading-none font-bold tracking-[-0.02em] ${pulse ? 'pop' : ''}`}
            >
              {value}
              {unit && <span className="ml-0.5 text-[11px] font-medium text-muted">{unit}</span>}
            </div>
          ) : (
            <div className="text-[17px] leading-none font-bold text-ink">{cta}</div>
          )}
          <div className="mt-1 truncate text-[11px] text-muted">{sub}</div>
        </div>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            aria-label={action.label}
            className="pointer-events-auto relative -mr-1 -mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-2 text-on-accent transition-transform duration-200 ease-[var(--ease-out-soft)] active:scale-90"
          >
            <Plus size={18} strokeWidth={2.6} aria-hidden />
          </button>
        )}
      </div>
      {fill != null && (
        <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-[3px] bg-surface-2">
          <div
            className="h-full bg-accent-2 transition-[width] duration-700 ease-[var(--ease-out-soft)]"
            style={{ width: `${fill * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

function SupplementsSheet({
  open,
  date,
  supplements,
  taken,
  onClose,
}: {
  open: boolean;
  date: string;
  supplements: Supplement[];
  taken: ReadonlySet<string> | undefined;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Supplements">
      {supplements.length === 0 ? (
        <div className="space-y-3">
          <p className="text-[14px] text-muted">
            Creatine, vitamins, minerals — with a dose worked out for you.
          </p>
          <Link
            to="/supplements"
            className="inline-flex h-12 w-full items-center justify-center rounded-full bg-primary px-5 font-semibold text-on-primary"
          >
            Add supplements
          </Link>
        </div>
      ) : (
        <>
          <div className="card divide-y divide-line">
            {supplements.map((s) => {
              const isTaken = taken?.has(s.id) ?? false;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="checkbox"
                  aria-checked={isTaken}
                  onClick={() => void setTaken(s, date, !isTaken)}
                  className="flex min-h-16 w-full items-center gap-3.5 px-4 py-3 text-left transition-colors duration-150 first:rounded-t-[24px] last:rounded-b-[24px] active:bg-surface-2"
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-[background-color,border-color] duration-200 ${
                      isTaken ? 'border-accent bg-accent text-on-accent' : 'border-surface-3'
                    }`}
                    aria-hidden
                  >
                    {isTaken && <Check size={16} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[16px] font-medium ${isTaken ? 'text-muted' : ''}`}
                    >
                      {s.name}
                    </span>
                    <span className="block text-[13px] text-muted">{TIMING_LABEL[s.timing]}</span>
                  </span>
                  <span
                    className={`shrink-0 tabular text-[15px] font-semibold ${isTaken ? 'text-muted' : ''}`}
                  >
                    {formatDose(s.dose, s.unit)}
                  </span>
                </button>
              );
            })}
          </div>
          <Link
            to="/supplements"
            className="mt-4 block text-center text-[14px] font-semibold text-accent"
          >
            Edit the list
          </Link>
        </>
      )}
    </Sheet>
  );
}
