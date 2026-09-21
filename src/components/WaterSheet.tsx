// SPEC §17.1 — water sheet: presets, a custom amount, the day's list with undo, glass size.
import { GlassWater, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { WaterLog } from '@/core/types';
import {
  WATER_GLASS_KEY,
  WATER_PRESETS_ML,
  formatLitres,
  formatWater,
  sumWater,
} from '@/core/water';
import { setSetting } from '@/db/repo/settings';
import { addWater, deleteWater, restoreWater } from '@/db/repo/water';
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
              <SwipeRow
                key={l.id}
                onDelete={() => {
                  void deleteWater(l.id).then(() =>
                    toast('Glass removed', { label: 'Undo', run: () => restoreWater(l.id) }),
                  );
                }}
              >
                <div className="flex items-center gap-3 px-4 py-2.5">
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
              </SwipeRow>
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
