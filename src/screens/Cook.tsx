// SPEC §18.4 — cooking mode: the ingredient list scaled to the pot being cooked, then one step
// at a time in large type, ending on Cook batch so the pot is weighed and logs in one tap.
import { ChevronLeft, ChevronRight, Flame, Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { NumberPad } from '@/components/NumberPad';
import { Button, Card, IconButton, Sheet, fmt } from '@/components/ui';
import { rawWeight } from '@/core/recipes';
import type { Recipe } from '@/core/types';
import { useBack } from '@/hooks/useBack';
import { useRecipe } from '@/hooks/useData';
import { cookBatch } from '@/services/recipes';

export default function Cook() {
  const { id } = useParams();
  const recipe = useRecipe(id);
  const navigate = useNavigate();
  if (recipe === undefined) return null;
  if (recipe === null) {
    navigate('/recipes', { replace: true });
    return null;
  }
  return <CookView key={recipe.id} recipe={recipe} />;
}

function CookView({ recipe }: { recipe: Recipe }) {
  const back = useBack(`/recipes/${recipe.id}`);
  const navigate = useNavigate();
  const [mult, setMult] = useState(1);
  const [step, setStep] = useState(-1); // -1 = ingredients
  const [cookOpen, setCookOpen] = useState(false);
  const steps = recipe.steps ?? [];
  const raw = rawWeight(recipe.items);
  const last = step >= steps.length - 1;

  return (
    <div className="flex h-full flex-col pb-6">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="flex-1">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">{recipe.name}</h1>
          <p className="text-[13px] text-muted">
            {step < 0 ? 'Ingredients' : `Step ${step + 1} of ${steps.length}`}
            {recipe.time_min ? ` · ${recipe.time_min} min` : ''}
            {recipe.oven_c ? ` · oven ${recipe.oven_c} °C` : ''}
          </p>
        </div>
        {step < 0 && (
          <div className="flex items-center gap-1">
            <IconButton
              icon={Minus}
              label="Smaller batch"
              size={16}
              className="h-9 w-9 bg-surface-2"
              disabled={mult <= 0.5}
              onClick={() => setMult((m) => Math.max(0.5, m - 0.5))}
            />
            <span className="w-8 text-center text-[14px] font-semibold tabular">{mult}×</span>
            <IconButton
              icon={Plus}
              label="Bigger batch"
              size={16}
              className="h-9 w-9 bg-surface-2"
              onClick={() => setMult((m) => Math.min(4, m + 0.5))}
            />
          </div>
        )}
      </div>

      <div className="mt-5 flex-1">
        {step < 0 ? (
          <Card className="divide-y divide-line">
            {recipe.items.map((it, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between gap-3 px-4 py-3 text-[16px]"
              >
                <span className="min-w-0 truncate">{it.name.split(',').slice(0, 2).join(',')}</span>
                <span className="shrink-0 font-semibold tabular">{fmt(it.grams * mult)} g</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between px-4 py-3 text-[13px] text-muted tabular">
              <span>Raw weight</span>
              <span>{fmt(raw * mult)} g</span>
            </div>
          </Card>
        ) : (
          <Card key={step} className="rise-in min-h-[220px] p-6">
            <p className="text-[24px] leading-snug font-semibold tracking-[-0.01em]">
              {steps[step]}
            </p>
          </Card>
        )}
        {steps.length === 0 && step < 0 && (
          <p className="mt-3 px-1 text-[13px] text-muted">
            No steps written for this recipe yet — add them from the recipe page, one line each.
          </p>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        {step >= 0 && (
          <Button size="lg" icon={ChevronLeft} onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
        )}
        {!last || steps.length === 0 ? (
          steps.length > 0 ? (
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              onClick={() => setStep((s) => s + 1)}
            >
              {step < 0 ? 'Start cooking' : 'Next'}
              <ChevronRight size={18} aria-hidden />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              icon={Flame}
              onClick={() => setCookOpen(true)}
            >
              Cook batch
            </Button>
          )
        ) : (
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            icon={Flame}
            onClick={() => setCookOpen(true)}
          >
            Done — weigh the pot
          </Button>
        )}
      </div>

      <Sheet open={cookOpen} onClose={() => setCookOpen(false)} title="Cook a batch">
        {cookOpen && (
          <BatchForm
            initialGrams={(recipe.yield_g ?? raw) * mult}
            portions={Math.round(recipe.portions * mult)}
            onDone={async (g, p) => {
              await cookBatch(recipe, g, p);
              navigate('/', { replace: true });
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function BatchForm({
  initialGrams,
  portions: initialPortions,
  onDone,
}: {
  initialGrams: number;
  portions: number;
  onDone: (grams: number, portions: number) => Promise<void>;
}) {
  const [value, setValue] = useState(initialGrams > 0 ? String(Math.round(initialGrams)) : '');
  const [pristine, setPristine] = useState(initialGrams > 0);
  const [portions, setPortions] = useState(Math.max(1, initialPortions));
  const g = Number(value) || 0;
  return (
    <div className="space-y-4">
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
      <NumberPad
        onChange={(u) => {
          setValue((prev) => u(pristine ? '' : prev));
          setPristine(false);
        }}
        onSubmit={() => g > 0 && void onDone(g, portions)}
        maxDigits={5}
      />
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={g <= 0}
        onClick={() => void onDone(g, portions)}
      >
        Start the batch
      </Button>
    </div>
  );
}
