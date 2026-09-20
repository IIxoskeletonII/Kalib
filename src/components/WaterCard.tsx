// SPEC §17.1 — water. One tap adds a glass; the card opens a sheet for other amounts, the
// day's list and undo.
import { Droplets, GlassWater, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { WaterLog } from '@/core/types';
import {
  DEFAULT_GLASS_ML,
  WATER_GLASS_KEY,
  WATER_PRESETS_ML,
  formatLitres,
  formatWater,
  sumWater,
} from '@/core/water';
import { setSetting } from '@/db/repo/settings';
import { addWater, deleteWater } from '@/db/repo/water';
import { useSetting, useWaterLogs } from '@/hooks/useData';
import { NumberPad } from './NumberPad';
import { Button, Chip, IconButton, Sheet, fmt } from './ui';

export function WaterCard({ date, targetMl }: { date: string; targetMl: number }) {
  const logs = useWaterLogs(date);
  const glass = useSetting<number>(WATER_GLASS_KEY, DEFAULT_GLASS_ML);
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(0);
  const total = sumWater(logs ?? []);
  const pct = targetMl > 0 ? Math.min(1, total / targetMl) : 0;
  const done = targetMl > 0 && total >= targetMl;

  const addGlass = async () => {
    await addWater(date, glass);
    setPulse((n) => n + 1);
  };

  return (
    <>
      <div className="card flex items-center gap-4 px-5 py-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-w-0 flex-1 text-left transition-transform duration-200 ease-[var(--ease-out-soft)] active:scale-[0.985]"
          aria-label="Water details"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-2/15 text-accent-2">
              <Droplets size={16} strokeWidth={2.4} aria-hidden />
            </span>
            <span className="text-[14px] font-semibold text-ink-2">Water</span>
            {logs && logs.length > 0 && (
              <span className="ml-auto text-[13px] text-muted tabular">
                {logs.length} {logs.length === 1 ? 'glass' : 'glasses'}
              </span>
            )}
          </div>
          <div className="mt-3 flex items-baseline gap-1 tabular">
            <span
              key={pulse}
              className={`text-[24px] font-bold tracking-[-0.02em] ${pulse ? 'fade-in' : ''}`}
            >
              {(total / 1000).toLocaleString(undefined, {
                maximumFractionDigits: 1,
                minimumFractionDigits: 1,
              })}
            </span>
            <span className="text-[13px] text-muted">/ {formatLitres(targetMl)}</span>
            {done && <span className="ml-2 text-[12px] font-semibold text-accent-2">Done</span>}
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent-2 transition-[width] duration-700 ease-[var(--ease-out-soft)]"
              style={{ width: `${pct * 100}%` }}
            />
          </div>
        </button>
        <button
          type="button"
          onClick={addGlass}
          aria-label={`Add ${glass} ml of water`}
          className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full bg-accent-2 text-on-accent shadow-[0_6px_18px_color-mix(in_srgb,var(--accent-2)_30%,transparent)] transition-transform duration-200 ease-[var(--ease-out-soft)] active:scale-90"
        >
          <Plus size={22} strokeWidth={2.6} aria-hidden />
        </button>
      </div>
      <WaterSheet
        open={open}
        date={date}
        logs={logs ?? []}
        glass={glass}
        targetMl={targetMl}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function WaterSheet({
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
  const [custom, setCustom] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const total = sumWater(logs);
  const ml = Number(custom);
  const customValid = Number.isFinite(ml) && ml >= 10 && ml <= 3000;

  const add = async (amount: number) => {
    await addWater(date, amount);
    setCustom('');
    setCustomOpen(false);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Water">
      <div className="flex items-end justify-between">
        <div className="display">
          {(total / 1000).toLocaleString(undefined, {
            maximumFractionDigits: 2,
            minimumFractionDigits: 1,
          })}
          <span className="ml-1.5 text-[22px] font-medium text-muted">L</span>
        </div>
        <div className="pb-2 text-right text-[14px] text-muted tabular">
          of {formatLitres(targetMl)}
          {total < targetMl ? (
            <span className="block text-[13px]">{formatWater(targetMl - total)} to go</span>
          ) : (
            <span className="block text-[13px] font-semibold text-accent-2">Target reached</span>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {WATER_PRESETS_ML.map((p) => (
          <Chip key={p} icon={GlassWater} onClick={() => void add(p)}>
            {p} ml
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
            <span className="ml-1 text-[15px] font-medium text-muted">ml</span>
          </div>
          <NumberPad
            onChange={(u) => setCustom((prev) => u(prev))}
            onSubmit={() => customValid && void add(ml)}
            maxDigits={4}
          />
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!customValid}
            onClick={() => void add(ml)}
          >
            Add {customValid ? formatWater(ml) : ''}
          </Button>
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 px-1 text-[13px] font-semibold text-muted">Today</p>
          <div className="card divide-y divide-line">
            {logs.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1 text-[15px] tabular">{formatWater(l.ml)}</span>
                <span className="text-[13px] text-muted tabular">
                  {new Date(l.logged_at).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
                <IconButton
                  icon={Trash2}
                  label={`Remove ${formatWater(l.ml)}`}
                  size={18}
                  className="-mr-2 h-9 w-9 text-muted"
                  onClick={() => void deleteWater(l.id)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3 px-1">
        <span className="text-[13px] leading-tight text-muted">
          Glass size
          <span className="block text-[12px]">what + adds</span>
        </span>
        <div className="flex gap-1.5">
          {[200, 250, 330, 500].map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={g === glass}
              onClick={() => void setSetting(WATER_GLASS_KEY, g)}
              className={`h-8 rounded-full px-2.5 text-[13px] tabular transition-colors ${
                g === glass ? 'bg-primary font-semibold text-on-primary' : 'bg-surface-2 text-ink-2'
              }`}
            >
              {fmt(g)}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
