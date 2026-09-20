// SPEC §8 weighed-ingredient path: search → number pad → done, ≤10 s.
import {
  Camera,
  ChefHat,
  ChevronLeft,
  Globe,
  PenLine,
  Plus,
  Search,
  SearchX,
  WifiOff,
  X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AmountSheet, SOURCE_LABEL } from '@/components/AmountSheet';
import {
  Badge,
  Button,
  Chip,
  IconButton,
  ListRow,
  SectionHeading,
  Skeleton,
  fmt,
} from '@/components/ui';
import { mealSlotForTime, todayKey } from '@/core/dates';
import { searchFoods, type SearchHit } from '@/core/search';
import type { Food, MealSlot } from '@/core/types';
import { getFood, getFoods } from '@/db/repo/foods';
import { lastGramsForFood } from '@/db/repo/logEntries';
import { useFoodUsage, useRecipe, useSearchDocs } from '@/hooks/useData';
import { captureImage } from '@/platform/camera';
import { decodeBarcode } from '@/services/barcode';
import { cacheOffProduct, lookupBarcode, searchPackaged, type OffProduct } from '@/services/off';

type Online =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'done'; items: OffProduct[] }
  | { state: 'error'; message: string };

// Dev-only hook for the screenshot harness to exercise the decoder with a fixture image.
if (import.meta.env.DEV) {
  (window as unknown as { __kalib?: object }).__kalib = { decodeBarcode };
}

export default function LogFood() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const date = params.get('d') ?? todayKey();
  const slot = (params.get('slot') as MealSlot | null) ?? mealSlotForTime(new Date());
  // Recipe mode (SPEC §8.2): a picked amount becomes an ingredient, nothing is logged.
  const recipeId = params.get('recipe') ?? undefined;
  const recipe = useRecipe(recipeId);

  const docs = useSearchDocs();
  const usage = useFoodUsage();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const deferred = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const [online, setOnline] = useState<{ q: string; r: Online }>({ q: '', r: { state: 'idle' } });
  const [picked, setPicked] = useState<{ food: Food; grams: number | undefined } | null>(null);
  const [scan, setScan] = useState<
    { state: 'idle' } | { state: 'busy'; step: string } | { state: 'error'; message: string }
  >({ state: 'idle' });
  const [kcalById, setKcalById] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hits: SearchHit[] = useMemo(
    () => (docs && deferred.trim() ? searchFoods(docs, deferred, usage) : []),
    [docs, deferred, usage],
  );

  // kcal / 100 g for the visible hits — one bulk read, keyed by id.
  useEffect(() => {
    const missing = hits.filter((h) => !kcalById.has(h.id)).map((h) => h.id);
    if (missing.length === 0) return;
    let cancelled = false;
    void getFoods(missing).then((foods) => {
      if (cancelled) return;
      setKcalById((prev) => {
        const next = new Map(prev);
        for (const [id, f] of foods) next.set(id, f.per_100g.kcal);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [hits, kcalById]);

  const q = deferred.trim();
  // Online results belong to the query they were fetched for.
  const onlineState: Online = online.q === q ? online.r : { state: 'idle' };

  const pick = async (id: string) => {
    const [food, last] = await Promise.all([getFood(id), lastGramsForFood(id)]);
    if (!food) return;
    // Own foods and packaged products carry a real serving; USDA rows start blank.
    const serving =
      food.source === 'custom' || food.source === 'off' ? food.portions[0]?.grams : undefined;
    setPicked({ food, grams: last ?? serving });
  };

  const pickOnline = async (p: OffProduct) => {
    const food = await cacheOffProduct(p);
    const grams = (await lastGramsForFood(food.id)) ?? p.serving_g;
    setPicked({ food, grams });
  };

  const runScan = async () => {
    const file = await captureImage();
    if (!file) return;
    setScan({ state: 'busy', step: 'Reading the barcode…' });
    try {
      const code = await decodeBarcode(file);
      if (!code) {
        setScan({
          state: 'error',
          message:
            'No barcode found in that photo. Hold it flat, closer and in good light, then try again.',
        });
        return;
      }
      if (!navigator.onLine) {
        setScan({ state: 'error', message: `Read ${code}, but looking it up needs a connection.` });
        return;
      }
      setScan({ state: 'busy', step: `Looking up ${code}…` });
      const product = await lookupBarcode(code);
      if (!product) {
        setScan({
          state: 'error',
          message: `${code} is not in Open Food Facts yet. Add it as a new food from the label.`,
        });
        return;
      }
      const food = await cacheOffProduct(product);
      const grams =
        (await lastGramsForFood(food.id)) ?? product.serving_g ?? food.portions[0]?.grams;
      setScan({ state: 'idle' });
      setPicked({ food, grams });
    } catch (err) {
      setScan({ state: 'error', message: (err as Error).message });
    }
  };

  const runOnline = async () => {
    const term = query.trim();
    if (term.length < 2) return;
    if (!navigator.onLine) {
      setOnline({
        q: term,
        r: {
          state: 'error',
          message: 'You are offline — packaged-food search needs a connection.',
        },
      });
      return;
    }
    setOnline({ q: term, r: { state: 'loading' } });
    try {
      setOnline({ q: term, r: { state: 'done', items: await searchPackaged(term) } });
    } catch (err) {
      setOnline({ q: term, r: { state: 'error', message: (err as Error).message } });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 pb-3">
        <IconButton icon={ChevronLeft} label="Back" onClick={() => navigate(-1)} />
        <div className="relative flex-1">
          <Search
            size={18}
            strokeWidth={2}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted"
          />
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={
              !docs ? 'Loading food database…' : recipe ? 'Add an ingredient' : 'Search foods'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runOnline();
            }}
            className="h-12 w-full rounded-full bg-surface pr-11 pl-12 text-[16px] text-ink outline-none placeholder:text-muted focus:ring-2 focus:ring-accent [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="absolute top-1/2 right-2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted active:bg-surface-2"
            >
              <X size={18} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="rail -mx-4 flex gap-2 overflow-x-auto px-4 pb-3">
        <Chip icon={Camera} onClick={runScan} disabled={scan.state === 'busy'}>
          Scan
        </Chip>
        {!recipe && (
          <Chip icon={PenLine} onClick={() => navigate(`/quick?d=${date}`)}>
            Quick add
          </Chip>
        )}
        <Chip icon={Globe} onClick={runOnline} disabled={q.length < 2}>
          Packaged foods
        </Chip>
        <Chip icon={Plus} onClick={() => navigate(`/foods/new?d=${date}`)}>
          New food
        </Chip>
        {!recipe && (
          <Chip icon={ChefHat} onClick={() => navigate('/recipes')}>
            Recipes
          </Chip>
        )}
      </div>

      <div className="-mx-4 flex-1 overflow-y-auto pb-6">
        {scan.state !== 'idle' && (
          <div className="card mx-4 mb-3 flex items-start gap-3 p-4 text-[14px]">
            {scan.state === 'busy' ? (
              <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-accent" />
            ) : (
              <Camera size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
            )}
            <div className="flex-1">
              <p>{scan.state === 'busy' ? scan.step : scan.message}</p>
              {scan.state === 'error' && (
                <div className="mt-2 flex gap-3">
                  <button type="button" onClick={runScan} className="font-semibold text-accent">
                    Scan again
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/foods/new?d=${date}`)}
                    className="font-semibold text-accent"
                  >
                    New food
                  </button>
                  <button
                    type="button"
                    onClick={() => setScan({ state: 'idle' })}
                    className="font-semibold text-muted"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {!q && docs && (
          <p className="px-4 pt-10 text-center text-[14px] text-muted">
            {docs.length.toLocaleString()} foods available offline. Packaged products come from Open
            Food Facts.
          </p>
        )}

        {q && hits.length > 0 && (
          <ul className="divide-y divide-line">
            {hits.map((h) => (
              <li key={h.id}>
                <ListRow
                  onClick={() => pick(h.id)}
                  wrapTitle
                  title={h.name}
                  subtitle={h.brand ?? SOURCE_LABEL[h.source]}
                  badge={
                    h.source === 'custom' ? (
                      <Badge tone="accent">{h.recipe ? 'Recipe' : 'Mine'}</Badge>
                    ) : h.source === 'off' ? (
                      <Badge>OFF</Badge>
                    ) : undefined
                  }
                  value={kcalById.has(h.id) ? fmt(kcalById.get(h.id)!) : ''}
                  valueSub={kcalById.has(h.id) ? 'kcal / 100 g' : undefined}
                />
              </li>
            ))}
          </ul>
        )}

        {q && docs && hits.length === 0 && onlineState.state === 'idle' && (
          <div className="flex flex-col items-center px-4 pt-8 text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-muted">
              <SearchX size={22} strokeWidth={1.75} aria-hidden />
            </span>
            <p className="font-medium">Not in the offline database</p>
            <p className="mt-1 text-[14px] text-muted">
              Branded and packaged foods live in Open Food Facts.
            </p>
          </div>
        )}

        {q && (
          <div className="px-4 pt-4">
            {onlineState.state === 'idle' && (
              <Button
                variant={hits.length === 0 ? 'primary' : 'secondary'}
                icon={Globe}
                className="w-full"
                onClick={runOnline}
              >
                Search packaged foods for “{q}”
              </Button>
            )}
            {onlineState.state === 'loading' && (
              <div className="space-y-4 pt-2">
                <SectionHeading>Open Food Facts</SectionHeading>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-4 w-12" />
                  </div>
                ))}
              </div>
            )}
            {onlineState.state === 'error' && (
              <div className="card flex items-start gap-3 p-4 text-[14px]">
                <WifiOff size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                <div className="flex-1">
                  <p>{onlineState.message}</p>
                  <button
                    type="button"
                    onClick={runOnline}
                    className="mt-1 font-medium text-accent"
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}
            {onlineState.state === 'done' && (
              <div className="pt-2">
                <SectionHeading trailing={`${onlineState.items.length} results`}>
                  Open Food Facts
                </SectionHeading>
                {onlineState.items.length === 0 ? (
                  <p className="py-6 text-center text-[14px] text-muted">
                    No packaged product found for “{q}”. Try the brand name, or Quick add.
                  </p>
                ) : (
                  <ul className="-mx-4 divide-y divide-line">
                    {onlineState.items.map((p) => (
                      <li key={p.code}>
                        <ListRow
                          onClick={() => pickOnline(p)}
                          wrapTitle
                          title={p.name}
                          subtitle={
                            [p.brand, p.quantity].filter(Boolean).join(' · ') || 'Open Food Facts'
                          }
                          value={fmt(p.per_100g.kcal)}
                          valueSub="kcal / 100 g"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <AmountSheet
        open={picked != null}
        food={picked?.food}
        date={date}
        initialGrams={picked?.grams}
        initialSlot={slot}
        entryMethod="search"
        recipe={recipe ? { id: recipe.id, name: recipe.name } : undefined}
        onClose={() => setPicked(null)}
        onSaved={() =>
          recipe
            ? navigate(`/recipes/${recipe.id}`, { replace: true })
            : navigate(`/?d=${date}`, { replace: true })
        }
      />
    </div>
  );
}
