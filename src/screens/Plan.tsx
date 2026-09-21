// SPEC §18 — plan the week: a deck of your recipes (swipe right = in, left = not this week),
// portions scaled to the targets, then the shopping list.
import {
  Check,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  Minus,
  Pin,
  Plus,
  ShoppingBag,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { NumberPad } from '@/components/NumberPad';
import { Button, Card, EmptyState, IconButton, SectionHeading, Sheet, fmt } from '@/components/ui';
import { fromDateKey, addDays } from '@/core/dates';
import type { RecipeFacts } from '@/core/planner';
import type { Recipe } from '@/core/types';
import { useBack } from '@/hooks/useBack';
import { usePlan } from '@/hooks/useData';
import {
  decide,
  planRows,
  setAllowance,
  setDays,
  setPortions,
  thisWeek,
  undecide,
  unpin,
  type PlanContext,
} from '@/services/planner';

export default function Plan() {
  const back = useBack('/coach');
  const navigate = useNavigate();
  const week = thisWeek();
  const ctx = usePlan(week);
  const [allowanceOpen, setAllowanceOpen] = useState(false);
  const range = `${fromDateKey(week).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${fromDateKey(addDays(week, 6)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;

  return (
    <div className="pb-32">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="flex-1">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">Plan the week</h1>
          <p className="text-[13px] text-muted">{range}</p>
        </div>
        {ctx && ctx.scaled.items.length > 0 && (
          <Button
            size="sm"
            variant="primary"
            icon={ShoppingBag}
            onClick={() => navigate('/plan/shopping')}
          >
            List
          </Button>
        )}
      </div>

      {ctx && ctx.recipes.length === 0 && (
        <EmptyState
          icon={ChefHat}
          title="Nothing to plan with yet"
          body="The planner works from your recipes. Add the things you actually cook and they become cards here."
          action={
            <Button variant="primary" onClick={() => navigate('/recipes')}>
              Add a recipe
            </Button>
          }
        />
      )}

      {ctx && ctx.recipes.length > 0 && (
        <>
          {ctx.deck.length > 0 ? (
            <Deck ctx={ctx} />
          ) : (
            <Card className="mt-5 px-5 py-4 text-[14px] text-muted">
              Every recipe has an answer for this week.
              {ctx.skipped.length > 0 && (
                <>
                  {' '}
                  Skipped: {ctx.skipped.map((r) => r.name).join(', ')}.{' '}
                  <button
                    type="button"
                    className="font-semibold text-accent"
                    onClick={() => {
                      for (const r of ctx.skipped) void undecide(ctx, r.id);
                    }}
                  >
                    Offer them again
                  </button>
                </>
              )}
            </Card>
          )}

          <section className="mt-7">
            <SectionHeading trailing={`${ctx.draft.days} days`}>This week</SectionHeading>
            {planRows(ctx).length === 0 ? (
              <Card className="px-5 py-4 text-[14px] text-muted">
                Swipe a card right to put it in the week.
              </Card>
            ) : (
              <Card className="divide-y divide-line">
                {planRows(ctx).map(({ item, facts, portion_g, pinned }) => (
                  <PlanRow
                    key={item.recipe_id}
                    facts={facts}
                    portions={item.portions}
                    portion_g={portion_g}
                    pinned={pinned}
                    currency={ctx.currency}
                    cost={costPerPortion(ctx, facts, portion_g)}
                    onChange={(n) => void setPortions(ctx, item.recipe_id, n)}
                    onUnpin={() => void unpin(ctx, item.recipe_id)}
                  />
                ))}
              </Card>
            )}
          </section>

          <section className="mt-7">
            <SectionHeading>Fit</SectionHeading>
            <Card className="px-5 py-4">
              <FitBar
                label="Calories a day"
                value={ctx.scaled.kcal_per_day + ctx.draft.allowance_kcal}
                target={ctx.inputs.kcal}
                unit="kcal"
              />
              <FitBar
                label="Protein a day"
                value={ctx.scaled.protein_per_day + ctx.draft.allowance_protein_g}
                target={ctx.inputs.protein_g}
                unit="g"
                className="mt-4"
                overIsFine
              />
              <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[13px]">
                <button type="button" className="text-left" onClick={() => setAllowanceOpen(true)}>
                  <span className="block font-semibold text-ink-2">Outside the plan</span>
                  <span className="block text-muted tabular">
                    {fmt(ctx.draft.allowance_kcal)} kcal · {fmt(ctx.draft.allowance_protein_g)} g
                    protein a day
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  <IconButton
                    icon={Minus}
                    label="Fewer days"
                    size={16}
                    className="h-8 w-8 bg-surface-2"
                    disabled={ctx.draft.days <= 1}
                    onClick={() => void setDays(ctx, ctx.draft.days - 1)}
                  />
                  <span className="w-14 text-center text-[13px] tabular">
                    {ctx.draft.days} days
                  </span>
                  <IconButton
                    icon={Plus}
                    label="More days"
                    size={16}
                    className="h-8 w-8 bg-surface-2"
                    disabled={ctx.draft.days >= 14}
                    onClick={() => void setDays(ctx, ctx.draft.days + 1)}
                  />
                </div>
              </div>
            </Card>
            <p className="mt-3 px-1 text-[12px] leading-snug text-muted">
              Portions are set so the week lands on your target; pin a count to fix it and the rest
              re-scales. Breakfasts and snacks you eat regardless go under “outside the plan”.
            </p>
          </section>

          {ctx.scaled.items.length > 0 && (
            <Link
              to="/plan/shopping"
              className="mt-6 flex items-center gap-3.5 rounded-[24px] bg-primary px-5 py-4 text-on-primary"
            >
              <ShoppingBag size={20} aria-hidden />
              <span className="flex-1">
                <span className="block text-[16px] font-semibold">Shopping list</span>
                <span className="block text-[13px] opacity-70 tabular">
                  {ctx.list.aisles.reduce((a, g) => a + g.lines.length, 0)} items
                  {ctx.list.total_cost > 0 &&
                    ` · about ${ctx.currency}${ctx.list.total_cost.toFixed(0)}`}
                </span>
              </span>
              <ChevronRight size={18} aria-hidden />
            </Link>
          )}

          <Sheet
            open={allowanceOpen}
            onClose={() => setAllowanceOpen(false)}
            title="Outside the plan"
          >
            {allowanceOpen && (
              <AllowanceForm
                kcal={ctx.draft.allowance_kcal}
                protein={ctx.draft.allowance_protein_g}
                onSave={async (k, p) => {
                  await setAllowance(ctx, k, p);
                  setAllowanceOpen(false);
                }}
              />
            )}
          </Sheet>
        </>
      )}
    </div>
  );
}

function costPerPortion(ctx: PlanContext, f: RecipeFacts, portion_g: number): number | undefined {
  if (f.yield_g <= 0) return undefined;
  let cost = 0;
  let priced = 0;
  for (const it of f.recipe.items) {
    const p = ctx.prices.get(it.food_id);
    if (!p) continue;
    cost += (it.grams / 1000) * p.price_per_kg;
    priced++;
  }
  if (priced === 0) return undefined;
  return (cost * portion_g) / f.yield_g;
}

/** One card at a time; drag horizontally, or use the buttons. */
function Deck({ ctx }: { ctx: PlanContext }) {
  const recipe = ctx.deck[0]!;
  const facts = ctx.facts.find((f) => f.recipe.id === recipe.id)!;
  const [dx, setDx] = useState(0);
  const [flying, setFlying] = useState<'left' | 'right' | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const cost = costPerPortion(ctx, facts, facts.portion_g);
  const fit = ctx.inputs.kcal > 0 ? facts.portion_kcal / ctx.inputs.kcal : 0;

  const commit = (dir: 'left' | 'right') => {
    setFlying(dir);
    window.setTimeout(() => {
      void decide(ctx, recipe.id, dir === 'right');
      setFlying(null);
      setDx(0);
    }, 220);
  };

  const rot = dx / 18;
  const x = flying === 'right' ? 600 : flying === 'left' ? -600 : dx;
  const yesOpacity = Math.min(1, Math.max(0, dx / 90));
  const noOpacity = Math.min(1, Math.max(0, -dx / 90));

  return (
    <section className="mt-5">
      <SectionHeading trailing={`${ctx.deck.length} to decide`}>This one?</SectionHeading>
      <div className="relative select-none" style={{ touchAction: 'pan-y' }}>
        <div
          key={recipe.id}
          className={`card rise-in relative p-5 ${flying || dx === 0 ? 'transition-transform duration-300 ease-[var(--ease-spring)]' : ''}`}
          style={{ transform: `translateX(${x}px) rotate(${rot}deg)` }}
          onPointerDown={(e) => {
            start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            setDx(e.clientX - start.current.x);
          }}
          onPointerUp={() => {
            if (!start.current) return;
            start.current = null;
            if (dx > 110) commit('right');
            else if (dx < -110) commit('left');
            else setDx(0);
          }}
          onPointerCancel={() => {
            start.current = null;
            setDx(0);
          }}
        >
          <span
            className="absolute top-4 left-4 rounded-full bg-accent px-3 py-1 text-[12px] font-bold text-on-accent"
            style={{ opacity: yesOpacity }}
          >
            THIS WEEK
          </span>
          <span
            className="absolute top-4 right-4 rounded-full bg-surface-3 px-3 py-1 text-[12px] font-bold text-ink-2"
            style={{ opacity: noOpacity }}
          >
            NOT THIS WEEK
          </span>
          <div className="mt-6 flex items-center gap-2 text-[13px] font-semibold text-muted">
            <ChefHat size={14} className="text-accent" aria-hidden />
            {recipe.items.length} ingredients · {recipe.portions} portions
          </div>
          <h3 className="mt-1 text-[26px] leading-tight font-extrabold tracking-[-0.02em]">
            {recipe.name}
          </h3>
          <div className="mt-4 grid grid-cols-3 gap-3 tabular">
            <Stat label="Per portion" value={fmt(facts.portion_kcal)} unit="kcal" />
            <Stat label="Protein" value={fmt(facts.portion_protein_g)} unit="g" />
            <Stat label="Fiber" value={fmt(facts.portion_fiber_g)} unit="g" />
          </div>
          <p className="mt-4 text-[13px] text-muted tabular">
            One portion is {Math.round(fit * 100)}% of a day
            {cost != null && ` · about ${ctx.currency}${cost.toFixed(2)} a portion`}
            {cost == null && ' · no prices yet'}
          </p>
        </div>
      </div>
      <div className="mt-4 flex justify-center gap-6">
        <button
          type="button"
          aria-label="Not this week"
          onClick={() => commit('left')}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-ink-2 shadow-card transition-transform duration-200 active:scale-90"
        >
          <X size={24} strokeWidth={2.4} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="This week"
          onClick={() => commit('right')}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-card transition-transform duration-200 active:scale-90"
        >
          <Check size={26} strokeWidth={2.6} aria-hidden />
        </button>
      </div>
    </section>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <div className="text-[12px] font-semibold text-muted">{label}</div>
      <div className="mt-0.5 text-[20px] leading-none font-bold tracking-[-0.02em]">
        {value}
        <span className="ml-1 text-[12px] font-medium text-muted">{unit}</span>
      </div>
    </div>
  );
}

function PlanRow({
  facts,
  portions,
  portion_g,
  pinned,
  currency,
  cost,
  onChange,
  onUnpin,
}: {
  facts: RecipeFacts;
  portions: number;
  portion_g: number;
  pinned: boolean;
  currency: string;
  cost: number | undefined;
  onChange: (n: number) => void;
  onUnpin: () => void;
}) {
  const kcal = (facts.portion_kcal * portion_g) / Math.max(1, facts.portion_g);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[16px] font-medium">
          <span className="truncate">{facts.recipe.name}</span>
          {pinned && (
            <button
              type="button"
              aria-label="Unpin portions"
              onClick={onUnpin}
              className="text-accent"
            >
              <Pin size={14} aria-hidden />
            </button>
          )}
        </span>
        <span className="block text-[13px] text-muted tabular">
          {fmt(portion_g)} g · {fmt(kcal)} kcal a portion
          {cost != null && ` · ${currency}${((cost * portions) / 1).toFixed(2)}`}
        </span>
      </span>
      <div className="flex items-center gap-1">
        <IconButton
          icon={Minus}
          label="Fewer portions"
          size={16}
          className="h-9 w-9 bg-surface-2"
          onClick={() => onChange(portions - 1)}
        />
        <span className="w-7 text-center text-[16px] font-semibold tabular">{portions}</span>
        <IconButton
          icon={Plus}
          label="More portions"
          size={16}
          className="h-9 w-9 bg-surface-2"
          onClick={() => onChange(portions + 1)}
        />
      </div>
    </div>
  );
}

function FitBar({
  label,
  value,
  target,
  unit,
  className = '',
  overIsFine = false,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  className?: string;
  /** Protein: more than the target is not a problem. */
  overIsFine?: boolean;
}) {
  const ratio = target > 0 ? value / target : 0;
  const tone =
    ratio >= 0.95 && (ratio <= 1.05 || overIsFine)
      ? 'bg-accent'
      : ratio > 1.05
        ? 'bg-fat'
        : 'bg-kcal';
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-semibold text-ink-2">{label}</span>
        <span className="text-muted tabular">
          <span className="font-semibold text-ink">{fmt(value)}</span> / {fmt(target)} {unit}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${tone} transition-[width] duration-700 ease-[var(--ease-out-soft)]`}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

function AllowanceForm({
  kcal,
  protein,
  onSave,
}: {
  kcal: number;
  protein: number;
  onSave: (kcal: number, protein: number) => Promise<void>;
}) {
  const [field, setField] = useState<'kcal' | 'protein'>('kcal');
  const [values, setValues] = useState({
    kcal: String(kcal || ''),
    protein: String(protein || ''),
  });
  const [pristine, setPristine] = useState(true);
  return (
    <div className="space-y-4">
      <p className="text-[14px] text-muted">
        What you eat every day outside the plan — breakfast, snacks, the latte. The planner leaves
        room for it.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(['kcal', 'protein'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              setField(f);
              setPristine(true);
            }}
            className={`card px-4 py-3 text-left ${field === f ? 'ring-2 ring-accent' : ''}`}
          >
            <div className="text-[12px] font-semibold text-muted">
              {f === 'kcal' ? 'Calories' : 'Protein'}
            </div>
            <div className="text-[22px] font-bold tabular">
              {values[f] || <span className="text-surface-3">0</span>}
              <span className="ml-1 text-[12px] font-medium text-muted">
                {f === 'kcal' ? 'kcal' : 'g'}
              </span>
            </div>
          </button>
        ))}
      </div>
      <NumberPad
        onChange={(u) => {
          setValues((v) => ({ ...v, [field]: u(pristine ? '' : v[field]) }));
          setPristine(false);
        }}
        onSubmit={() => (field === 'kcal' ? (setField('protein'), setPristine(true)) : undefined)}
        maxDigits={4}
      />
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        onClick={() => void onSave(Number(values.kcal) || 0, Number(values.protein) || 0)}
      >
        Save
      </Button>
    </div>
  );
}

export type { Recipe };
