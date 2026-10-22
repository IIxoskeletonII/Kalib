// SPEC §20.2, §20.19 — choosing an exercise. A search sheet over the 1,426-row library plus
// the user's own, ranked by core/exerciseSearch.ts.
//
// This is the one place in the app a text keyboard is right: you are typing a name, not a
// number (§8 bans the OS keyboard for numbers, not for words). Everything numeric that follows
// goes through the NumberPad.
import { Dumbbell, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchExercises, type ExerciseDoc } from '@/core/exerciseSearch';
import { MUSCLE_LABEL } from '@/core/muscles';
import type { Muscle } from '@/core/types';
import { Badge, Button, Chip, EmptyState, Sheet, Skeleton, fmt } from '@/components/ui';
import { ExerciseDemo, ExerciseThumb } from '@/components/ExerciseDemo';
import { useExerciseDocs } from '@/hooks/useWorkouts';

/**
 * Most rows a browse lists. Every popular exercise fits; "show all" without a filter is the
 * whole library, and past this many it is the search box's job.
 */
const BROWSE_LIMIT = 300;

/** Muscles worth a filter chip, in the order a split is usually planned. */
const FILTERS: Muscle[] = [
  'chest',
  'lats',
  'upper back',
  'shoulders',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'abs',
];

export function ExercisePicker({
  open,
  onClose,
  onPick,
  title = 'Add an exercise',
  usage,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
  title?: string;
  usage?: ReadonlyMap<string, number> | undefined;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {open && <PickerBody onPick={onPick} usage={usage} />}
    </Sheet>
  );
}

function PickerBody({
  onPick,
  usage,
}: {
  onPick: (id: string) => void;
  usage?: ReadonlyMap<string, number> | undefined;
}) {
  const docs = useExerciseDocs();
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  // One open at a time: a list of expanded animations is a list you cannot scan.
  const [shown, setShown] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Browsing shows the exercises a gym works from (§20.19); the library's other thousand-odd
  // variants are one tap away, and always reachable by search.
  const [everything, setEverything] = useState(false);

  const { hits, hidden } = useMemo(() => {
    const all: ExerciseDoc[] = docs ?? [];
    const pool = muscle
      ? all.filter((d) => d.primary_muscle === muscle || d.secondary_muscles?.includes(muscle))
      : all;
    if (q.trim()) return { hits: searchExercises(pool, q, usage, 60), hidden: 0 };
    const used = (d: ExerciseDoc) => usage?.get(d.id) ?? 0;
    const shown = everything ? pool : pool.filter((d) => d.popular || d.custom || used(d) > 0);
    // What you actually train first, then your own, then — under a muscle filter — what trains
    // that muscle first rather than also, then the rest alphabetically. "Chest" opening on
    // Burpee and Bench Dip, which only touch it, would be the wrong answer to the question.
    const primary = (d: ExerciseDoc) => Number(muscle != null && d.primary_muscle === muscle);
    const sorted = [...shown]
      .sort(
        (a, b) =>
          used(b) - used(a) ||
          Number(b.custom) - Number(a.custom) ||
          primary(b) - primary(a) ||
          (a.name < b.name ? -1 : 1),
      )
      .slice(0, BROWSE_LIMIT)
      .map((d) => ({ ...d, score: 0 }));
    return { hits: sorted, hidden: pool.length - shown.length };
  }, [docs, q, muscle, usage, everything]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          size={18}
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
          enterKeyHint="search"
          placeholder="Bench, squat, rdl…"
          aria-label="Search exercises"
          // The browser's own clear control is hidden: ours sits in the same place, and two
          // crosses side by side read as a glitch.
          className="w-full rounded-full bg-surface-2 py-3 pr-11 pl-11 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent [&::-webkit-search-cancel-button]:appearance-none"
        />
        {q && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQ('');
              input.current?.focus();
            }}
            className="absolute top-1/2 right-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface-3 text-muted"
          >
            <X size={15} strokeWidth={2.6} aria-hidden />
          </button>
        )}
      </div>

      <div className="rail -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        {FILTERS.map((m) => (
          <Chip
            key={m}
            active={muscle === m}
            onClick={() => setMuscle(muscle === m ? null : m)}
            className="shrink-0"
          >
            {MUSCLE_LABEL[m]}
          </Chip>
        ))}
      </div>

      {docs == null ? (
        <div className="space-y-2 py-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : hits.length === 0 ? (
        <EmptyState
          icon={Dumbbell}
          title="Nothing matches"
          body={
            muscle
              ? 'Try clearing the muscle filter, or a different word.'
              : 'Try a shorter word — “bench” finds more than “barbell bench press”.'
          }
        />
      ) : (
        <ul className="max-h-[48dvh] divide-y divide-line overflow-y-auto">
          {hits.map((h, i) => (
            <li
              key={h.id}
              className="rise-in"
              style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
            >
              <div className="flex items-center gap-3">
                {/* The still is its own control: the row picks the exercise, the picture shows
                    it. Separating them means you can look without choosing, which is the whole
                    difficulty with a list of eleven things all called bench press. */}
                <button
                  type="button"
                  onClick={() => setShown(shown === h.id ? null : h.id)}
                  aria-expanded={shown === h.id}
                  aria-label={
                    shown === h.id ? `Hide how to do ${h.name}` : `See how to do ${h.name}`
                  }
                  className="my-1.5 rounded-xl"
                >
                  <ExerciseThumb media={h.media} name={h.name} />
                </button>
                <button
                  type="button"
                  onClick={() => onPick(h.id)}
                  className="min-w-0 flex-1 py-3 text-left active:bg-surface-2"
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[16px] font-medium">{h.name}</span>
                    {h.custom && <Badge tone="accent">Mine</Badge>}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-muted">
                    {MUSCLE_LABEL[h.primary_muscle]} · {h.equipment}
                  </span>
                </button>
              </div>
              {shown === h.id && (
                <ExerciseDemo media={h.media} name={h.name} className="mb-3 ml-14 max-w-[180px]" />
              )}
            </li>
          ))}
          {!q.trim() && (hidden > 0 || everything) && (
            <li className="py-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setEverything(!everything)}
              >
                {everything ? 'Show the usual ones only' : `Show ${fmt(hidden)} more variants`}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
