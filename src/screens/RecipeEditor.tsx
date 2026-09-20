// SPEC §8.2 — build a recipe: ingredients by weight, the cooked weight, portions; cook a
// batch; log a portion. Every change rewrites the materialised food.
import { ChefHat, ChevronLeft, Flame, Minus, Plus, Scale, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AmountSheet } from '@/components/AmountSheet';
import { NumberPad } from '@/components/NumberPad';
import { Button, Card, IconButton, ListRow, SectionHeading, Sheet, fmt } from '@/components/ui';
import { fromDateKey, mealSlotForTime, todayKey } from '@/core/dates';
import { scaleFood } from '@/core/nutrition';
import {
  effectiveYield,
  formatPortions,
  portionGrams,
  rawWeight,
  recipeTotals,
} from '@/core/recipes';
import type { Batch, Recipe } from '@/core/types';
import {
  useActiveBatches,
  useBatchesForRecipe,
  useFood,
  useRecipe,
  useRecipeFoods,
} from '@/hooks/useData';
import {
  cookBatch,
  deleteRecipe,
  removeRecipeItem,
  renameRecipe,
  setRecipeItemGrams,
  setRecipePortions,
  setRecipeYield,
} from '@/services/recipes';

export default function RecipeEditor() {
  const { id } = useParams();
  const recipe = useRecipe(id);
  const navigate = useNavigate();
  if (recipe === undefined) return null;
  if (recipe === null) {
    navigate('/recipes', { replace: true });
    return null;
  }
  return <Editor key={recipe.id} recipe={recipe} />;
}

function Editor({ recipe }: { recipe: Recipe }) {
  const navigate = useNavigate();
  const foods = useRecipeFoods(recipe.items);
  const food = useFood(recipe.food_id);
  const batches = useBatchesForRecipe(recipe.id);
  const active = useActiveBatches();
  const [name, setName] = useState(recipe.name);
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [yieldOpen, setYieldOpen] = useState(false);
  const [cookOpen, setCookOpen] = useState(false);
  const [logging, setLogging] = useState<Batch | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const totals = foods ? recipeTotals(recipe.items, foods) : undefined;
  const raw = rawWeight(recipe.items);
  const yieldG = effectiveYield(recipe);
  const portion = portionGrams(recipe);
  const perPortion = totals && yieldG > 0 ? scaleTotals(totals, portion / yieldG) : undefined;
  const activeBatch = active?.find((a) => a.recipe.id === recipe.id)?.batch;
  const today = todayKey();

  const commitName = () => {
    if (name.trim() && name.trim() !== recipe.name) void renameRecipe(recipe.id, name);
    else if (!name.trim()) setName(recipe.name);
  };

  return (
    <div className="pb-32">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={() => navigate('/recipes')} />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          aria-label="Recipe name"
          className="h-11 min-w-0 flex-1 rounded-full bg-transparent px-2 text-[22px] font-bold tracking-[-0.01em] outline-none focus:bg-surface-2"
        />
      </div>

      <Card className="mt-4 px-5 py-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[14px] font-semibold text-ink-2">Per portion</span>
          <span className="text-[13px] text-muted tabular">
            {fmt(portion)} g · {recipe.portions} portions
          </span>
        </div>
        <div className="mt-2 flex items-end justify-between gap-4">
          <div className="tabular text-[34px] leading-none font-extrabold tracking-[-0.03em]">
            {perPortion ? fmt(perPortion.kcal) : '–'}
            <span className="ml-1 text-[14px] font-medium text-muted">kcal</span>
          </div>
          {perPortion && (
            <div className="flex gap-3 pb-1 text-[12px] tabular">
              <Macro c="text-protein" v={perPortion.protein_g} l="protein" />
              <Macro c="text-carb" v={perPortion.carb_g} l="carbs" />
              <Macro c="text-fat" v={perPortion.fat_g} l="fat" />
              <Macro c="text-fiber" v={perPortion.fiber_g} l="fiber" />
            </div>
          )}
        </div>
      </Card>

      <section className="mt-6">
        <SectionHeading trailing={raw > 0 ? `${fmt(raw)} g raw` : undefined}>
          Ingredients
        </SectionHeading>
        <Card className="divide-y divide-line">
          {recipe.items.map((it, i) => {
            const f = foods?.get(it.food_id);
            const kcal = f ? scaleFood(f, it.grams).kcal : undefined;
            return (
              <ListRow
                key={`${it.food_id}:${i}`}
                onClick={() => setEditingItem(i)}
                wrapTitle
                title={it.name}
                subtitle={f ? undefined : 'Food no longer available'}
                value={`${fmt(it.grams)} g`}
                valueSub={kcal != null ? `${fmt(kcal)} kcal` : undefined}
              />
            );
          })}
          <ListRow
            onClick={() => navigate(`/log?recipe=${recipe.id}`)}
            icon={Plus}
            iconTone="accent"
            title="Add ingredient"
            subtitle="Search, scan, or one of your own foods"
          />
        </Card>
      </section>

      <section className="mt-6">
        <SectionHeading>After cooking</SectionHeading>
        <Card className="divide-y divide-line">
          <ListRow
            onClick={() => setYieldOpen(true)}
            icon={Scale}
            title="Cooked weight"
            subtitle={recipe.yield_g ? 'Weighed after cooking' : 'Not weighed yet (raw weight)'}
            value={`${fmt(yieldG)} g`}
            chevron
          />
          <div className="flex min-h-16 items-center gap-3.5 px-4 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
              <ChefHat size={18} strokeWidth={2.2} aria-hidden />
            </span>
            <span className="flex-1 text-[16px] font-medium">Portions</span>
            <div className="flex items-center gap-1">
              <IconButton
                icon={Minus}
                label="Fewer portions"
                size={18}
                className="h-10 w-10 bg-surface-2"
                disabled={recipe.portions <= 1}
                onClick={() => void setRecipePortions(recipe.id, recipe.portions - 1)}
              />
              <span className="w-8 text-center tabular text-[17px] font-semibold">
                {recipe.portions}
              </span>
              <IconButton
                icon={Plus}
                label="More portions"
                size={18}
                className="h-10 w-10 bg-surface-2"
                onClick={() => void setRecipePortions(recipe.id, recipe.portions + 1)}
              />
            </div>
          </div>
        </Card>
      </section>

      <div className="mt-6 grid grid-cols-2 gap-2">
        <Button
          variant="primary"
          size="lg"
          icon={Flame}
          disabled={recipe.items.length === 0}
          onClick={() => setCookOpen(true)}
        >
          Cook batch
        </Button>
        <Button
          size="lg"
          disabled={recipe.items.length === 0 || !food}
          onClick={() => setLogging(activeBatch ?? null)}
        >
          Log portion
        </Button>
      </div>

      {batches && batches.length > 0 && (
        <section className="mt-6">
          <SectionHeading>Batches</SectionHeading>
          <Card className="divide-y divide-line">
            {batches.slice(0, 5).map((b) => (
              <ListRow
                key={b.id}
                onClick={b.portions_remaining > 0 ? () => setLogging(b) : undefined}
                title={`Cooked ${fromDateKey(b.cooked_on).toLocaleDateString(undefined, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}`}
                subtitle={`${fmt(b.total_g)} g · ${b.portions_total} portions`}
                value={
                  b.portions_remaining > 0
                    ? `${formatPortions(b.portions_remaining)} left`
                    : 'Finished'
                }
              />
            ))}
          </Card>
        </section>
      )}

      <div className="mt-8 flex justify-center">
        <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>
          Delete recipe
        </Button>
      </div>

      {/* Ingredient grams */}
      <Sheet
        open={editingItem != null}
        onClose={() => setEditingItem(null)}
        title={editingItem != null ? recipe.items[editingItem]?.name : undefined}
      >
        {editingItem != null && recipe.items[editingItem] && (
          <GramsForm
            key={editingItem}
            initial={recipe.items[editingItem].grams}
            label="Save"
            onRemove={async () => {
              await removeRecipeItem(recipe.id, editingItem);
              setEditingItem(null);
            }}
            onSave={async (g) => {
              await setRecipeItemGrams(recipe.id, editingItem, g);
              setEditingItem(null);
            }}
          />
        )}
      </Sheet>

      {/* Cooked weight */}
      <Sheet open={yieldOpen} onClose={() => setYieldOpen(false)} title="Cooked weight">
        {yieldOpen && (
          <>
            <p className="mb-4 text-[14px] text-muted">
              Weigh the finished pot (minus the pot). Water lost or absorbed changes the weight, not
              the nutrients — this is what makes each portion’s figure exact.
            </p>
            <GramsForm
              initial={recipe.yield_g ?? raw}
              label="Save"
              onSave={async (g) => {
                await setRecipeYield(recipe.id, g);
                setYieldOpen(false);
              }}
            />
          </>
        )}
      </Sheet>

      {/* Cook a batch */}
      <Sheet open={cookOpen} onClose={() => setCookOpen(false)} title="Cook a batch">
        {cookOpen && (
          <CookForm
            recipe={recipe}
            initialGrams={recipe.yield_g ?? raw}
            onDone={() => setCookOpen(false)}
          />
        )}
      </Sheet>

      <AmountSheet
        open={logging !== undefined}
        food={food ?? undefined}
        date={today}
        initialGrams={
          logging ? Math.round(logging.total_g / logging.portions_total) : Math.round(portion)
        }
        initialSlot={mealSlotForTime(new Date())}
        entryMethod={logging ? 'batch' : 'search'}
        batch={logging ? { batch: logging, recipe } : undefined}
        onClose={() => setLogging(undefined)}
        onSaved={() => navigate('/', { replace: true })}
      />

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete recipe?">
        <p className="text-[14px] text-muted">
          Past entries keep their values. The recipe leaves search and Log again.
        </p>
        <div className="mt-4 flex gap-2">
          <Button size="lg" className="flex-1" onClick={() => setConfirmDelete(false)}>
            Keep
          </Button>
          <Button
            variant="danger"
            size="lg"
            className="flex-1 bg-danger/10"
            onClick={async () => {
              await deleteRecipe(recipe.id);
              navigate('/recipes', { replace: true });
            }}
          >
            Delete
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function GramsForm({
  initial,
  label,
  onSave,
  onRemove,
}: {
  initial: number;
  label: string;
  onSave: (grams: number) => Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  const [value, setValue] = useState(initial > 0 ? String(Math.round(initial)) : '');
  const [pristine, setPristine] = useState(initial > 0);
  const g = Number(value) || 0;
  const type = (u: (prev: string) => string) => {
    setValue((prev) => u(pristine ? '' : prev));
    setPristine(false);
  };
  return (
    <div className="space-y-4">
      <div className="display">
        {value === '' ? <span className="text-surface-3">0</span> : value}
        <span className="ml-1.5 text-[22px] font-medium text-muted">g</span>
      </div>
      <NumberPad onChange={type} onSubmit={() => g > 0 && void onSave(g)} maxDigits={5} />
      <div className="flex gap-2">
        {onRemove && (
          <IconButton
            icon={Trash2}
            label="Remove ingredient"
            className="h-14 w-14 rounded-[14px] bg-surface-2 text-danger"
            onClick={() => void onRemove()}
          />
        )}
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          disabled={g <= 0}
          onClick={() => void onSave(g)}
        >
          {label}
        </Button>
      </div>
    </div>
  );
}

function CookForm({
  recipe,
  initialGrams,
  onDone,
}: {
  recipe: Recipe;
  initialGrams: number;
  onDone: () => void;
}) {
  const [value, setValue] = useState(initialGrams > 0 ? String(Math.round(initialGrams)) : '');
  const [pristine, setPristine] = useState(initialGrams > 0);
  const [portions, setPortions] = useState(recipe.portions);
  const [busy, setBusy] = useState(false);
  const g = Number(value) || 0;
  const type = (u: (prev: string) => string) => {
    setValue((prev) => u(pristine ? '' : prev));
    setPristine(false);
  };
  const cook = async () => {
    if (g <= 0 || busy) return;
    setBusy(true);
    await cookBatch(recipe, g, portions);
    onDone();
  };
  return (
    <div className="space-y-4">
      <p className="text-[14px] text-muted">
        Weigh the cooked pot and say how many portions it makes. Each portion then logs in one tap
        from Today.
      </p>
      <div className="flex items-end justify-between">
        <div className="display">
          {value === '' ? <span className="text-surface-3">0</span> : value}
          <span className="ml-1.5 text-[22px] font-medium text-muted">g</span>
        </div>
        <div className="flex items-center gap-1 pb-2">
          <IconButton
            icon={Minus}
            label="Fewer portions"
            size={18}
            className="h-10 w-10 bg-surface-2"
            disabled={portions <= 1}
            onClick={() => setPortions((p) => p - 1)}
          />
          <span className="w-24 text-center text-[15px] whitespace-nowrap tabular">
            <span className="font-semibold">{portions}</span>{' '}
            <span className="text-muted">{portions === 1 ? 'portion' : 'portions'}</span>
          </span>
          <IconButton
            icon={Plus}
            label="More portions"
            size={18}
            className="h-10 w-10 bg-surface-2"
            onClick={() => setPortions((p) => p + 1)}
          />
        </div>
      </div>
      {g > 0 && <p className="text-[13px] text-muted tabular">{fmt(g / portions)} g per portion</p>}
      <NumberPad onChange={type} onSubmit={cook} maxDigits={5} />
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={g <= 0 || busy}
        onClick={cook}
      >
        Start the batch
      </Button>
    </div>
  );
}

function scaleTotals<
  T extends { kcal: number; protein_g: number; carb_g: number; fat_g: number; fiber_g: number },
>(t: T, f: number) {
  return {
    kcal: t.kcal * f,
    protein_g: t.protein_g * f,
    carb_g: t.carb_g * f,
    fat_g: t.fat_g * f,
    fiber_g: t.fiber_g * f,
  };
}

function Macro({ c, v, l }: { c: string; v: number; l: string }) {
  return (
    <span className="text-muted">
      <span className={`font-medium ${c}`}>{fmt(v)}</span> {l}
    </span>
  );
}
