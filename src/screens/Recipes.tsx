// SPEC §8.2 — the user's recipes. New ones get a name here and are built on the editor.
import { ChefHat, ChevronLeft, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, EmptyState, IconButton, ListRow, Sheet, fmt } from '@/components/ui';
import { formatPortions, portionGrams } from '@/core/recipes';
import type { Batch, Recipe } from '@/core/types';
import { useActiveBatches, useRecipes, useUserFoods } from '@/hooks/useData';
import { createRecipe } from '@/services/recipes';

export default function Recipes() {
  const navigate = useNavigate();
  const recipes = useRecipes();
  const foods = useUserFoods();
  const active = useActiveBatches();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const kcalPerPortion = (r: Recipe): number | undefined => {
    const f = foods?.find((x) => x.id === r.food_id);
    return f ? (f.per_100g.kcal * portionGrams(r)) / 100 : undefined;
  };
  const batchFor = (r: Recipe): Batch | undefined =>
    active?.find((a) => a.recipe.id === r.id)?.batch;

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const r = await createRecipe(name);
    setNaming(false);
    setName('');
    setBusy(false);
    navigate(`/recipes/${r.id}`, { replace: false });
  };

  return (
    <div className="pb-32">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={() => navigate(-1)} />
        <div className="flex-1">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">Recipes</h1>
          <p className="text-[13px] text-muted">Cook once, log a portion in a tap.</p>
        </div>
        <Button size="sm" variant="primary" icon={Plus} onClick={() => setNaming(true)}>
          New
        </Button>
      </div>

      {recipes && recipes.length === 0 && (
        <EmptyState
          icon={ChefHat}
          title="No recipes yet"
          body="Weigh the ingredients as you cook, weigh the pot at the end, say how many portions — then every portion is one tap."
          action={
            <Button variant="primary" icon={Plus} onClick={() => setNaming(true)}>
              New recipe
            </Button>
          }
        />
      )}

      {recipes && recipes.length > 0 && (
        <Card className="mt-5 divide-y divide-line">
          {recipes.map((r) => {
            const kcal = kcalPerPortion(r);
            const b = batchFor(r);
            return (
              <ListRow
                key={r.id}
                onClick={() => navigate(`/recipes/${r.id}`)}
                icon={ChefHat}
                iconTone="accent"
                title={r.name}
                subtitle={
                  b
                    ? `${formatPortions(b.portions_remaining)} of ${b.portions_total} portions left`
                    : `${r.items.length} ${r.items.length === 1 ? 'ingredient' : 'ingredients'} · ${r.portions} portions`
                }
                value={kcal != null ? fmt(kcal) : undefined}
                valueSub={kcal != null ? 'kcal / portion' : undefined}
                chevron
              />
            );
          })}
        </Card>
      )}

      <Sheet open={naming} onClose={() => setNaming(false)} title="New recipe">
        <div className="space-y-3">
          <input
            type="text"
            autoFocus
            autoComplete="off"
            placeholder="Name, e.g. Chicken & rice"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
            className="h-12 w-full rounded-full bg-surface-2 px-5 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
          />
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!name.trim() || busy}
            onClick={create}
          >
            Add ingredients
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
