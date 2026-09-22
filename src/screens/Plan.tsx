// SPEC §18 — plan the week: a deck of your recipes (swipe right = in, left = not this week),
// portions scaled to the targets, then the shopping list.
import {
  ChefHat,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CookingPot,
  Flame,
  Minus,
  Pin,
  Plus,
  ShoppingBag,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { DiscoverSheet } from '@/components/DiscoverSheet';
import { NumberPad } from '@/components/NumberPad';
import { SwipeCard } from '@/components/SwipeCard';
import { SwipeRow } from '@/components/SwipeRow';
import { toast } from '@/components/Toast';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  SectionHeading,
  Sheet,
  StepProgress,
  fmt,
} from '@/components/ui';
import { fromDateKey, addDays } from '@/core/dates';
import { budgetLine, DISCOVER_TAGS, suggestionFacts, type Suggestion } from '@/core/discover';
import { planSummary, type RecipeFacts } from '@/core/planner';
import type { Recipe } from '@/core/types';
import { useBack } from '@/hooks/useBack';
import { usePlan } from '@/hooks/useData';
import {
  acceptSuggestion,
  canFetchMore,
  getDiscover,
  rejectSuggestion,
  topUpIfNeeded,
  type AcceptProgress,
} from '@/services/discover';
import {
  decide,
  planRows,
  removeFromWeek,
  restoreToWeek,
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
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [fitOpen, setFitOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  /** The deck refills itself after a decision; this is only so the wait is visible. */
  const [topUp, setTopUp] = useState<'idle' | 'busy' | 'failed'>('idle');
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
          <IconButton
            icon={ShoppingBag}
            label="Shopping list"
            className="bg-primary text-on-primary"
            onClick={() => navigate('/plan/shopping')}
          />
        )}
      </div>

      {ctx && (ctx.recipes.length > 0 || ctx.suggestions.length > 0) && (
        <button
          type="button"
          onClick={() => setDiscoverOpen(true)}
          className="card mt-4 flex w-full items-center gap-3 px-4 py-3 text-left transition-transform duration-200 ease-[var(--ease-out-soft)] active:scale-[0.985]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Sparkles size={17} strokeWidth={2.2} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Discover new recipes</span>
            <span className="block truncate text-[12px] text-muted">
              A budget, your preferences, this week&rsquo;s trends
            </span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
        </button>
      )}

      {ctx && ctx.suggestions.length > 0 && <SuggestionDeck ctx={ctx} onTopUp={setTopUp} />}

      {ctx && ctx.suggestions.length === 0 && topUp !== 'idle' && (
        <section className="mt-5">
          <SectionHeading>Something new?</SectionHeading>
          <Card className="px-5 py-5">
            {topUp === 'busy' ? (
              <StepProgress label="Finding more recipes you might like…" done={1} total={1} />
            ) : (
              <p className="text-[14px] text-muted">
                Could not fetch more just now.{' '}
                <button
                  type="button"
                  className="font-semibold text-accent"
                  onClick={() => setDiscoverOpen(true)}
                >
                  Try again
                </button>
              </p>
            )}
          </Card>
        </section>
      )}

      {ctx && ctx.recipes.length === 0 && ctx.suggestions.length === 0 && (
        <EmptyState
          icon={ChefHat}
          title="Nothing to plan with yet"
          body="Ask for new recipes written for your targets and a budget, or add the things you already cook — either way they become cards here."
          action={
            <div className="flex gap-2">
              <Button variant="primary" icon={Sparkles} onClick={() => setDiscoverOpen(true)}>
                Discover recipes
              </Button>
              <Button onClick={() => navigate('/recipes')}>Add my own</Button>
            </div>
          }
        />
      )}

      {ctx && ctx.recipes.length > 0 && (
        <>
          {ctx.deck.length > 0 ? (
            <Deck ctx={ctx} />
          ) : ctx.suggestions.length > 0 ? null : (
            <Card className="mt-5 px-5 py-4 text-[14px] text-muted">
              Every recipe has an answer for this week.{' '}
              <button
                type="button"
                className="font-semibold text-accent"
                onClick={() => setDiscoverOpen(true)}
              >
                Discover new ones
              </button>
              .
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
                  <div key={item.recipe_id}>
                    <SwipeRow
                      deleteLabel="Remove"
                      onDelete={() => {
                        void removeFromWeek(ctx, item.recipe_id).then((removed) => {
                          toast(`${facts.recipe.name} is out of the week`, {
                            label: 'Undo',
                            run: () => {
                              if (removed) void restoreToWeek(ctx.week_start, removed);
                            },
                          });
                        });
                      }}
                    >
                      <PlanRow
                        facts={facts}
                        portions={item.portions}
                        portion_g={portion_g}
                        pinned={pinned}
                        currency={ctx.currency}
                        cost={costPerPortion(ctx, facts, portion_g)}
                        open={expanded === item.recipe_id}
                        onToggle={() =>
                          setExpanded(expanded === item.recipe_id ? null : item.recipe_id)
                        }
                        onChange={(n) => void setPortions(ctx, item.recipe_id, n)}
                        onUnpin={() => void unpin(ctx, item.recipe_id)}
                      />
                    </SwipeRow>
                    {expanded === item.recipe_id && (
                      <RecipeDetail
                        facts={facts}
                        portions={item.portions}
                        portion_g={portion_g}
                        onCook={() => navigate(`/recipes/${facts.recipe.id}/cook`)}
                        onOpen={() => navigate(`/recipes/${facts.recipe.id}`)}
                      />
                    )}
                  </div>
                ))}
              </Card>
            )}
          </section>

          <section className="mt-7">
            <SectionHeading
              trailing={
                <button type="button" className="text-accent" onClick={() => setFitOpen(true)}>
                  Details
                </button>
              }
            >
              Fit
            </SectionHeading>
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
              {ctx.budget > 0 && <BudgetRow ctx={ctx} />}
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
              re-scales. Swipe a row left to take it out of the week. Breakfasts and snacks you eat
              regardless go under “outside the plan”.
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

      {ctx && (
        <Sheet open={fitOpen} onClose={() => setFitOpen(false)} title="The week at a glance">
          {fitOpen && (
            <FitDetail
              ctx={ctx}
              onAllowance={() => {
                setFitOpen(false);
                setAllowanceOpen(true);
              }}
              onBudget={() => {
                setFitOpen(false);
                setDiscoverOpen(true);
              }}
            />
          )}
        </Sheet>
      )}

      {ctx && (
        <Sheet open={discoverOpen} onClose={() => setDiscoverOpen(false)} title="Discover">
          {discoverOpen && (
            <DiscoverSheet
              ctx={ctx}
              onDone={(added) => {
                setDiscoverOpen(false);
                toast(
                  added === 0
                    ? 'Nothing new came back — try other preferences.'
                    : `${added} new ${added === 1 ? 'recipe is' : 'recipes are'} in the deck.`,
                );
              }}
            />
          )}
        </Sheet>
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
  const cost = costPerPortion(ctx, facts, facts.portion_g);
  const fit = ctx.inputs.kcal > 0 ? facts.portion_kcal / ctx.inputs.kcal : 0;

  return (
    <section className="mt-5">
      <SectionHeading trailing={`${ctx.deck.length} to decide`}>This one?</SectionHeading>
      <SwipeCard
        key={recipe.id}
        id={recipe.id}
        onCommit={(dir) => void decide(ctx, recipe.id, dir === 'right')}
        yesLabel="This week"
        noLabel="Not this week"
        yesStamp="THIS WEEK"
        noStamp="NOT THIS WEEK"
      >
        <div className="mt-6 flex items-center gap-2 text-[13px] font-semibold text-muted">
          <ChefHat size={14} className="text-accent" aria-hidden />
          {recipe.items.length} ingredients · {recipe.portions} portions
          {recipe.time_min ? ` · ${recipe.time_min} min` : ''}
        </div>
        <h3 className="mt-1 text-[26px] leading-tight font-extrabold tracking-[-0.02em]">
          {recipe.name}
        </h3>
        {recipe.blurb && <p className="mt-1 text-[14px] text-muted">{recipe.blurb}</p>}
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
      </SwipeCard>
    </section>
  );
}

const ACCEPT_LABEL: Record<AcceptProgress['stage'], string> = {
  matching: 'Matching ingredients to your food database…',
  saving: 'Saving the recipe and its steps…',
  week: 'Putting it in the week…',
};

/** §18.6 — suggestion cards come before the user's own; accepting one makes it theirs. */
function SuggestionDeck({
  ctx,
  onTopUp,
}: {
  ctx: PlanContext;
  onTopUp: (state: 'idle' | 'busy' | 'failed') => void;
}) {
  const s: Suggestion = ctx.suggestions[0]!;
  const [progress, setProgress] = useState<AcceptProgress | null>(null);
  const facts = suggestionFacts(s);
  const fit = ctx.inputs.kcal > 0 ? facts.portion_kcal / ctx.inputs.kcal : 0;
  const tagLabel = (id: string) => DISCOVER_TAGS.find((t) => t.id === id)?.label ?? id;
  const busy = progress !== null;

  /** Keep the deck stocked so a run of "not for me" never empties it (§18.6). */
  const refill = async () => {
    const state = await getDiscover(ctx.week_start);
    if (!canFetchMore(state)) return;
    onTopUp('busy');
    try {
      await topUpIfNeeded(ctx);
      onTopUp('idle');
    } catch {
      // Nothing was asked for out loud, so nothing shouts: the deck says so quietly instead.
      onTopUp('failed');
    }
  };

  const commit = async (dir: 'left' | 'right') => {
    if (dir === 'left') {
      await rejectSuggestion(ctx.week_start, s);
      void refill();
      return;
    }
    setProgress({ stage: 'matching', done: 0, total: s.ingredients.length });
    try {
      await acceptSuggestion(ctx, s, setProgress);
      toast(`${s.name} is yours now — ingredients matched, steps kept.`);
      void refill();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <section className="mt-5">
      <SectionHeading trailing={`${ctx.suggestions.length} new to decide`}>
        Something new?
      </SectionHeading>
      <SwipeCard
        key={s.name}
        id={s.name}
        busy={busy}
        onCommit={(dir) => void commit(dir)}
        yesLabel="Keep it and put it in the week"
        noLabel="Not for me"
        yesStamp="KEEP IT"
        noStamp="NOT FOR ME"
        className="border border-accent/30"
      >
        <div className="mt-6 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-muted">
          <Badge tone="accent">{s.from_bank ? 'Others kept it' : 'New'}</Badge>
          <span className="flex items-center gap-1">
            <Clock size={13} aria-hidden />
            {s.time_min} min
          </span>
          {s.oven_c != null && (
            <span className="flex items-center gap-1">
              <Flame size={13} aria-hidden />
              {s.oven_c} °C
            </span>
          )}
          <span>· {s.portions} portions</span>
        </div>
        <h3 className="mt-1 text-[26px] leading-tight font-extrabold tracking-[-0.02em]">
          {s.name}
        </h3>
        {s.blurb && <p className="mt-1 text-[14px] text-muted">{s.blurb}</p>}
        <div className="mt-4 grid grid-cols-3 gap-3 tabular">
          <Stat label="Per portion" value={`≈ ${fmt(facts.portion_kcal)}`} unit="kcal" />
          <Stat label="Protein" value={`≈ ${fmt(facts.portion_protein_g)}`} unit="g" />
          <Stat label="Fiber" value={`≈ ${fmt(facts.portion_fiber_g)}`} unit="g" />
        </div>
        <p className="mt-4 text-[13px] text-muted tabular">
          About {Math.round(fit * 100)}% of a day · ≈ {ctx.currency}
          {facts.portion_cost.toFixed(2)} a portion (estimate)
        </p>
        {s.tags.length > 0 && (
          <p className="mt-2 text-[12px] text-muted">{s.tags.map(tagLabel).join(' · ')}</p>
        )}
        {s.inspiration && (
          <p className="mt-2 text-[12px] text-muted">
            Themed on this week&rsquo;s <span className="text-ink-2">{s.inspiration}</span>
          </p>
        )}
        <p className="mt-3 text-[12px] text-muted">
          {s.ingredients.length} ingredients · {s.steps.length} steps
        </p>
      </SwipeCard>
      {progress && (
        <Card className="mt-4 px-5 py-4">
          <StepProgress
            label={ACCEPT_LABEL[progress.stage]}
            done={progress.stage === 'matching' ? progress.done : progress.total}
            total={progress.total}
          />
        </Card>
      )}
    </section>
  );
}

/** §18.6 — the week's list against the budget, honest about how much is estimated. */
function BudgetRow({ ctx }: { ctx: PlanContext }) {
  const b = budgetLine(ctx.list, ctx.budget);
  const tone = b.share > 1 ? 'bg-fat' : b.share > 0.85 ? 'bg-kcal' : 'bg-accent';
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-semibold text-ink-2">Budget</span>
        <span className="text-muted tabular">
          <span className="font-semibold text-ink">
            ≈ {ctx.currency}
            {b.cost.toFixed(0)}
          </span>{' '}
          / {ctx.currency}
          {b.budget}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${tone} transition-[width] duration-700 ease-[var(--ease-out-soft)]`}
          style={{ width: `${Math.min(100, Math.round(b.share * 100))}%` }}
        />
      </div>
      <p className="mt-1.5 text-[12px] text-muted">
        {b.unpriced > 0 ? `${b.unpriced} unpriced` : 'every item priced'}
        {b.estimated > 0 ? ` · ${b.estimated} estimated` : ''}
        {b.share > 1 ? ' · over budget' : ''}
      </p>
    </div>
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
  open,
  onToggle,
  onChange,
  onUnpin,
}: {
  facts: RecipeFacts;
  portions: number;
  portion_g: number;
  pinned: boolean;
  currency: string;
  cost: number | undefined;
  open: boolean;
  onToggle: () => void;
  onChange: (n: number) => void;
  onUnpin: () => void;
}) {
  const kcal = (facts.portion_kcal * portion_g) / Math.max(1, facts.portion_g);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <ChevronDown
          size={16}
          aria-hidden
          className={`shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[16px] font-medium">
            <span className="truncate">{facts.recipe.name}</span>
            {pinned && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Unpin portions"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnpin();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    onUnpin();
                  }
                }}
                className="text-accent"
              >
                <Pin size={14} aria-hidden />
              </span>
            )}
          </span>
          <span className="block text-[13px] text-muted tabular">
            {fmt(portion_g)} g · {fmt(kcal)} kcal a portion
            {cost != null && ` · ${currency}${((cost * portions) / 1).toFixed(2)}`}
          </span>
        </span>
      </button>
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

/** What is in the dish and how it is made, without leaving the plan. */
function RecipeDetail({
  facts,
  portions,
  portion_g,
  onCook,
  onOpen,
}: {
  facts: RecipeFacts;
  portions: number;
  portion_g: number;
  onCook: () => void;
  onOpen: () => void;
}) {
  const recipe = facts.recipe;
  // Grams to buy for the week: the recipe's own amounts at the scaled portions (§18.3).
  const scale = facts.yield_g > 0 ? (portion_g * portions) / facts.yield_g : 0;
  const steps = recipe.steps ?? [];
  return (
    <div className="rise-in border-t border-line bg-surface-2/40 px-4 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold text-muted">
        <span>{recipe.items.length} ingredients</span>
        {recipe.time_min ? (
          <span className="flex items-center gap-1">
            <Clock size={12} aria-hidden />
            {recipe.time_min} min
          </span>
        ) : null}
        {recipe.oven_c ? (
          <span className="flex items-center gap-1">
            <Flame size={12} aria-hidden />
            {recipe.oven_c} °C
          </span>
        ) : null}
        <span>· {portions} portions this week</span>
      </div>
      {recipe.blurb && <p className="mt-2 text-[13px] text-muted">{recipe.blurb}</p>}

      <ul className="mt-3 space-y-1.5">
        {recipe.items.map((it, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="min-w-0 truncate">{it.name.split(',').slice(0, 2).join(',')}</span>
            <span className="shrink-0 text-muted tabular">
              {fmt(it.grams * scale)} g<span className="ml-1 text-[11px]">for the week</span>
            </span>
          </li>
        ))}
      </ul>

      {steps.length > 0 ? (
        <ol className="mt-4 space-y-2">
          {steps.map((st, i) => (
            <li key={i} className="flex gap-2.5 text-[14px] leading-snug">
              <span className="w-4 shrink-0 text-right font-semibold text-muted tabular">
                {i + 1}
              </span>
              <span className="text-ink-2">{st}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-[13px] text-muted">
          No steps written for this one yet — open it to add them.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button size="sm" variant="primary" icon={CookingPot} className="flex-1" onClick={onCook}>
          Cook it
        </Button>
        <Button size="sm" onClick={onOpen}>
          Open recipe
        </Button>
      </div>
    </div>
  );
}

/** §18.2 — the numbers behind the bars, and the levers that move them. */
function FitDetail({
  ctx,
  onAllowance,
  onBudget,
}: {
  ctx: PlanContext;
  onAllowance: () => void;
  onBudget: () => void;
}) {
  const s = planSummary(ctx.scaled, ctx.facts, ctx.inputs, ctx.list.total_cost);
  const money = (n: number) => `${ctx.currency}${n.toFixed(2)}`;
  const GAP: Record<string, string> = {
    calories: 'kcal',
    protein: 'g of protein',
    fiber: 'g of fiber',
  };
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[14px] text-muted">
          {s.recipes === 0
            ? 'Nothing in the week yet — swipe a card right and these numbers fill in.'
            : `${s.portions} portions from ${s.recipes} ${s.recipes === 1 ? 'recipe' : 'recipes'}, spread over ${ctx.draft.days} days.`}
        </p>
      </div>

      <Card className="divide-y divide-line">
        <FitLine
          label="Calories a day"
          value={s.kcal}
          target={s.kcal_target}
          unit="kcal"
          note="the plan plus what you eat outside it"
        />
        <FitLine
          label="Protein a day"
          value={s.protein_g}
          target={s.protein_target}
          unit="g"
          overIsFine
          note="more than the target is fine"
        />
        <FitLine
          label="Fiber a day"
          value={s.fiber_g}
          target={s.fiber_target}
          unit="g"
          overIsFine
          note="from the planned meals alone"
        />
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Portions a day" value={s.portions_per_day.toFixed(1)} unit="cooked" />
        <Stat label="Cooked weight" value={fmt(s.grams / 1000)} unit="kg" />
        <Stat
          label="Cost a day"
          value={s.cost_per_day > 0 ? money(s.cost_per_day) : '—'}
          unit={ctx.list.estimated > 0 ? 'estimated' : 'from your prices'}
        />
        <Stat
          label="Cost a portion"
          value={s.cost_per_portion > 0 ? money(s.cost_per_portion) : '—'}
          unit={ctx.budget > 0 ? `of ${ctx.currency}${ctx.budget} a week` : 'no budget set'}
        />
      </div>

      {s.shortest && (
        <Card className="px-4 py-3">
          <p className="text-[14px]">
            <span className="font-semibold">
              {s.shortest_gap} {GAP[s.shortest]}
            </span>{' '}
            short a day.{' '}
            {s.shortest === 'fiber' && 'Beans, lentils and whole grains close it fastest.'}
            {s.shortest === 'protein' && 'Pin one more portion of your highest-protein recipe.'}
            {s.shortest === 'calories' &&
              'Either cook more portions, or raise what you eat outside the plan.'}
          </p>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onAllowance}>
          Outside the plan
        </Button>
        <Button size="sm" onClick={onBudget}>
          {ctx.budget > 0 ? 'Change the budget' : 'Set a budget'}
        </Button>
      </div>

      <p className="text-[12px] leading-snug text-muted">
        Portions are whole, so the week lands near your target rather than exactly on it; the gram
        size of a portion is nudged by up to 30 % to close the rest. Fiber has no plan target of its
        own — 14 g per 1000 kcal is the guideline the coach uses.
      </p>
    </div>
  );
}

function FitLine({
  label,
  value,
  target,
  unit,
  note,
  overIsFine = false,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  note: string;
  overIsFine?: boolean;
}) {
  const ratio = target > 0 ? value / target : 0;
  const ok = ratio >= 0.95 && (ratio <= 1.05 || overIsFine);
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between text-[14px]">
        <span className="font-semibold text-ink-2">{label}</span>
        <span className="tabular text-muted">
          <span className={`font-semibold ${ok ? 'text-accent' : 'text-ink'}`}>{fmt(value)}</span> /{' '}
          {fmt(target)} {unit}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${ok ? 'bg-accent' : ratio > 1.05 ? 'bg-fat' : 'bg-kcal'} transition-[width] duration-700 ease-[var(--ease-out-soft)]`}
          style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
        />
      </div>
      <p className="mt-1 text-[12px] text-muted">{note}</p>
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
