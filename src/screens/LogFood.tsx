// SPEC §8 weighed-ingredient path: search → number pad → done, ≤10 s.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AmountSheet } from '@/components/AmountSheet';
import { mealSlotForTime, todayKey } from '@/core/dates';
import { searchFoods, type SearchHit } from '@/core/search';
import type { Food, MealSlot } from '@/core/types';
import { getFood } from '@/db/repo/foods';
import { lastGramsForFood } from '@/db/repo/logEntries';
import { useFoodUsage, useSearchDocs } from '@/hooks/useData';

const SOURCE_TAG: Record<Food['source'], string> = {
  usda_foundation: 'USDA',
  usda_sr: 'USDA SR',
  off: 'OFF',
  custom: 'Mine',
  photo: 'Photo',
};

export default function LogFood() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const date = params.get('d') ?? todayKey();
  const slot = (params.get('slot') as MealSlot | null) ?? mealSlotForTime(new Date());

  const docs = useSearchDocs();
  const usage = useFoodUsage();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);

  const [picked, setPicked] = useState<{ food: Food; grams: number | undefined } | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hits: SearchHit[] = useMemo(
    () => (docs && deferred.trim() ? searchFoods(docs, deferred, usage) : []),
    [docs, deferred, usage],
  );

  const pick = async (id: string) => {
    const [food, grams] = await Promise.all([getFood(id), lastGramsForFood(id)]);
    if (food) setPicked({ food, grams });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 pb-3">
        <button
          type="button"
          className="h-11 w-11 shrink-0 rounded-full text-2xl text-muted"
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          ‹
        </button>
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={docs ? 'Search foods' : 'Loading food database…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-12 w-full rounded-xl bg-surface px-4 text-base outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
        />
      </div>

      <ul className="-mx-4 flex-1 divide-y divide-line overflow-y-auto">
        {hits.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              onClick={() => pick(h.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 leading-snug">{h.name}</div>
                {h.brand && <div className="text-xs text-muted">{h.brand}</div>}
              </div>
              <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                {SOURCE_TAG[h.source]}
              </span>
            </button>
          </li>
        ))}
        {docs && deferred.trim() && hits.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted">
            No match. Try fewer words, or use Quick add.
          </li>
        )}
        {docs && !deferred.trim() && (
          <li className="px-4 py-6 text-center text-sm text-muted">
            {docs.length.toLocaleString()} foods · type to search
          </li>
        )}
      </ul>

      <AmountSheet
        open={picked != null}
        food={picked?.food}
        date={date}
        initialGrams={picked?.grams}
        initialSlot={slot}
        entryMethod="search"
        onClose={() => setPicked(null)}
        onSaved={() => navigate(`/?d=${date}`, { replace: true })}
      />
    </div>
  );
}
