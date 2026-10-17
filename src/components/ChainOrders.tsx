// SPEC §21.2 — the chains whose menus are already known, and what to order from one.
//
// The other half of eating out. A photographed menu is for a restaurant nobody has written
// down; this is for the ones that publish their figures, where there is nothing to estimate
// and no range to show — just what fits what is left of the day.
//
// Shown only when there is something to show. A market with no collected chains says nothing
// rather than offering an empty list, and a day with nothing left says that instead of
// recommending a salad to someone who has already eaten.
import { Store } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Card, Chip, SectionHeading, fmt } from '@/components/ui';
import { toast } from '@/components/Toast';
import { describeOrder, type Order } from '@/core/chainOrder';
import { dayTotals } from '@/core/nutrition';
import type { MacroTotals, MealSlot } from '@/core/types';
import { useDailyTarget, useEntries } from '@/hooks/useData';
import { useMarket } from '@/hooks/useMarket';
import { chainsFor, logOrder, ordersAt, type ChainSummary } from '@/services/chains';

export function ChainOrders({ date, slot }: { date: string; slot: MealSlot }) {
  const { markets } = useMarket();
  const entries = useEntries(date);
  const target = useDailyTarget(date);
  const [chains, setChains] = useState<ChainSummary[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [busy, setBusy] = useState(false);

  // What is left of the day. The recommender needs a budget, and a budget nobody has is not
  // a reason to guess one.
  const remaining: MacroTotals | null = useMemo(() => {
    if (!target || entries === undefined) return null;
    const eaten = dayTotals(entries);
    return {
      kcal: target.kcal - eaten.kcal,
      protein_g: target.protein_g - eaten.protein_g,
      carb_g: target.carb_g - eaten.carb_g,
      fat_g: target.fat_g - eaten.fat_g,
      fiber_g: target.fiber_g - eaten.fiber_g,
    };
  }, [target, entries]);

  useEffect(() => {
    if (!markets) return;
    let cancelled = false;
    void chainsFor(markets).then((c) => !cancelled && setChains(c));
    return () => {
      cancelled = true;
    };
  }, [markets]);

  useEffect(() => {
    if (!chosen || !markets || !remaining) return;
    let cancelled = false;
    void ordersAt(chosen, markets, remaining).then((o) => !cancelled && setOrders(o));
    return () => {
      cancelled = true;
    };
  }, [chosen, markets, remaining]);

  if (!markets || chains.length === 0) return null;

  const log = async (o: Order) => {
    if (busy) return;
    setBusy(true);
    try {
      await logOrder(o, markets, date, slot);
      toast(`Logged · ${Math.round(o.totals.kcal)} kcal`);
      setChosen(null);
      setOrders(null);
    } finally {
      setBusy(false);
    }
  };

  const left = remaining ? Math.round(remaining.kcal) : null;

  return (
    <section className="mt-7">
      <SectionHeading>
        <span className="inline-flex items-center gap-2">
          <Store size={16} className="text-accent" aria-hidden />
          Known menus
        </span>
      </SectionHeading>

      <div className="rail -mx-4 mt-1 flex gap-2 overflow-x-auto px-4 pb-3">
        {chains.map((c) => (
          <Chip
            key={`${c.market}:${c.chain}`}
            active={chosen === c.chain}
            onClick={() => {
              setOrders(null);
              setChosen(chosen === c.chain ? null : c.chain);
            }}
          >
            {c.chain}
          </Chip>
        ))}
      </div>

      {chosen && (
        <>
          {left != null && left <= 0 ? (
            <p className="text-[13px] leading-snug text-muted">
              Nothing left in today&rsquo;s budget, so there is nothing to recommend. Log what you
              order and the day will take it.
            </p>
          ) : (
            <>
              <p className="mb-2 text-[13px] text-muted">
                The most protein that fits{left != null ? ` your remaining ${fmt(left)} kcal` : ''}.
              </p>
              {orders === null ? (
                <p className="text-[13px] text-muted">Looking&hellip;</p>
              ) : orders.length === 0 ? (
                <p className="text-[13px] leading-snug text-muted">
                  Nothing on this menu fits what is left. That is the honest answer rather than a
                  smaller suggestion that still would not.
                </p>
              ) : (
                <Card className="divide-y divide-line">
                  {orders.map((o, i) => (
                    <button
                      key={describeOrder(o)}
                      type="button"
                      disabled={busy}
                      onClick={() => void log(o)}
                      className="rise-in flex w-full flex-col items-start gap-1 px-4 py-3 text-left active:bg-surface-2 disabled:opacity-60"
                      style={{ animationDelay: `${i * 40}ms` }}
                    >
                      <span className="text-[15px] leading-snug font-medium">
                        {o.lines
                          .map((l) => (l.count > 1 ? `${l.count}× ${l.item.name}` : l.item.name))
                          .join(' + ')}
                      </span>
                      <span className="text-[13px] text-muted tabular">
                        {fmt(Math.round(o.totals.kcal))} kcal · {Math.round(o.totals.protein_g)} g
                        protein · {o.density} g per 100 kcal
                      </span>
                    </button>
                  ))}
                </Card>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
