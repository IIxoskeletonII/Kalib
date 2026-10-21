// SPEC §17.1 — water sheet: presets, a custom amount, the day's list with undo, glass size.
import { GlassWater, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  GLASS_CHOICES_FL_OZ,
  WATER_ENTRY_MAX_ML,
  WATER_ENTRY_MIN_ML,
  WATER_PRESETS_FL_OZ,
  flOzToMl,
  formatWaterAmount,
  formatWaterTotal,
  waterEntryMl,
  waterTotalValue,
  type UnitSystem,
} from '@/core/measure';
import type { WaterLog } from '@/core/types';
import { GLASS_CHOICES_ML, WATER_GLASS_KEY, WATER_PRESETS_ML, sumWater } from '@/core/water';
import { setSetting } from '@/db/repo/settings';
import { addWater, deleteWater, restoreWater } from '@/db/repo/water';
import { useUnitSystem } from '@/hooks/useUnits';
import { NumberPad } from './NumberPad';
import { SwipeRow } from './SwipeRow';
import { toast } from './Toast';
import { Button, Chip, IconButton, Sheet, fmt } from './ui';

export function WaterSheet({
  open,
  date,
  logs,
  glass,
  targetMl,
  onClose,
}: {
  open: boolean;
  date: string;
  logs: WaterLog[];
  glass: number;
  targetMl: number;
  onClose: () => void;
}) {
  const units = useUnitSystem();
  const [custom, setCustom] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const total = sumWater(logs);
  // Typed in the units on screen, stored in whole millilitres (§22).
  const ml = custom === '' ? NaN : waterEntryMl(Number(custom), units);
  const customValid = Number.isFinite(ml) && ml >= WATER_ENTRY_MIN_ML && ml <= WATER_ENTRY_MAX_ML;
  const presets = waterChoices(units, WATER_PRESETS_ML, WATER_PRESETS_FL_OZ);
  const glasses = waterChoices(units, GLASS_CHOICES_ML, GLASS_CHOICES_FL_OZ);

  const add = async (amount: number) => {
    await addWater(date, amount);
    setCustom('');
    setCustomOpen(false);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Water">
      <div className="flex items-end justify-between">
        <div className="display">
          {units === 'us'
            ? waterTotalValue(total, units)
            : (total / 1000).toLocaleString(undefined, {
                maximumFractionDigits: 2,
                minimumFractionDigits: 1,
              })}
          <span className="ml-1.5 text-[22px] font-medium text-muted">
            {units === 'us' ? 'fl oz' : 'L'}
          </span>
        </div>
        <div className="pb-2 text-right text-[14px] text-muted tabular">
          of {formatWaterTotal(targetMl, units)}
          {total < targetMl ? (
            <span className="block text-[13px]">
              {formatWaterAmount(targetMl - total, units)} to go
            </span>
          ) : (
            <span className="block text-[13px] font-semibold text-accent-2">Target reached</span>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {presets.map((p) => (
          <Chip key={p.ml} icon={GlassWater} onClick={() => void add(p.ml)}>
            {p.label} {units === 'us' ? 'fl oz' : 'ml'}
          </Chip>
        ))}
        <Chip active={customOpen} onClick={() => setCustomOpen((v) => !v)}>
          Other
        </Chip>
      </div>

      {customOpen && (
        <div className="mt-4 space-y-3">
          <div className="text-[22px] font-bold tabular">
            {custom === '' ? <span className="text-surface-3">0</span> : custom}
            <span className="ml-1 text-[15px] font-medium text-muted">
              {units === 'us' ? 'fl oz' : 'ml'}
            </span>
          </div>
          <NumberPad
            onChange={(u) => setCustom((prev) => u(prev))}
            onSubmit={() => customValid && void add(ml)}
            maxDigits={units === 'us' ? 3 : 4}
          />
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!customValid}
            onClick={() => void add(ml)}
          >
            Add {customValid ? formatWaterAmount(ml, units) : ''}
          </Button>
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 px-1 text-[13px] font-semibold text-muted">Today</p>
          <div className="card divide-y divide-line">
            {logs.map((l) => (
              <SwipeRow
                key={l.id}
                onDelete={() => {
                  void deleteWater(l.id).then(() =>
                    toast('Glass removed', { label: 'Undo', run: () => restoreWater(l.id) }),
                  );
                }}
              >
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 text-[15px] tabular">
                    {formatWaterAmount(l.ml, units)}
                  </span>
                  <span className="text-[13px] text-muted tabular">
                    {new Date(l.logged_at).toLocaleTimeString(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                  <IconButton
                    icon={Trash2}
                    label={`Remove ${formatWaterAmount(l.ml, units)}`}
                    size={18}
                    className="-mr-2 h-9 w-9 text-muted"
                    onClick={() => void deleteWater(l.id)}
                  />
                </div>
              </SwipeRow>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3 px-1">
        <span className="text-[13px] leading-tight text-muted">
          Glass size
          <span className="block text-[12px]">
            what + adds, in {units === 'us' ? 'fl oz' : 'ml'}
          </span>
        </span>
        <div className="flex gap-1.5">
          {glasses.map((g) => {
            // A glass is stored in whole ml, so 8 fl oz comes back as 237: within a millilitre
            // is the same glass.
            const on = Math.abs(g.ml - glass) <= 1;
            return (
              <button
                key={g.ml}
                type="button"
                aria-pressed={on}
                aria-label={`Glass size ${formatWaterAmount(g.ml, units)}`}
                onClick={() => void setSetting(WATER_GLASS_KEY, g.ml)}
                className={`h-8 rounded-full px-2.5 text-[13px] tabular transition-colors ${
                  on ? 'bg-primary font-semibold text-on-primary' : 'bg-surface-2 text-ink-2'
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

/** Amounts to offer, in the units shown: millilitres as they are, or fluid ounces as ml. */
function waterChoices(
  units: UnitSystem,
  ml: readonly number[],
  flOz: readonly number[],
): { ml: number; label: string }[] {
  return units === 'us'
    ? flOz.map((oz) => ({ ml: flOzToMl(oz), label: String(oz) }))
    : ml.map((m) => ({ ml: m, label: fmt(m) }));
}
