import {
  Beef,
  ChefHat,
  Cookie,
  Droplets,
  Leaf,
  Moon,
  Plus,
  Scale,
  Sparkles,
  Sun,
  Sunrise,
  Wheat,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AccountChip } from '@/components/AccountChip';
import { AmountSheet, SLOT_LABEL } from '@/components/AmountSheet';
import { MacroTile } from '@/components/MacroTile';
import { Ring } from '@/components/Ring';
import { Sparkline } from '@/components/Sparkline';
import { SupplementsCard } from '@/components/SupplementsCard';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ListRow,
  SectionHeading,
  Skeleton,
  fmt,
} from '@/components/ui';
import { WeekStrip } from '@/components/WeekStrip';
import { WaterCard } from '@/components/WaterCard';
import { WeighInSheet } from '@/components/WeighInSheet';
import { addDays, formatDayLabel, fromDateKey, mealSlotForTime, todayKey } from '@/core/dates';
import { dayTotals } from '@/core/nutrition';
import type { EngineResult } from '@/core/tdee';
import { formatPortions } from '@/core/recipes';
import { computeTrend, trendDelta } from '@/core/trend';
import {
  MEAL_SLOTS,
  type Batch,
  type Food,
  type LogEntry,
  type MealSlot,
  type Recipe,
} from '@/core/types';
import { getFood } from '@/db/repo/foods';
import {
  useActiveBatches,
  useBanking,
  useCoach,
  useDailyTarget,
  useEntries,
  useFavourites,
  useLoggedDates,
  useTdee,
  useWeighIns,
} from '@/hooks/useData';
import { useCountUp } from '@/hooks/useCountUp';
import { recordChoice } from '@/services/banking';
import { acceptPendingTdee, dismissPendingTdee, type TdeeState } from '@/services/tdee';

interface SheetState {
  food: Food;
  grams?: number | undefined;
  slot: MealSlot;
  entryId?: string | undefined;
  method: 'search' | 'favourite' | 'batch';
  batch?: { batch: Batch; recipe: Recipe } | undefined;
}

const SLOT_ICON: Record<MealSlot, LucideIcon> = {
  breakfast: Sunrise,
  lunch: Sun,
  dinner: Moon,
  snack: Cookie,
};

export default function Today() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const today = todayKey();
  const date = params.get('d') ?? today;
  const setDate = (d: string) => setParams(d === today ? {} : { d }, { replace: true });

  const entries = useEntries(date);
  const target = useDailyTarget(date);
  const banking = useBanking(date);
  const weighIns = useWeighIns();
  const allFavourites = useFavourites();
  const batches = useActiveBatches();
  // A batch tile already stands for its food; do not show it twice.
  const favourites = useMemo(() => {
    if (!allFavourites) return undefined;
    const covered = new Set(batches?.map((b) => b.food.id));
    return allFavourites.filter((f) => !covered.has(f.food_id));
  }, [allFavourites, batches]);
  const tdee = useTdee();
  const coach = useCoach(date);
  const loggedDates = useLoggedDates(addDays(today, -6), today);

  const [weighOpen, setWeighOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetState | null>(null);

  const totals = useMemo(() => dayTotals(entries ?? []), [entries]);
  const trend = useMemo(() => computeTrend(weighIns ?? [], undefined, date), [weighIns, date]);
  const trendToday = trend.find((p) => p.date === date);
  const weekDelta = trendDelta(trend, 7);
  const spark = trend.slice(-14).map((p) => p.trend);
  const todaysWeighIn = weighIns?.find((w) => w.date === date);
  const previousWeighIn = weighIns?.filter((w) => w.date < date).at(-1);
  // §5: the ring runs on the banked target for the day, not the raw formula target.
  const dayTarget = banking ? Math.round(banking.todayTarget) : (target?.kcal ?? 0);
  const bankShift = target ? dayTarget - target.kcal : 0;
  const remaining = target ? dayTarget - totals.kcal : 0;
  const shownRemaining = useCountUp(Math.abs(remaining));

  const openFavourite = async (food_id: string, grams: number) => {
    const food = await getFood(food_id);
    if (food) setSheet({ food, grams, slot: mealSlotForTime(new Date()), method: 'favourite' });
  };

  const openEntry = async (e: LogEntry) => {
    if (!e.food_id) {
      navigate(`/quick/${e.id}?d=${date}`);
      return;
    }
    const food = await getFood(e.food_id);
    if (food)
      setSheet({ food, grams: e.grams, slot: e.meal_slot, entryId: e.id, method: 'search' });
  };

  const bySlot = useMemo(() => {
    const m = new Map<MealSlot, LogEntry[]>();
    for (const s of MEAL_SLOTS) m.set(s, []);
    for (const e of entries ?? []) m.get(e.meal_slot)!.push(e);
    return m;
  }, [entries]);

  const loading = entries === undefined || target === undefined;
  const dateLine = fromDateKey(date).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const provisionalNote = targetNote(target?.provisional, tdee, date === today);

  return (
    <div className="pb-32">
      <header className="pt-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-medium text-muted">{dateLine}</p>
            <h1 className="mt-0.5 text-[34px] leading-none font-extrabold tracking-[-0.03em]">
              {formatDayLabel(date, today)}
            </h1>
          </div>
          <AccountChip />
        </div>
        <div className="mt-5">
          <WeekStrip selected={date} today={today} onSelect={setDate} loggedDates={loggedDates} />
        </div>
      </header>

      {loading ? (
        <div className="card mt-6 flex flex-col items-center p-6">
          <Skeleton className="h-[180px] w-[180px] rounded-full" />
          <Skeleton className="mt-5 h-4 w-2/3" />
        </div>
      ) : target ? (
        <>
          <Card className="mt-6 px-6 pt-6 pb-5">
            <div className="flex flex-col items-center">
              <Ring value={totals.kcal} target={dayTarget}>
                <span className="display">{fmt(shownRemaining)}</span>
                <span className="mt-1.5 text-[13px] font-semibold text-muted">
                  {remaining >= 0 ? 'kcal left' : 'kcal over'}
                </span>
              </Ring>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 tabular">
              <Stat label="Eaten" value={fmt(totals.kcal)} unit="kcal" />
              <Stat
                label={
                  bankShift !== 0
                    ? `Target (${bankShift > 0 ? '+' : ''}${fmt(bankShift)} banked)`
                    : 'Target'
                }
                value={fmt(dayTarget)}
                unit="kcal"
                align="right"
              />
            </div>
            <p className="mt-3 text-center text-[12px] text-muted">{provisionalNote}</p>
          </Card>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <MacroTile
              kind="protein"
              label="Protein"
              icon={Beef}
              value={totals.protein_g}
              target={target.protein_g}
            />
            <MacroTile
              kind="fiber"
              label="Fiber"
              icon={Leaf}
              value={totals.fiber_g}
              target={target.fiber_g}
            />
            <MacroTile
              kind="carb"
              label="Carbs"
              icon={Wheat}
              value={totals.carb_g}
              target={target.carb_g}
            />
            <MacroTile
              kind="fat"
              label="Fat"
              icon={Droplets}
              value={totals.fat_g}
              target={target.fat_g}
            />
          </div>
        </>
      ) : (
        <Card className="mt-6">
          <EmptyState
            icon={Scale}
            title="No target yet"
            body="Log a weigh-in and your provisional target appears here."
            action={
              <Button variant="primary" icon={Scale} onClick={() => setWeighOpen(true)}>
                Log weigh-in
              </Button>
            }
          />
        </Card>
      )}

      <Card
        className="mt-3 flex items-center justify-between gap-4 px-5 py-4"
        onClick={() => setWeighOpen(true)}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-2">
            <Scale size={16} strokeWidth={2.2} aria-hidden className="text-accent" />
            Weight
          </div>
          <div className="mt-1.5 tabular">
            {todaysWeighIn ? (
              <span className="text-[26px] font-bold tracking-[-0.02em]">
                {todaysWeighIn.weight_kg.toFixed(1)}
                <span className="ml-1 text-[15px] font-medium text-muted">kg</span>
              </span>
            ) : previousWeighIn ? (
              <span className="text-[17px] font-medium text-muted">
                Last {previousWeighIn.weight_kg.toFixed(1)} kg
              </span>
            ) : (
              <span className="text-[17px] font-medium text-muted">Not logged yet</span>
            )}
          </div>
          {trendToday && (
            <p className="mt-0.5 text-[13px] whitespace-nowrap text-muted tabular">
              Trend {trendToday.trend.toFixed(1)} kg
              {weekDelta != null && (
                <>
                  {' · '}
                  <span className={weekDelta <= 0 ? 'text-fiber' : 'text-fat'}>
                    {weekDelta > 0 ? '+' : ''}
                    {weekDelta.toFixed(1)} kg/wk
                  </span>
                </>
              )}
            </p>
          )}
        </div>
        {todaysWeighIn && spark.length >= 2 ? (
          <Sparkline values={spark} />
        ) : (
          <span className="inline-flex h-10 shrink-0 items-center gap-1 rounded-full bg-primary px-3.5 text-[14px] font-semibold text-on-primary">
            <Plus size={15} strokeWidth={2.6} aria-hidden />
            {date === today ? 'Log weight' : 'Add weight'}
          </span>
        )}
      </Card>

      {target && <WaterCard date={date} targetMl={target.water_ml} />}

      {banking?.pending && (
        <Card className="mt-3 p-5">
          <p className="text-[15px] font-semibold">
            {new Date(banking.pending.date + 'T12:00').toLocaleDateString(undefined, {
              weekday: 'long',
            })}{' '}
            went {fmt(banking.pending.overshoot)} kcal over
          </p>
          <p className="mt-1 text-[14px] text-muted">Not a verdict — just where to take it from.</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              variant="primary"
              onClick={() => void recordChoice(banking.pending!.date, 'spread')}
            >
              Spread it
              <span className="ml-1 text-[12px] font-medium opacity-70">
                −{fmt(banking.pending.spreadPerDay)}/day
              </span>
            </Button>
            <Button onClick={() => void recordChoice(banking.pending!.date, 'tomorrow')}>
              Take it tomorrow
              <span className="ml-1 text-[12px] font-medium opacity-70">
                −{fmt(banking.pending.tomorrowCut)}
              </span>
            </Button>
          </div>
        </Card>
      )}

      {banking && target && (
        <Card className="mt-3 px-5 py-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-semibold text-ink-2">This week</span>
            <span className="tabular text-[13px] text-muted">
              {banking.daysLeft} {banking.daysLeft === 1 ? 'day' : 'days'} left
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1 tabular">
            <span className="text-[22px] font-bold tracking-[-0.02em]">
              {fmt(banking.consumedToDate)}
            </span>
            <span className="text-[13px] text-muted">of {fmt(banking.weekBudget)} kcal</span>
            {Math.abs(banking.balance) >= 50 && (
              <span
                className={`ml-auto text-[13px] font-semibold ${banking.balance > 0 ? 'text-fiber' : 'text-fat'}`}
              >
                {banking.balance > 0
                  ? `${fmt(banking.balance)} banked`
                  : `${fmt(-banking.balance)} over`}
              </span>
            )}
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-700 ease-[var(--ease-out-soft)]"
              style={{
                width: `${Math.min(100, (banking.consumedToDate / Math.max(1, banking.weekBudget)) * 100)}%`,
              }}
            />
          </div>
          {banking.notices.length > 0 && (
            <ul className="mt-3 space-y-1 text-[13px] leading-snug text-muted">
              {banking.notices.slice(-2).map((n, i) => (
                <li key={i}>{n.text}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {date === today && tdee?.pending && (
        <Card className="mt-3 p-5">
          <p className="text-[15px] font-semibold tabular">
            Measured {fmt(tdee.pending.measured)} kcal —{' '}
            {fmt(Math.abs(tdee.pending.measured - tdee.pending.formula))} kcal{' '}
            {tdee.pending.measured > tdee.pending.formula ? 'above' : 'below'} the formula
          </p>
          <p className="mt-1 text-[14px] leading-snug text-muted">
            A gap this size is almost always logging, not metabolism: unlogged bites, oils and
            drinks, or portions guessed low. Worth checking a week of entries before trusting it.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button onClick={() => void dismissPendingTdee()}>Keep formula</Button>
            <Button variant="primary" onClick={() => void acceptPendingTdee()}>
              Apply it
              <span className="ml-1 text-[12px] font-medium opacity-70">
                {tdee.pending.tdee > tdee.pending.formula ? '+' : ''}
                {fmt(tdee.pending.tdee - tdee.pending.formula)}
              </span>
            </Button>
          </div>
        </Card>
      )}

      <SupplementsCard date={date} />

      {coach?.kind === 'gap' && (
        <section className="mt-7" aria-label="Coach">
          <SectionHeading>
            <span className="inline-flex items-center gap-2">
              <Sparkles size={16} className="text-accent" aria-hidden />
              {coach.result.gap.label} is running low
            </span>
          </SectionHeading>
          <Card>
            <p className="px-4 pt-4 pb-1 text-[14px] leading-snug text-muted tabular">
              Averaging {fmt(coach.result.gap.average, coach.result.gap.unit === 'g' ? 0 : 1)}{' '}
              {coach.result.gap.unit} of{' '}
              {fmt(coach.result.gap.target, coach.result.gap.unit === 'g' ? 0 : 1)}{' '}
              {coach.result.gap.unit} over the last {coach.result.gap.days} logged days.
              {coach.result.recommendations.length > 0 ? ' Any of these helps:' : ''}
            </p>
            <div className="divide-y divide-line">
              {coach.result.recommendations.map((r) => (
                <ListRow
                  key={r.food.id}
                  onClick={() =>
                    setSheet({
                      food: r.food,
                      grams: r.grams,
                      slot: mealSlotForTime(new Date()),
                      method: 'search',
                    })
                  }
                  wrapTitle
                  title={shortName(r.food.name)}
                  subtitle={`${fmt(r.grams)} g, ${fmt(r.kcal)} kcal${r.familiar ? ', you log this already' : ''}`}
                  value={`+${fmt(r.adds, coach.result.gap.unit === 'g' ? 0 : 1)} ${coach.result.gap.unit}`}
                  valueSub={coach.result.gap.label.toLowerCase()}
                />
              ))}
            </div>
          </Card>
        </section>
      )}

      {coach?.kind === 'closed' && (
        <p className="card mt-7 px-4 py-3 text-[14px] text-ink-2">
          {coach.nutrientLabel} is on target this week.
        </p>
      )}

      {((favourites && favourites.length > 0) || (batches && batches.length > 0)) && (
        <section className="mt-7">
          <SectionHeading>Log again</SectionHeading>
          <div className="rail -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {batches?.map(({ batch, recipe, food }) => {
              const portion = batch.total_g / batch.portions_total;
              return (
                <button
                  key={batch.id}
                  type="button"
                  onClick={() =>
                    setSheet({
                      food,
                      grams: Math.round(portion),
                      slot: mealSlotForTime(new Date()),
                      method: 'batch',
                      batch: { batch, recipe },
                    })
                  }
                  className="card flex w-[156px] shrink-0 snap-start flex-col justify-between p-4 text-left transition-transform duration-200 ease-[var(--ease-out-soft)] active:scale-[0.97]"
                >
                  <span className="flex items-start gap-1.5">
                    <ChefHat
                      size={15}
                      strokeWidth={2.2}
                      aria-hidden
                      className="mt-0.5 shrink-0 text-accent"
                    />
                    <span className="line-clamp-2 text-[15px] font-semibold leading-snug">
                      {recipe.name}
                    </span>
                  </span>
                  <span className="mt-3 text-[13px] text-muted tabular">
                    1 portion · {fmt((food.per_100g.kcal * portion) / 100)} kcal
                    <span className="block text-accent">
                      {formatPortions(batch.portions_remaining)} left
                    </span>
                  </span>
                </button>
              );
            })}
            {favourites?.map((f) => (
              <button
                key={f.food_id}
                type="button"
                onClick={() => openFavourite(f.food_id, f.last_grams)}
                className="card flex w-[156px] shrink-0 snap-start flex-col justify-between p-4 text-left transition-transform duration-200 ease-[var(--ease-out-soft)] active:scale-[0.97]"
              >
                <span className="line-clamp-2 text-[15px] font-semibold leading-snug">
                  {shortName(f.name)}
                </span>
                <span className="mt-3 text-[13px] text-muted tabular">
                  {fmt(f.last_grams)} g · {fmt(f.last_kcal)} kcal
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {MEAL_SLOTS.map((slot) => {
        const list = bySlot.get(slot)!;
        if (list.length === 0) return null;
        const kcal = list.reduce((a, e) => a + e.kcal, 0);
        const Icon = SLOT_ICON[slot];
        return (
          <section key={slot} className="mt-7">
            <SectionHeading trailing={`${fmt(kcal)} kcal`}>{SLOT_LABEL[slot]}</SectionHeading>
            <Card className="divide-y divide-line">
              {list.map((e) => (
                <ListRow
                  key={e.id}
                  onClick={() => openEntry(e)}
                  icon={Icon}
                  iconTone="kcal"
                  title={e.name}
                  badge={e.confidence !== 'high' ? <Badge tone="kcal">estimate</Badge> : undefined}
                  subtitle={entryMeta(e)}
                  value={fmt(e.kcal)}
                  valueSub="kcal"
                />
              ))}
            </Card>
          </section>
        );
      })}

      {entries && entries.length === 0 && (
        <EmptyState
          icon={Plus}
          title="Nothing logged yet"
          body="Search a food, or type the calories for something off-menu."
          action={
            <Link
              to={`/log?d=${date}`}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-surface-2 px-6 font-semibold active:bg-surface-3"
            >
              Log food
            </Link>
          }
        />
      )}

      <WeighInSheet
        open={weighOpen}
        date={date}
        current={todaysWeighIn?.weight_kg}
        previous={previousWeighIn?.weight_kg}
        onClose={() => setWeighOpen(false)}
      />
      <AmountSheet
        open={sheet != null}
        food={sheet?.food}
        date={date}
        initialGrams={sheet?.grams}
        initialSlot={sheet?.slot ?? 'snack'}
        entryId={sheet?.entryId}
        entryMethod={sheet?.method ?? 'search'}
        batch={sheet?.batch}
        onClose={() => setSheet(null)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  align = 'left',
}: {
  label: string;
  value: string;
  unit: string;
  align?: 'left' | 'right';
}) {
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <div className="text-[12px] font-semibold text-muted">{label}</div>
      <div className="mt-0.5 text-[18px] font-bold tracking-[-0.01em]">
        {value}
        <span className="ml-1 text-[12px] font-medium text-muted">{unit}</span>
      </div>
    </div>
  );
}

/** The line under the ring: where the target comes from and how the §4 measurement is going. */
function targetNote(
  provisional: boolean | undefined,
  tdee: TdeeState | undefined,
  isToday: boolean,
): string {
  if (provisional == null) return '';
  if (!provisional) {
    return tdee?.published
      ? `Measured target · TDEE ${fmt(tdee.published.tdee)} kcal`
      : 'Measured target';
  }
  if (!tdee || !isToday) return 'Provisional target from formula';
  return `Provisional target · ${engineLine(tdee.result, tdee.pending != null)}`;
}

function engineLine(r: EngineResult, pending: boolean): string {
  switch (r.status) {
    case 'calibrating':
      return `calibration day ${r.day} of ${r.first_estimate_day}`;
    case 'insufficient': {
      const needL = Math.max(0, r.need_logged - r.logged_days);
      const needW = Math.max(0, r.need_weighed - r.weighed_days);
      const parts: string[] = [];
      if (needL) parts.push(`${needL} more logged ${needL === 1 ? 'day' : 'days'}`);
      if (needW) parts.push(`${needW} more ${needW === 1 ? 'weigh-in' : 'weigh-ins'}`);
      return parts.length ? `needs ${parts.join(' and ')}` : 'measuring';
    }
    case 'ok':
      return pending ? 'measurement on hold, see below' : 'formula kept this week';
  }
}

/** "150 g · 34 g protein · 3 g fiber" — the two macros the plan is built on; the rest are on the sheet. */
function entryMeta(e: LogEntry): string {
  const parts: string[] = [];
  if (e.grams > 0) parts.push(`${fmt(e.grams)} g`);
  parts.push(`${fmt(e.protein_g)} g protein`);
  if (e.fiber_g >= 1) parts.push(`${fmt(e.fiber_g)} g fiber`);
  return parts.join(' · ');
}

/** USDA names are long; tiles show the first two comma segments. */
function shortName(name: string): string {
  return name.split(',').slice(0, 2).join(',').trim();
}
