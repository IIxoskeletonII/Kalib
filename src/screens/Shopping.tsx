// SPEC §18.3 — the shopping list by aisle, with check-off, prices entered once, and Share.
import { Check, ChevronLeft, Share2 } from 'lucide-react';
import { useState } from 'react';
import { NumberPad } from '@/components/NumberPad';
import { Button, Card, IconButton, SectionHeading, Sheet, fmt } from '@/components/ui';
import { shoppingListText, type ShoppingLine } from '@/core/planner';
import { useBack } from '@/hooks/useBack';
import { usePlan } from '@/hooks/useData';
import { shareText } from '@/platform/share';
import { savePrice, thisWeek, toggleChecked } from '@/services/planner';

export default function Shopping() {
  const back = useBack('/plan');
  const ctx = usePlan(thisWeek());
  const [pricing, setPricing] = useState<ShoppingLine | null>(null);
  const [shared, setShared] = useState(false);

  const share = async () => {
    if (!ctx) return;
    const r = await shareText('Kalib — shopping list', shoppingListText(ctx.list, ctx.currency));
    if (r === 'copied') {
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    }
  };

  const total = ctx?.list.aisles.reduce((a, g) => a + g.lines.length, 0) ?? 0;
  const done = ctx?.draft.checked.length ?? 0;

  return (
    <div className="pb-32">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="flex-1">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">Shopping list</h1>
          <p className="text-[13px] text-muted tabular">
            {total} items{done > 0 ? ` · ${done} in the basket` : ''}
          </p>
        </div>
        <Button size="sm" variant="primary" icon={shared ? Check : Share2} onClick={share}>
          {shared ? 'Copied' : 'Share'}
        </Button>
      </div>

      {ctx && ctx.list.aisles.length === 0 && (
        <Card className="mt-5 px-5 py-4 text-[14px] text-muted">
          Put something in the week first — the list builds itself from the plan.
        </Card>
      )}

      {ctx?.list.aisles.map((g) => (
        <section key={g.aisle} className="mt-6">
          <SectionHeading>{g.aisle}</SectionHeading>
          <Card className="divide-y divide-line">
            {g.lines.map((l) => {
              const checked = ctx.draft.checked.includes(l.food_id);
              return (
                <div key={l.food_id} className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={l.name}
                    onClick={() => void toggleChecked(ctx, l.food_id)}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-[background-color,border-color] duration-200 ${
                      checked ? 'border-accent bg-accent text-on-accent' : 'border-surface-3'
                    }`}
                  >
                    {checked && <Check size={16} strokeWidth={3} aria-hidden />}
                  </button>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => void toggleChecked(ctx, l.food_id)}
                  >
                    <span
                      className={`block truncate text-[16px] font-medium ${checked ? 'text-muted line-through' : ''}`}
                    >
                      {l.name.split(',').slice(0, 2).join(',')}
                    </span>
                    <span className="block truncate text-[13px] text-muted tabular">
                      {l.grams >= 1000 ? `${(l.grams / 1000).toFixed(2)} kg` : `${fmt(l.grams)} g`}{' '}
                      · {l.recipes.join(', ')}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPricing(l)}
                    className="shrink-0 rounded-full bg-surface-2 px-3 py-1.5 text-right text-[13px] tabular"
                    aria-label={`Price for ${l.name}`}
                  >
                    {l.cost != null ? (
                      <>
                        <span className="block font-semibold">
                          {l.estimated ? '≈ ' : ''}
                          {ctx.currency}
                          {l.cost.toFixed(2)}
                        </span>
                        <span className="block text-[11px] text-muted">
                          {l.estimated ? 'est. ' : ''}
                          {ctx.currency}
                          {l.price_per_kg!.toFixed(2)}/kg
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">price</span>
                    )}
                  </button>
                </div>
              );
            })}
          </Card>
        </section>
      ))}

      {ctx && ctx.list.aisles.length > 0 && (
        <Card className="mt-6 px-5 py-4">
          <div className="flex items-baseline justify-between tabular">
            <span className="text-[14px] font-semibold text-ink-2">This week</span>
            <span className="text-[22px] font-bold tracking-[-0.02em]">
              {ctx.list.total_cost > 0 ? `≈ ${ctx.currency}${ctx.list.total_cost.toFixed(0)}` : '—'}
              {ctx.budget > 0 && (
                <span className="text-[14px] font-medium text-muted">
                  {' '}
                  of {ctx.currency}
                  {ctx.budget}
                </span>
              )}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted">
            {ctx.list.total_cost > 0
              ? ctx.list.estimated > 0
                ? `Rough: ${ctx.list.estimated} ${ctx.list.estimated === 1 ? 'price is an estimate' : 'prices are estimates'} (≈) — tap one to enter what you paid. `
                : 'Give or take 15 %. '
              : ''}
            {ctx.list.unpriced > 0
              ? `${ctx.list.unpriced} ${ctx.list.unpriced === 1 ? 'item has' : 'items have'} no price yet — tap “price” once and it sticks, and the budget can only count what it knows.`
              : ctx.list.estimated === 0
                ? 'Every item is priced.'
                : ''}
          </p>
        </Card>
      )}

      <Sheet
        open={pricing != null}
        onClose={() => setPricing(null)}
        title={pricing?.name.split(',').slice(0, 2).join(',')}
      >
        {pricing && ctx && (
          <PriceForm
            key={pricing.food_id}
            currency={ctx.currency}
            initial={pricing.price_per_kg}
            grams={pricing.grams}
            onSave={async (perKg) => {
              await savePrice(pricing.food_id, perKg, ctx.currency);
              setPricing(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function PriceForm({
  currency,
  initial,
  grams,
  onSave,
}: {
  currency: string;
  initial: number | undefined;
  grams: number;
  onSave: (perKg: number) => Promise<void>;
}) {
  const [mode, setMode] = useState<'kg' | 'pack'>('kg');
  const [price, setPrice] = useState(initial != null ? initial.toFixed(2) : '');
  const [packG, setPackG] = useState('500');
  const [field, setField] = useState<'price' | 'pack'>('price');
  const [pristine, setPristine] = useState(true);
  const p = Number(price) || 0;
  const pack = Number(packG) || 0;
  const perKg = mode === 'kg' ? p : pack > 0 ? (p / pack) * 1000 : 0;
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5" role="radiogroup" aria-label="Price given per">
        {(['kg', 'pack'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => {
              setMode(m);
              setField('price');
              setPristine(true);
            }}
            className={`h-9 flex-1 rounded-full text-[14px] ${mode === m ? 'bg-primary font-semibold text-on-primary' : 'bg-surface-2 text-ink'}`}
          >
            {m === 'kg' ? 'Price per kg' : 'Price of a pack'}
          </button>
        ))}
      </div>
      <div className="flex items-end justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            setField('price');
            setPristine(true);
          }}
          className={`rounded-2xl px-3 py-1 text-left ${field === 'price' ? 'ring-2 ring-accent' : ''}`}
        >
          <span className="display">
            <span className="mr-1 text-[22px] font-medium text-muted">{currency}</span>
            {price === '' ? <span className="text-surface-3">0</span> : price}
          </span>
          <span className="block text-[12px] text-muted">
            {mode === 'kg' ? 'per kg' : 'per pack'}
          </span>
        </button>
        {mode === 'pack' && (
          <button
            type="button"
            onClick={() => {
              setField('pack');
              setPristine(true);
            }}
            className={`rounded-2xl px-3 py-1 text-right ${field === 'pack' ? 'ring-2 ring-accent' : ''}`}
          >
            <span className="text-[26px] font-bold tabular">
              {packG || <span className="text-surface-3">0</span>}
              <span className="ml-1 text-[13px] font-medium text-muted">g</span>
            </span>
            <span className="block text-[12px] text-muted">pack weight</span>
          </button>
        )}
      </div>
      <p className="text-[13px] text-muted tabular">
        {perKg > 0
          ? `${currency}${perKg.toFixed(2)} per kg → ${currency}${((grams / 1000) * perKg).toFixed(2)} for this week’s ${grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${fmt(grams)} g`}`
          : 'Remembered for every plan from now on.'}
      </p>
      <NumberPad
        onChange={(u) => {
          if (field === 'price') setPrice((v) => u(pristine ? '' : v));
          else setPackG((v) => u(pristine ? '' : v));
          setPristine(false);
        }}
        onSubmit={() => perKg > 0 && void onSave(Math.round(perKg * 100) / 100)}
        decimal={field === 'price'}
        maxDigits={6}
      />
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={perKg <= 0}
        onClick={() => void onSave(Math.round(perKg * 100) / 100)}
      >
        Save price
      </Button>
    </div>
  );
}
