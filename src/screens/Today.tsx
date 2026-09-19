import {
  ChevronLeft,
  ChevronRight,
  Cookie,
  Info,
  Moon,
  Plus,
  Scale,
  Sun,
  Sunrise,
  TrendingDown,
  TrendingUp,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AmountSheet, SLOT_LABEL } from '@/components/AmountSheet';
import { MacroBar } from '@/components/MacroBar';
import { Ring } from '@/components/Ring';
import { Sparkline } from '@/components/Sparkline';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  ListRow,
  SectionLabel,
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
  const weighIns = useWeighIns();
  const favourites = useFavourites();
  const firstDate = useFirstActivityDate();

  const [weighOpen, setWeighOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetState | null>(null);

  const totals = useMemo(() => dayTotals(entries ?? []), [entries]);
  const trend = useMemo(() => computeTrend(weighIns ?? [], undefined, date), [weighIns, date]);
  const trendToday = trend.find((p) => p.date === date);
  const weekDelta = trendDelta(trend, 7);
  const spark = trend.slice(-14).map((p) => p.trend);
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

  return (
    <div className="space-y-5 pb-28">
      <header className="flex items-center justify-between">
        <IconButton
          icon={ChevronLeft}
          label="Previous day"
          onClick={() => setDate(addDays(date, -1))}
        />
        <div className="text-center">
          <h1 className="text-[22px] font-semibold leading-tight">{formatDayLabel(date, today)}</h1>
          <p className="text-[13px] text-muted">{fullDate}</p>
        </div>
        <IconButton
          icon={ChevronRight}
          label="Next day"
          onClick={() => setDate(addDays(date, 1))}
          disabled={date >= today}
        />
      </header>

      {loading ? (
        <Card>
          <div className="flex items-center gap-5">
            <Skeleton className="h-[132px] w-[132px] rounded-full" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/6" />
            </div>
          </div>
        </Card>
      ) : target ? (
        <Card>
          <div className="flex items-center gap-5">
            <Ring value={totals.kcal} target={target.kcal}>
              <span className="display text-[30px]">{fmt(Math.abs(remaining))}</span>
              <span className="mt-1 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">
                {remaining >= 0 ? 'left' : 'over'}
              </span>
            </Ring>
            <div className="min-w-0 flex-1 space-y-3">
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
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[13px]">
            <span className="tabular text-ink-2">
              <span className="font-semibold text-ink">{fmt(totals.kcal)}</span> of{' '}
              {fmt(target.kcal)} kcal
            </span>
            {target.provisional && (
              <span className="flex items-center gap-1 text-muted">
                <Info size={14} strokeWidth={2} aria-hidden />
                {calibrationDay != null && calibrationDay <= CALIBRATION_DAYS
                  ? `Provisional · day ${calibrationDay} of ${CALIBRATION_DAYS}`
                  : 'Provisional targets'}
              </span>
            )}
          </div>
        </Card>
      ) : (
        <Card>
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
        </Card>
      )}

      <Card onClick={() => setWeighOpen(true)}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13px] text-muted">Weight</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              {todaysWeighIn ? (
                <span className="tabular text-[28px] font-semibold leading-none">
                  {todaysWeighIn.weight_kg.toFixed(1)}
                  <span className="ml-1 text-[15px] font-normal text-muted">kg</span>
                </span>
              ) : (
                <span className="text-[17px] text-ink-2">Tap to weigh in</span>
              )}
            </div>
            {trendToday && (
              <div className="mt-1.5 flex items-center gap-2 text-[13px] text-muted tabular">
                <span>trend {trendToday.trend.toFixed(1)} kg</span>
                {weekDelta != null && (
                  <span
                    className={`flex items-center gap-0.5 ${weekDelta <= 0 ? 'text-fiber' : 'text-fat'}`}
                  >
                    {weekDelta <= 0 ? (
                      <TrendingDown size={14} aria-hidden />
                    ) : (
                      <TrendingUp size={14} aria-hidden />
                    )}
                    {weekDelta > 0 ? '+' : ''}
                    {weekDelta.toFixed(2)} / 7d
                  </span>
                )}
              </div>
            )}
          </div>
          {spark.length >= 2 ? (
            <Sparkline values={spark} width={104} height={40} />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-ink-2">
              <Scale size={20} strokeWidth={2} aria-hidden />
            </span>
          )}
        </div>
      </Card>

      {favourites && favourites.length > 0 && (
        <section>
          <SectionLabel>Quick log</SectionLabel>
          <div className="rail -mx-4 flex gap-2 overflow-x-auto px-4">
            {favourites.map((f) => (
              <button
                key={f.food_id}
                type="button"
                onClick={() => openFavourite(f.food_id, f.last_grams)}
                className="flex w-[150px] shrink-0 flex-col justify-between rounded-[16px] bg-surface p-3.5 text-left transition-[transform,background-color] duration-150 active:scale-[0.97] active:bg-surface-2"
              >
                <span className="line-clamp-2 text-[14px] font-medium leading-snug">
                  {shortName(f.name)}
                </span>
                <span className="mt-2 text-[12px] text-muted tabular">
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
          <section key={slot}>
            <SectionLabel trailing={`${fmt(kcal)} kcal`}>
              <span className="inline-flex items-center gap-1.5">
                <Icon size={14} strokeWidth={2} aria-hidden />
                {SLOT_LABEL[slot]}
              </span>
            </SectionLabel>
            <Card className="divide-y divide-line p-0">
              {list.map((e) => (
                <ListRow
                  key={e.id}
                  onClick={() => openEntry(e)}
                  title={e.name}
                  badge={e.confidence !== 'high' ? <Badge tone="kcal">est.</Badge> : undefined}
                  subtitle={`${e.grams > 0 ? `${fmt(e.grams)} g · ` : ''}P ${fmt(e.protein_g)} · C ${fmt(e.carb_g)} · F ${fmt(e.fat_g)} · Fib ${fmt(e.fiber_g)}`}
                  value={fmt(e.kcal)}
                />
              ))}
            </Card>
          </section>
        );
      })}

      {entries && entries.length === 0 && (
        <EmptyState
          icon={Utensils}
          title="Nothing logged yet"
          body="Search a food, or type calories for something off-menu."
          action={
            <Link
              to={`/log?d=${date}`}
              className="inline-flex h-12 items-center gap-2 rounded-[14px] bg-surface-2 px-5 font-medium active:scale-[0.98]"
            >
              <Plus size={18} aria-hidden /> Log food
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

/** USDA names are long; the tile shows the first two comma segments. */
function shortName(name: string): string {
  return name.split(',').slice(0, 2).join(',').trim();
}
