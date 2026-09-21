// Grams → entry, for a database food. Used by search, favourites, entry editing, batch
// portions (SPEC §8.2) and, in recipe mode, adding an ingredient instead of logging.
import { Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { useMemo, useState } from 'react';
import { scaleFood } from '@/core/nutrition';
import { formatPortions } from '@/core/recipes';
import {
  UNIT_LABEL,
  densityFor,
  fromGrams,
  isLiquid,
  roundIn,
  toGrams,
  type AmountUnit,
} from '@/core/units';
import {
  MEAL_SLOTS,
  type Batch,
  type EntryMethod,
  type Food,
  type MealSlot,
  type Recipe,
} from '@/core/types';
import { logFood, rescaleEntry } from '@/services/logging';
import { addRecipeItem, logBatchPortion, removeEntry } from '@/services/recipes';
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
  entryMethod: Extract<EntryMethod, 'search' | 'favourite' | 'barcode' | 'batch'>;
  /** Logging a portion of a cooked batch: portions come off the batch (§8.2). */
  batch?: { batch: Batch; recipe: Recipe } | undefined;
  /** Recipe mode: the amount becomes an ingredient of this recipe, nothing is logged. */
  recipe?: { id: string; name: string } | undefined;
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
  usda_fndds: 'USDA FNDDS',
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
  // Amounts are typed in the chosen unit and stored in grams (SPEC §6). Liquids open in ml.
  const density = useMemo(() => densityFor(p.food), [p.food]);
  const startUnit: AmountUnit = !p.batch && !p.recipe && isLiquid(p.food) ? 'ml' : 'g';
  const [unit, setUnit] = useState<AmountUnit>(startUnit);
  const [amount, setAmount] = useState(() =>
    p.initialGrams != null
      ? String(roundIn(fromGrams(p.initialGrams, startUnit, density.g_per_ml), startUnit))
      : '',
  );
  // A prefilled amount (last time's grams, or a portion chip) is replaced by the first key
  // press rather than appended to — "150" → tap 2 → "2", not "1502".
  const [pristine, setPristine] = useState(p.initialGrams != null);
  const [slot, setSlot] = useState<MealSlot>(p.initialSlot);
  const type = (u: (prev: string) => string) => {
    setAmount((prev) => u(pristine ? '' : prev));
    setPristine(false);
  };
  const preset = (gramsValue: number) => {
    setAmount(String(roundIn(fromGrams(gramsValue, unit, density.g_per_ml), unit)));
    setPristine(true);
  };
  const switchUnit = (next: AmountUnit) => {
    if (next === unit) return;
    const current = Number(amount) || 0;
    if (current > 0) {
      const gramsNow = toGrams(current, unit, density.g_per_ml);
      setAmount(String(roundIn(fromGrams(gramsNow, next, density.g_per_ml), next)));
      setPristine(true);
    }
    setUnit(next);
  };
  const [busy, setBusy] = useState(false);

  const g = Math.round(toGrams(Number(amount) || 0, unit, density.g_per_ml) * 10) / 10;
  const preview = useMemo(() => scaleFood(p.food, g), [p.food, g]);
  const done = p.onSaved ?? p.onClose;
  const portion = p.batch ? p.batch.batch.total_g / p.batch.batch.portions_total : undefined;

  const save = async () => {
    if (g <= 0 || busy) return;
    setBusy(true);
    try {
      if (p.recipe) await addRecipeItem(p.recipe.id, p.food, g);
      else if (p.entryId) await rescaleEntry(p.entryId, p.food, g, slot);
      else if (p.batch)
        await logBatchPortion({ ...p.batch, grams: g, meal_slot: slot, date: p.date });
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
    await removeEntry(p.entryId);
    done();
  };

  const presets = portion
    ? [
        { label: `1 portion · ${fmt(portion)} g`, grams: Math.round(portion) },
        { label: '½ portion', grams: Math.round(portion / 2) },
        { label: '2 portions', grams: Math.round(portion * 2) },
      ]
    : [
        { label: '100 g', grams: 100 },
        ...p.food.portions.map((po) => ({
          label: `${po.label} · ${fmt(po.grams)} g`,
          grams: po.grams,
        })),
      ];

  const editHref = p.food.recipe_id
    ? `/recipes/${p.food.recipe_id}`
    : p.food.source === 'custom'
      ? `/foods/${p.food.id}`
      : undefined;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          {p.recipe ? (
            <Badge tone="accent">Adding to {p.recipe.name}</Badge>
          ) : (
            <Badge tone={p.food.source === 'custom' ? 'accent' : 'muted'}>
              {p.food.recipe_id ? 'Recipe' : SOURCE_LABEL[p.food.source]}
            </Badge>
          )}
          {p.batch && (
            <span className="text-[13px] text-muted tabular">
              {formatPortions(p.batch.batch.portions_remaining)} left
            </span>
          )}
          {p.food.brand && <span className="truncate text-[13px] text-muted">{p.food.brand}</span>}
          {editHref && !p.recipe && (
            <Link
              to={editHref}
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
          {amount === '' ? <span className="text-surface-3">0</span> : amount}
          <span className="ml-1.5 text-[22px] font-medium text-muted">{UNIT_LABEL[unit]}</span>
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

      <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Unit">
        {(['g', 'ml', 'oz', 'floz'] as AmountUnit[]).map((u) => (
          <button
            key={u}
            type="button"
            role="radio"
            aria-checked={u === unit}
            onClick={() => switchUnit(u)}
            className={`h-8 rounded-full px-3 text-[13px] transition-[background-color,color] duration-200 ${
              u === unit ? 'bg-primary font-semibold text-on-primary' : 'bg-surface-2 text-ink-2'
            }`}
          >
            {UNIT_LABEL[u]}
          </button>
        ))}
        {(unit === 'ml' || unit === 'floz') && (
          <span className="ml-auto text-[12px] text-muted tabular">
            {g > 0 ? `= ${fmt(g)} g` : ''}
            {density.basis === 'assumed' ? ' · 1 ml ≈ 1 g assumed' : ''}
          </span>
        )}
        {unit === 'oz' && g > 0 && (
          <span className="ml-auto text-[12px] text-muted tabular">= {fmt(g)} g</span>
        )}
      </div>

      <div className="rail -mx-5 flex gap-2 overflow-x-auto px-5">
        {presets.map((po) => (
          <Chip
            key={po.label}
            onClick={() => preset(po.grams)}
            active={Math.abs(g - po.grams) < 0.5}
          >
            {po.label}
          </Chip>
        ))}
      </div>

      {!p.recipe && <Segmented value={slot} options={SLOT_OPTIONS} onChange={setSlot} />}

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
          {p.recipe ? 'Add ingredient' : p.entryId ? 'Update' : 'Log'}
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
