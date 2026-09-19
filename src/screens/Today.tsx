import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AmountSheet, SLOT_LABEL } from '@/components/AmountSheet';
import { MacroBar } from '@/components/MacroBar';
import { Button, Card, Chip, fmt } from '@/components/ui';
import { WeighInSheet } from '@/components/WeighInSheet';
import { addDays, diffDays, formatDayLabel, mealSlotForTime, todayKey } from '@/core/dates';
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
  const todaysWeighIn = weighIns?.find((w) => w.date === date);
  const previousWeighIn = weighIns?.filter((w) => w.date < date).at(-1);

  const calibrationDay = firstDate ? diffDays(firstDate, date) + 1 : undefined;

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

  return (
    <div className="space-y-4 pb-28">
      <header className="flex items-center justify-between">
        <button
          type="button"
          className="h-11 w-11 rounded-full text-2xl text-muted"
          onClick={() => setDate(addDays(date, -1))}
          aria-label="Previous day"
        >
          ‹
        </button>
        <h1 className="text-lg font-semibold">{formatDayLabel(date, today)}</h1>
        <button
          type="button"
          className="h-11 w-11 rounded-full text-2xl text-muted disabled:opacity-30"
          onClick={() => setDate(addDays(date, 1))}
          disabled={date >= today}
          aria-label="Next day"
        >
          ›
        </button>
      </header>

      <Card className="space-y-3">
        {target ? (
          <>
            <MacroBar
              label="Calories"
              value={totals.kcal}
              target={target.kcal}
              unit=""
              color="kcal"
              size="lg"
            />
            <div className="grid grid-cols-2 gap-4">
              <MacroBar
                label="Protein"
                value={totals.protein_g}
                target={target.protein_g}
                unit="g"
                color="protein"
              />
              <MacroBar
                label="Fiber"
                value={totals.fiber_g}
                target={target.fiber_g}
                unit="g"
                color="fiber"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <MacroBar
                label="Carbs"
                value={totals.carb_g}
                target={target.carb_g}
                unit="g"
                color="carb"
                size="sm"
              />
              <MacroBar
                label="Fat"
                value={totals.fat_g}
                target={target.fat_g}
                unit="g"
                color="fat"
                size="sm"
              />
            </div>
            {target.provisional && (
              <p className="text-xs text-muted">
                Provisional targets from formula
                {calibrationDay != null && calibrationDay <= CALIBRATION_DAYS
                  ? ` · calibration day ${calibrationDay} of ${CALIBRATION_DAYS}`
                  : ''}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">
            {weighIns && weighIns.length === 0
              ? 'Log your first weigh-in to get targets.'
              : 'Computing targets…'}
          </p>
        )}
      </Card>

      <button type="button" className="w-full text-left" onClick={() => setWeighOpen(true)}>
        <Card className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted">Weight</div>
            <div className="tabular text-2xl font-semibold">
              {todaysWeighIn ? (
                `${todaysWeighIn.weight_kg.toFixed(1)} kg`
              ) : (
                <span className="text-muted">Tap to weigh in</span>
              )}
            </div>
          </div>
          {trendToday && (
            <div className="text-right text-sm text-muted tabular">
              <div>trend {trendToday.trend.toFixed(1)} kg</div>
              {weekDelta != null && (
                <div className={weekDelta < 0 ? 'text-fiber' : 'text-fat'}>
                  {weekDelta > 0 ? '+' : ''}
                  {weekDelta.toFixed(2)} kg / 7d
                </div>
              )}
            </div>
          )}
        </Card>
      </button>

      {favourites && favourites.length > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
          {favourites.map((f) => (
            <Chip
              key={f.food_id}
              onClick={() => openFavourite(f.food_id, f.last_grams)}
              className="max-w-[60vw] truncate"
            >
              {shortName(f.name)} · {fmt(f.last_grams)} g
            </Chip>
          ))}
        </div>
      )}

      {MEAL_SLOTS.map((slot) => {
        const list = bySlot.get(slot)!;
        if (list.length === 0) return null;
        const kcal = list.reduce((a, e) => a + e.kcal, 0);
        return (
          <section key={slot}>
            <div className="mb-1 flex items-baseline justify-between px-1">
              <h2 className="font-medium">{SLOT_LABEL[slot]}</h2>
              <span className="tabular text-sm text-muted">{fmt(kcal)} kcal</span>
            </div>
            <Card className="divide-y divide-line p-0">
              {list.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => openEntry(e)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{e.name}</div>
                    <div className="text-xs text-muted tabular">
                      {e.grams > 0 ? `${fmt(e.grams)} g · ` : ''}P {fmt(e.protein_g)} · C{' '}
                      {fmt(e.carb_g)} · F {fmt(e.fat_g)} · Fib {fmt(e.fiber_g)}
                      {e.confidence !== 'high' && <span className="ml-1 text-kcal">~</span>}
                    </div>
                  </div>
                  <div className="tabular">{fmt(e.kcal)}</div>
                </button>
              ))}
            </Card>
          </section>
        );
      })}

      {entries && entries.length === 0 && (
        <p className="px-1 text-center text-sm text-muted">Nothing logged yet.</p>
      )}

      <div className="fixed inset-x-0 bottom-16 z-30 mx-auto flex max-w-md justify-end gap-2 px-4 safe-bottom">
        <Link
          to={`/quick?d=${date}`}
          className="h-12 rounded-full bg-surface-2 px-4 leading-[3rem] text-sm"
        >
          Quick add
        </Link>
        <Link
          to={`/log?d=${date}`}
          className="h-12 w-12 rounded-full bg-accent text-center text-3xl font-light leading-[2.9rem] text-bg"
          aria-label="Log food"
        >
          +
        </Link>
      </div>

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
      {!target && weighIns && weighIns.length === 0 && (
        <Button variant="primary" className="w-full" onClick={() => setWeighOpen(true)}>
          Log first weigh-in
        </Button>
      )}
    </div>
  );
}

/** USDA names are long; the chip shows the first two comma segments. */
function shortName(name: string): string {
  return name.split(',').slice(0, 2).join(',').trim();
}
