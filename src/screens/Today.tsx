import { ChevronLeft, ChevronRight, Plus, Scale } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AmountSheet, SLOT_LABEL } from '@/components/AmountSheet';
import { MacroBar } from '@/components/MacroBar';
import { Ring } from '@/components/Ring';
import {
  Badge,
  Button,
  EmptyState,
  Group,
  IconButton,
  ListRow,
  SectionHeading,
  Skeleton,
  fmt,
} from '@/components/ui';
import { WeighInSheet } from '@/components/WeighInSheet';
import {
  addDays,
  diffDays,
  formatDayLabel,
  fromDateKey,
  mealSlotForTime,
  todayKey,
} from '@/core/dates';
import { dayTotals } from '@/core/nutrition';
import { CALIBRATION_DAYS } from '@/core/targets';
import { computeTrend, trendDelta } from '@/core/trend';
import { MEAL_SLOTS, type Food, type LogEntry, type MealSlot } from '@/core/types';
import { getFood } from '@/db/repo/foods';
import {
  useCoach,
  useDailyTarget,
  useEntries,
  useFavourites,
  useFirstActivityDate,
  useWeighIns,
} from '@/hooks/useData';

interface SheetState {
  food: Food;
  grams?: number | undefined;
  slot: MealSlot;
  entryId?: string | undefined;
  method: 'search' | 'favourite';
}

export default function Today() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const today = todayKey();
  const date = params.get('d') ?? today;
  const setDate = (d: string) => setParams(d === today ? {} : { d }, { replace: true });

  const entries = useEntries(date);
  const target = useDailyTarget(date);
  const weighIns = useWeighIns();
  const favourites = useFavourites();
  const firstDate = useFirstActivityDate();
  const coach = useCoach(date);

  const [weighOpen, setWeighOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetState | null>(null);

  const totals = useMemo(() => dayTotals(entries ?? []), [entries]);
  const trend = useMemo(() => computeTrend(weighIns ?? [], undefined, date), [weighIns, date]);
  const trendToday = trend.find((p) => p.date === date);
  const weekDelta = trendDelta(trend, 7);
  const todaysWeighIn = weighIns?.find((w) => w.date === date);
  const previousWeighIn = weighIns?.filter((w) => w.date < date).at(-1);
  const calibrationDay = firstDate ? diffDays(firstDate, date) + 1 : undefined;
  const remaining = target ? target.kcal - totals.kcal : 0;

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
  const fullDate = fromDateKey(date).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const provisionalNote =
    target?.provisional && calibrationDay != null && calibrationDay <= CALIBRATION_DAYS
      ? `Provisional targets, calibration day ${calibrationDay} of ${CALIBRATION_DAYS}`
      : target?.provisional
        ? 'Provisional targets from formula'
        : 'Measured targets';

  return (
    <div className="pb-28">
      <header className="flex items-end justify-between pt-1 pb-5">
        <div>
          <h1 className="text-[30px] leading-none font-semibold tracking-[-0.02em]">
            {formatDayLabel(date, today)}
          </h1>
          <p className="mt-1.5 text-[14px] text-muted">{fullDate}</p>
        </div>
        <div className="-mr-2 flex">
          <IconButton
            icon={ChevronLeft}
            label="Previous day"
            onClick={() => setDate(addDays(date, -1))}
          />
          <IconButton
            icon={ChevronRight}
            label="Next day"
            onClick={() => setDate(addDays(date, 1))}
            disabled={date >= today}
          />
        </div>
      </header>

      {loading ? (
        <div className="flex items-center gap-6 py-2">
          <Skeleton className="h-[132px] w-[132px] rounded-full" />
          <div className="flex-1 space-y-4">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/6" />
          </div>
        </div>
      ) : target ? (
        <section aria-label="Calories and macros">
          <div className="flex items-center gap-6">
            <Ring
              value={totals.kcal}
              target={target.kcal}
              size={132}
              stroke={8}
              color="var(--accent)"
            >
              <span className="display text-[30px]">{fmt(Math.abs(remaining))}</span>
              <span className="mt-1 text-[13px] text-muted">
                {remaining >= 0 ? 'kcal left' : 'kcal over'}
              </span>
            </Ring>
            <div className="min-w-0 flex-1 space-y-3.5">
              <MacroBar
                label="Protein"
                value={totals.protein_g}
                target={target.protein_g}
                unit="g"
                color="protein"
                compact
              />
              <MacroBar
                label="Fiber"
                value={totals.fiber_g}
                target={target.fiber_g}
                unit="g"
                color="fiber"
                compact
              />
              <MacroBar
                label="Carbs"
                value={totals.carb_g}
                target={target.carb_g}
                unit="g"
                color="carb"
                compact
              />
              <MacroBar
                label="Fat"
                value={totals.fat_g}
                target={target.fat_g}
                unit="g"
                color="fat"
                compact
              />
            </div>
          </div>
          <p className="mt-4 text-[13px] text-muted tabular">
            {fmt(totals.kcal)} of {fmt(target.kcal)} kcal eaten. {provisionalNote}.
          </p>
        </section>
      ) : (
        <EmptyState
          icon={Scale}
          title="No targets yet"
          body="Log a weigh-in and your provisional targets appear here."
          action={
            <Button variant="primary" icon={Scale} onClick={() => setWeighOpen(true)}>
              Log weigh-in
            </Button>
          }
        />
      )}

      <div className="mt-6">
        <Group onClick={() => setWeighOpen(true)}>
          <ListRow
            title={
              todaysWeighIn ? (
                <span className="tabular">{todaysWeighIn.weight_kg.toFixed(1)} kg</span>
              ) : (
                'Weigh in'
              )
            }
            subtitle={
              trendToday
                ? `Trend ${trendToday.trend.toFixed(1)} kg${
                    weekDelta != null
                      ? `, ${weekDelta > 0 ? '+' : ''}${weekDelta.toFixed(2)} kg over 7 days`
                      : ''
                  }`
                : 'Daily weigh-ins drive the calibration'
            }
            icon={Scale}
            chevron
          />
        </Group>
      </div>

      {coach?.kind === 'gap' && (
        <section className="mt-7" aria-label="Coach">
          <h2 className="text-[17px] font-semibold">{coach.result.gap.label} is running low</h2>
          <p className="mt-1 text-[14px] leading-snug text-muted tabular">
            Averaging {fmt(coach.result.gap.average, coach.result.gap.unit === 'g' ? 0 : 1)}{' '}
            {coach.result.gap.unit} of{' '}
            {fmt(coach.result.gap.target, coach.result.gap.unit === 'g' ? 0 : 1)}{' '}
            {coach.result.gap.unit} over the last {coach.result.gap.days} logged days.
            {coach.result.recommendations.length > 0 ? ' Any of these helps:' : ''}
          </p>
          {coach.result.recommendations.length > 0 && (
            <Group className="mt-3 divide-y divide-line">
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
            </Group>
          )}
        </section>
      )}

      {coach?.kind === 'closed' && (
        <p className="mt-7 rounded-2xl bg-surface px-4 py-3 text-[14px] text-ink-2">
          {coach.nutrientLabel} is on target this week.
        </p>
      )}

      {favourites && favourites.length > 0 && (
        <section className="mt-7">
          <SectionHeading>Log again</SectionHeading>
          <div className="rail -mx-4 flex gap-2 overflow-x-auto px-4">
            {favourites.map((f) => (
              <button
                key={f.food_id}
                type="button"
                onClick={() => openFavourite(f.food_id, f.last_grams)}
                className="flex w-[148px] shrink-0 flex-col justify-between rounded-2xl bg-surface p-3.5 text-left transition-[background-color] duration-150 active:bg-surface-2"
              >
                <span className="line-clamp-2 text-[14px] leading-snug">{shortName(f.name)}</span>
                <span className="mt-2 text-[13px] text-muted tabular">
                  {fmt(f.last_grams)} g, {fmt(f.last_kcal)} kcal
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
        return (
          <section key={slot} className="mt-7">
            <SectionHeading trailing={`${fmt(kcal)} kcal`}>{SLOT_LABEL[slot]}</SectionHeading>
            <Group className="divide-y divide-line">
              {list.map((e) => (
                <ListRow
                  key={e.id}
                  onClick={() => openEntry(e)}
                  title={e.name}
                  badge={e.confidence !== 'high' ? <Badge tone="kcal">estimate</Badge> : undefined}
                  subtitle={entryMeta(e)}
                  value={fmt(e.kcal)}
                />
              ))}
            </Group>
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
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-surface-2 px-5 font-medium active:bg-surface-3"
            >
              Log food
            </Link>
          }
        />
      )}

      <Link
        to={`/log?d=${date}`}
        aria-label="Log food"
        className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-fab transition-transform duration-150 active:scale-95"
      >
        <Plus size={26} strokeWidth={2.25} aria-hidden />
      </Link>

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
        onClose={() => setSheet(null)}
      />
    </div>
  );
}

/** "150 g, 34 g protein, 3 g fiber" — the two macros the plan is built on; the rest are on the sheet. */
function entryMeta(e: LogEntry): string {
  const parts: string[] = [];
  if (e.grams > 0) parts.push(`${fmt(e.grams)} g`);
  parts.push(`${fmt(e.protein_g)} g protein`);
  if (e.fiber_g >= 1) parts.push(`${fmt(e.fiber_g)} g fiber`);
  return parts.join(', ');
}

/** USDA names are long; the tile shows the first two comma segments. */
function shortName(name: string): string {
  return name.split(',').slice(0, 2).join(',').trim();
}
