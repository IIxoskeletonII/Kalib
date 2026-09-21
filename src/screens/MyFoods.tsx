// Custom foods and cached packaged products — the user's own rotation (SPEC §8.1).
import { ChevronLeft, Plus, Utensils } from 'lucide-react';
import { useBack } from '@/hooks/useBack';
import { useNavigate } from 'react-router';
import { AmountSheet, SOURCE_LABEL } from '@/components/AmountSheet';
import { SwipeRow } from '@/components/SwipeRow';
import { toast } from '@/components/Toast';
import { deleteFood, restoreFood } from '@/db/repo/foods';
import { Badge, Button, Card, EmptyState, IconButton, ListRow, fmt } from '@/components/ui';
import { mealSlotForTime, todayKey } from '@/core/dates';
import type { Food } from '@/core/types';
import { useUserFoods } from '@/hooks/useData';
import { useState } from 'react';

export default function MyFoods() {
  const navigate = useNavigate();
  const back = useBack('/settings');
  const foods = useUserFoods();
  const [picked, setPicked] = useState<Food | null>(null);
  const today = todayKey();

  return (
    <div className="pb-32">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="flex-1">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">My foods</h1>
          <p className="text-[13px] text-muted">Tap to log. Custom foods can be edited.</p>
        </div>
        <Button size="sm" variant="primary" icon={Plus} onClick={() => navigate('/foods/new')}>
          New
        </Button>
      </div>

      {foods && foods.length === 0 && (
        <EmptyState
          icon={Utensils}
          title="No foods of your own yet"
          body="Create one for a dish you eat often, or scan a packaged product — it appears here and in search."
          action={
            <Button variant="primary" icon={Plus} onClick={() => navigate('/foods/new')}>
              New food
            </Button>
          }
        />
      )}

      {foods && foods.length > 0 && (
        <Card className="mt-5 divide-y divide-line">
          {foods.map((f) => (
            <SwipeRow
              key={f.id}
              onDelete={() => {
                void deleteFood(f.id).then(() =>
                  toast(`${f.name.split(',')[0]} removed`, {
                    label: 'Undo',
                    run: () => restoreFood(f.id),
                  }),
                );
              }}
            >
              <ListRow
                onClick={() => setPicked(f)}
                wrapTitle
                title={f.name}
                badge={
                  f.source === 'custom' ? (
                    <Badge tone="accent">{f.recipe_id ? 'Recipe' : 'Mine'}</Badge>
                  ) : (
                    <Badge>{SOURCE_LABEL[f.source]}</Badge>
                  )
                }
                subtitle={[
                  f.brand,
                  f.portions[0]
                    ? `${f.portions[0].label} ${fmt(f.portions[0].grams)} g`
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                value={fmt(f.per_100g.kcal)}
                valueSub="kcal / 100 g"
              />
            </SwipeRow>
          ))}
        </Card>
      )}

      <AmountSheet
        open={picked != null}
        food={picked ?? undefined}
        date={today}
        initialGrams={picked?.portions[0]?.grams}
        initialSlot={mealSlotForTime(new Date())}
        entryMethod="search"
        onClose={() => setPicked(null)}
        onSaved={() => navigate('/', { replace: true })}
      />
    </div>
  );
}
