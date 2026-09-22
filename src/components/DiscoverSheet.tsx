// SPEC §18.6 — the form behind "Discover": a weekly budget, preference cards, how many
// dinners, what to avoid. One tap asks the server; the cards land in the planner's deck.
import { Minus, Plus, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DISCOVER_TAGS } from '@/core/discover';
import {
  DEFAULT_INPUTS,
  getDiscoverInputs,
  requestSuggestions,
  type DiscoverInputs,
} from '@/services/discover';
import type { PlanContext } from '@/services/planner';
import { NumberPad } from './NumberPad';
import { Button, Chip } from './ui';

export function DiscoverSheet({
  ctx,
  onDone,
}: {
  ctx: PlanContext;
  onDone: (added: number) => void;
}) {
  const [inputs, setInputs] = useState<DiscoverInputs | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetText, setBudgetText] = useState('');
  const [pristine, setPristine] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getDiscoverInputs().then((i) => {
      if (cancelled) return;
      const budget = ctx.budget || i.budget;
      setInputs({ ...i, budget });
      setBudgetText(budget ? String(budget) : '');
    });
    return () => {
      cancelled = true;
    };
  }, [ctx.budget]);

  if (!inputs) return null;
  const i = inputs;
  const toggleTag = (id: string) =>
    setInputs({
      ...i,
      tags: i.tags.includes(id) ? i.tags.filter((t) => t !== id) : [...i.tags, id].slice(-6),
    });

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await requestSuggestions(ctx, { ...i, budget: Number(budgetText) || 0 });
      onDone(r.added);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-[14px] text-muted">
        New recipes, written for your targets, themed on what food publishers are cooking this week.
        Swipe right and it becomes one of yours, ingredients and steps included.
      </p>

      <div>
        <button
          type="button"
          onClick={() => {
            setBudgetOpen((o) => !o);
            setPristine(true);
          }}
          className={`card flex w-full items-center justify-between px-4 py-3 text-left ${budgetOpen ? 'ring-2 ring-accent' : ''}`}
        >
          <span>
            <span className="block text-[12px] font-semibold text-muted">Weekly budget</span>
            <span className="block text-[22px] font-bold tabular">
              {budgetText ? (
                <>
                  <span className="mr-0.5 text-[15px] font-medium text-muted">{ctx.currency}</span>
                  {budgetText}
                </>
              ) : (
                <span className="text-muted">none</span>
              )}
            </span>
          </span>
          <span className="text-[13px] text-muted">{budgetOpen ? 'done' : 'set'}</span>
        </button>
        {budgetOpen && (
          <div className="mt-3">
            <NumberPad
              onChange={(u) => {
                setBudgetText((v) => u(pristine ? '' : v));
                setPristine(false);
              }}
              onSubmit={() => setBudgetOpen(false)}
              maxDigits={5}
            />
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-[12px] font-semibold text-muted">I want them…</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Preferences">
          {DISCOVER_TAGS.map((t) => (
            <Chip key={t.id} active={i.tags.includes(t.id)} onClick={() => toggleTag(t.id)}>
              {t.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold text-ink-2">Dinners to suggest</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Fewer"
            disabled={i.count <= 2}
            onClick={() => setInputs({ ...i, count: i.count - 1 })}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 disabled:opacity-40"
          >
            <Minus size={16} aria-hidden />
          </button>
          <span className="w-8 text-center text-[16px] font-semibold tabular">{i.count}</span>
          <button
            type="button"
            aria-label="More"
            disabled={i.count >= 8}
            onClick={() => setInputs({ ...i, count: i.count + 1 })}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 disabled:opacity-40"
          >
            <Plus size={16} aria-hidden />
          </button>
        </div>
      </div>

      <label className="block">
        <span className="mb-2 block text-[12px] font-semibold text-muted">
          Avoid (allergies, dislikes, what is already in the fridge)
        </span>
        <input
          type="text"
          value={i.avoid}
          onChange={(e) => setInputs({ ...i, avoid: e.target.value.slice(0, 200) })}
          placeholder="no pork, no mushrooms, we have rice"
          className="h-12 w-full rounded-full bg-surface-2 px-5 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
        />
      </label>

      <button
        type="button"
        role="switch"
        aria-checked={i.include_bank}
        onClick={() => setInputs({ ...i, include_bank: !i.include_bank })}
        className="flex w-full items-center justify-between text-left"
      >
        <span>
          <span className="block text-[14px] font-semibold text-ink-2">
            Include recipes others kept
          </span>
          <span className="block text-[12px] text-muted">
            Up to two from the shared bank, instant and free
          </span>
        </span>
        <span
          className={`inline-block h-7 w-12 rounded-full p-0.5 transition-colors ${i.include_bank ? 'bg-accent' : 'bg-surface-3'}`}
        >
          <span
            className={`block h-6 w-6 rounded-full bg-white shadow transition-transform ${i.include_bank ? 'translate-x-5' : ''}`}
          />
        </span>
      </button>

      {note && <p className="text-[13px] text-danger">{note}</p>}

      <Button
        variant="primary"
        size="lg"
        icon={Sparkles}
        className="w-full"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? 'Writing recipes… about ten seconds' : `Suggest ${i.count} recipes`}
      </Button>
      <p className="text-center text-[12px] text-muted">
        Counts as one estimate toward the daily cap. Defaults to {DEFAULT_INPUTS.count} when unsure.
      </p>
    </div>
  );
}
