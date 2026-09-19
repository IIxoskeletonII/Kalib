// Grams → entry, for a database food. Used by search, favourites and entry editing.
import { useMemo, useState } from 'react';
import { scaleFood } from '@/core/nutrition';
import { MEAL_SLOTS, type EntryMethod, type Food, type MealSlot } from '@/core/types';
import { deleteEntry } from '@/db/repo/logEntries';
import { logFood, rescaleEntry } from '@/services/logging';
import { NumberPad } from './NumberPad';
import { Button, Chip, Sheet, fmt } from './ui';

export interface AmountSheetProps {
  open: boolean;
  food: Food | undefined;
  date: string;
  initialGrams?: number | undefined;
  initialSlot: MealSlot;
  /** When set, saves update this entry instead of creating one. */
  entryId?: string | undefined;
  entryMethod: Extract<EntryMethod, 'search' | 'favourite'>;
  /** Dismissed without saving. */
  onClose: () => void;
  /** Saved or deleted; defaults to onClose. */
  onSaved?: (() => void) | undefined;
}

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

export function AmountSheet(p: AmountSheetProps) {
  return (
    <Sheet open={p.open} onClose={p.onClose}>
      {/* Mounted fresh per food/entry so the form state starts from props. */}
      {p.open && p.food && (
        <AmountForm key={`${p.food.id}:${p.entryId ?? ''}`} {...p} food={p.food} />
      )}
    </Sheet>
  );
}

function AmountForm(p: AmountSheetProps & { food: Food }) {
  const [grams, setGrams] = useState(p.initialGrams != null ? String(p.initialGrams) : '');
  const [slot, setSlot] = useState<MealSlot>(p.initialSlot);
  const [busy, setBusy] = useState(false);

  const g = Number(grams) || 0;
  const preview = useMemo(() => scaleFood(p.food, g), [p.food, g]);
  const done = p.onSaved ?? p.onClose;

  const save = async () => {
    if (g <= 0 || busy) return;
    setBusy(true);
    try {
      if (p.entryId) await rescaleEntry(p.entryId, p.food, g, slot);
      else
        await logFood({
          food: p.food,
          grams: g,
          meal_slot: slot,
          date: p.date,
          entry_method: p.entryMethod,
        });
      done();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!p.entryId) return;
    await deleteEntry(p.entryId);
    done();
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="line-clamp-2 text-lg font-semibold leading-tight">{p.food.name}</h2>
        {p.food.brand && <p className="text-sm text-muted">{p.food.brand}</p>}
      </div>

      <div className="flex items-end justify-between">
        <div className="tabular text-5xl font-semibold">
          {grams === '' ? <span className="text-line">0</span> : grams}
          <span className="ml-1 text-2xl text-muted">g</span>
        </div>
        <div className="text-right text-sm text-muted tabular">
          <div className="text-lg text-ink">{fmt(preview.kcal)} kcal</div>
          <div>
            P {fmt(preview.protein_g)} · C {fmt(preview.carb_g)} · F {fmt(preview.fat_g)} · Fib{' '}
            {fmt(preview.fiber_g)}
          </div>
        </div>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
        <Chip onClick={() => setGrams('100')} active={grams === '100'}>
          100 g
        </Chip>
        {p.food.portions.map((po) => (
          <Chip
            key={po.label}
            onClick={() => setGrams(String(po.grams))}
            active={grams === String(po.grams)}
          >
            {po.label} · {fmt(po.grams)} g
          </Chip>
        ))}
      </div>

      <div className="flex gap-2">
        {MEAL_SLOTS.map((s) => (
          <Chip key={s} active={slot === s} onClick={() => setSlot(s)} className="flex-1 px-0">
            {SLOT_LABEL[s]}
          </Chip>
        ))}
      </div>

      <NumberPad onChange={setGrams} onSubmit={save} decimal maxDigits={5} />

      <div className="flex gap-2">
        {p.entryId && (
          <Button variant="danger" onClick={remove} className="px-3">
            Delete
          </Button>
        )}
        <Button variant="primary" onClick={save} disabled={g <= 0 || busy} className="flex-1">
          {p.entryId ? 'Update' : 'Log'}
          {g > 0 ? ` · ${fmt(preview.kcal)} kcal` : ''}
        </Button>
      </div>
    </div>
  );
}
