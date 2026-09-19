// Grams → entry, for a database food. Used by search, favourites and entry editing.
import { Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { useMemo, useState } from 'react';
import { scaleFood } from '@/core/nutrition';
import { MEAL_SLOTS, type EntryMethod, type Food, type MealSlot } from '@/core/types';
import { deleteEntry } from '@/db/repo/logEntries';
import { logFood, rescaleEntry } from '@/services/logging';
import { NumberPad } from './NumberPad';
import { Badge, Button, Chip, IconButton, Segmented, Sheet, fmt } from './ui';

export interface AmountSheetProps {
  open: boolean;
  food: Food | undefined;
  date: string;
  initialGrams?: number | undefined;
  initialSlot: MealSlot;
  /** When set, saves update this entry instead of creating one. */
  entryId?: string | undefined;
  entryMethod: Extract<EntryMethod, 'search' | 'favourite' | 'barcode'>;
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

export const SOURCE_LABEL: Record<Food['source'], string> = {
  usda_foundation: 'USDA',
  usda_sr: 'USDA SR',
  off: 'Open Food Facts',
  custom: 'My food',
  photo: 'Photo estimate',
};

const SLOT_OPTIONS = MEAL_SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s] }));

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
  // A prefilled amount (last time's grams, or a portion chip) is replaced by the first key
  // press rather than appended to — "150" → tap 2 → "2", not "1502".
  const [pristine, setPristine] = useState(p.initialGrams != null);
  const [slot, setSlot] = useState<MealSlot>(p.initialSlot);
  const type = (u: (prev: string) => string) => {
    setGrams((prev) => u(pristine ? '' : prev));
    setPristine(false);
  };
  const preset = (v: number) => {
    setGrams(String(v));
    setPristine(true);
  };
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

  const presets = [
    { label: '100 g', grams: 100 },
    ...p.food.portions.map((po) => ({
      label: `${po.label} · ${fmt(po.grams)} g`,
      grams: po.grams,
    })),
  ];

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Badge tone={p.food.source === 'custom' ? 'accent' : 'muted'}>
            {SOURCE_LABEL[p.food.source]}
          </Badge>
          {p.food.brand && <span className="truncate text-[13px] text-muted">{p.food.brand}</span>}
          {p.food.source === 'custom' && (
            <Link
              to={`/foods/${p.food.id}`}
              className="ml-auto inline-flex h-8 items-center gap-1 rounded-full bg-surface-2 px-3 text-[13px] font-medium text-ink-2"
            >
              <Pencil size={13} aria-hidden /> Edit
            </Link>
          )}
        </div>
        <h2 className="mt-1 line-clamp-2 text-[18px] font-semibold leading-snug">{p.food.name}</h2>
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="display">
          {grams === '' ? <span className="text-surface-3">0</span> : grams}
          <span className="ml-1.5 text-[22px] font-medium text-muted">g</span>
        </div>
        <div className="text-right">
          <div className="tabular text-[22px] font-semibold leading-none">
            {fmt(preview.kcal)}
            <span className="ml-1 text-[14px] font-normal text-muted">kcal</span>
          </div>
          <div className="mt-2 flex justify-end gap-2 text-[12px] tabular">
            <Macro c="text-protein" v={preview.protein_g} l="protein" />
            <Macro c="text-carb" v={preview.carb_g} l="carbs" />
            <Macro c="text-fat" v={preview.fat_g} l="fat" />
            <Macro c="text-fiber" v={preview.fiber_g} l="fiber" />
          </div>
        </div>
      </div>

      <div className="rail -mx-5 flex gap-2 overflow-x-auto px-5">
        {presets.map((po) => (
          <Chip key={po.label} onClick={() => preset(po.grams)} active={g === po.grams}>
            {po.label}
          </Chip>
        ))}
      </div>

      <Segmented value={slot} options={SLOT_OPTIONS} onChange={setSlot} />

      <NumberPad onChange={type} onSubmit={save} decimal maxDigits={4} />

      <div className="flex gap-2">
        {p.entryId && (
          <IconButton
            icon={Trash2}
            label="Delete entry"
            onClick={remove}
            className="h-14 w-14 rounded-[14px] bg-surface-2 text-danger"
          />
        )}
        <Button
          variant="primary"
          size="lg"
          onClick={save}
          disabled={g <= 0 || busy}
          className="flex-1"
        >
          {p.entryId ? 'Update' : 'Log'}
          {g > 0 ? ` · ${fmt(preview.kcal)} kcal` : ''}
        </Button>
      </div>
    </div>
  );
}

function Macro({ c, v, l }: { c: string; v: number; l: string }) {
  return (
    <span className="text-muted">
      <span className={`font-medium ${c}`}>{fmt(v)}</span> {l}
    </span>
  );
}
