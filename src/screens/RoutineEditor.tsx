// SPEC §20.3 — building a routine: the list you work through, with its rep ranges and rests.
//
// A routine is a template, not a record. Nothing here is a weight: what you lifted is decided
// set by set in the session, against what you did last time. What a routine fixes is the order,
// how many sets, the rep range you are aiming at, and how long to rest.
import { ArrowDown, ArrowUp, ChevronLeft, Link2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ExercisePicker } from '@/components/ExercisePicker';
import { NumberPad } from '@/components/NumberPad';
import { ExerciseThumb } from '@/components/ExerciseDemo';
import { SwipeRow } from '@/components/SwipeRow';
import { toast } from '@/components/Toast';
import { Button, Card, IconButton, ListRow, Segmented, Sheet } from '@/components/ui';
import { formatClock, REST_PRESETS_SEC } from '@/core/restTimer';
import { moveItem, removeItem, toggleSuperset } from '@/core/routines';
import type { RoutineItem } from '@/core/types';
import { getExercise } from '@/db/repo/exercises';
import { addRoutine, deleteRoutine, nextRoutineOrder, updateRoutine } from '@/db/repo/workouts';
import { warmExerciseMedia } from '@/services/exerciseMedia';
import { useBack } from '@/hooks/useBack';
import { useExercisesByIds, useRoutine } from '@/hooks/useWorkouts';

/**
 * Resolves the routine, then mounts the form keyed on it. The form owns draft state, so it must
 * start from the saved values rather than copy them in afterwards — the same shape AmountSheet
 * uses, and the reason React objects to seeding state from an effect.
 */
export default function RoutineEditor() {
  const { id } = useParams();
  const isNew = id === 'new';
  const existing = useRoutine(isNew ? undefined : id);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNew && existing === null) navigate('/train', { replace: true });
  }, [isNew, existing, navigate]);

  if (isNew) return <RoutineForm key="new" />;
  if (existing == null) return null;
  return (
    <RoutineForm
      key={existing.id}
      id={existing.id}
      initialName={existing.name}
      initialItems={existing.items}
    />
  );
}

function RoutineForm({
  id,
  initialName = '',
  initialItems = [],
}: {
  id?: string;
  initialName?: string;
  initialItems?: RoutineItem[];
}) {
  const isNew = id == null;
  const navigate = useNavigate();
  const back = useBack('/train');

  const [name, setName] = useState(initialName);
  const [items, setItems] = useState<RoutineItem[]>(initialItems);
  const [picking, setPicking] = useState(false);
  const media = useExercisesByIds(items.map((it) => it.exercise_id));
  const [editing, setEditing] = useState<number | null>(null);

  const save = async () => {
    const trimmed = name.trim() || 'Routine';
    if (isNew) {
      await addRoutine({
        name: trimmed,
        items,
        sort_order: await nextRoutineOrder(),
        source: 'own',
      });
    } else if (id) {
      await updateRoutine(id, { name: trimmed, items });
    }
    // A routine you built at home should work in a basement gym, so its demonstrations are
    // fetched now rather than the first time each exercise is opened. Not awaited: the routine
    // is saved either way, and a download is not worth standing still for.
    void warmExerciseMedia(items.map((it) => media?.get(it.exercise_id)?.media));
    navigate('/train', { replace: true });
    toast(`${trimmed} saved`);
  };

  const add = async (exerciseId: string) => {
    setPicking(false);
    const ex = await getExercise(exerciseId);
    if (!ex) return;
    setItems((prev) => [
      ...prev,
      {
        exercise_id: ex.id,
        name: ex.name,
        load_type: ex.load_type,
        sets: 3,
        rep_low: 8,
        rep_high: 12,
        rest_sec: 120,
      },
    ]);
  };

  const patch = (i: number, p: Partial<RoutineItem>) =>
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...p } : it)));

  // All three go through core/routines.ts, which repairs supersets afterwards: a letter only
  // means anything while the exercises carrying it are still next to each other.
  const move = (i: number, by: number) => setItems((prev) => moveItem(prev, i, by));
  const drop = (i: number) => setItems((prev) => removeItem(prev, i));
  const superset = (i: number) => setItems((prev) => toggleSuperset(prev, i));

  const item = editing != null ? items[editing] : undefined;

  return (
    <div className="flex h-full flex-col pb-6">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="flex-1">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">
            {isNew ? 'New routine' : 'Edit routine'}
          </h1>
          <p className="text-[13px] text-muted">The list you work through.</p>
        </div>
        {!isNew && id && (
          <IconButton
            icon={Trash2}
            label="Delete routine"
            className="text-danger"
            onClick={() => {
              void deleteRoutine(id).then(() => {
                navigate('/train', { replace: true });
                toast('Routine deleted');
              });
            }}
          />
        )}
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Push A, Legs, Upper…"
        aria-label="Routine name"
        className="mt-4 w-full rounded-[20px] bg-surface px-4 py-3 text-[17px] font-semibold outline-none placeholder:font-normal placeholder:text-muted focus:ring-2 focus:ring-accent"
      />

      <div className="mt-4 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-[15px] text-ink-2">Nothing in this routine yet.</p>
          </Card>
        ) : (
          <Card className="divide-y divide-line">
            {items.map((it, i) => (
              <SwipeRow
                key={`${it.exercise_id}-${i}`}
                onDelete={() => drop(i)}
                deleteLabel="Remove"
                // `border-l-accent-2`, not `border-accent-2`: the Card's `divide-y` draws its
                // separators as a top border on each child, so colouring every edge would tint
                // the dividers too.
                className={it.superset ? 'border-l-2 border-l-accent-2' : ''}
              >
                {/* One control, not four: the name gets the whole line and everything that can
                    be changed about the item lives in its sheet. */}
                <ListRow
                  className="rise-in"
                  style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                  onClick={() => setEditing(i)}
                  chevron
                  // The name alone does not tell you which of eleven bench presses this is.
                  leading={
                    <ExerciseThumb media={media?.get(it.exercise_id)?.media} name={it.name} />
                  }
                  title={it.name}
                  subtitle={
                    <>
                      {it.superset && (
                        <span className="text-accent-2">Superset {it.superset} · </span>
                      )}
                      {it.sets} × {it.rep_low ?? 8}–{it.rep_high ?? 12} · rest{' '}
                      {formatClock(it.rest_sec ?? 120)}
                    </>
                  }
                />
              </SwipeRow>
            ))}
          </Card>
        )}

        <Button icon={Plus} size="lg" className="mt-3 w-full" onClick={() => setPicking(true)}>
          Add an exercise
        </Button>
      </div>

      <div className="pt-3">
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={items.length === 0}
          onClick={save}
        >
          Save routine
        </Button>
      </div>

      <ExercisePicker open={picking} onClose={() => setPicking(false)} onPick={add} />

      <Sheet open={editing != null} onClose={() => setEditing(null)} title={item?.name}>
        {item && editing != null && (
          <ItemForm
            key={editing}
            item={item}
            index={editing}
            count={items.length}
            onChange={(p) => patch(editing, p)}
            onMove={(by) => {
              move(editing, by);
              setEditing(editing + by);
            }}
            onSuperset={() => superset(editing)}
            onDone={() => setEditing(null)}
          />
        )}
      </Sheet>
    </div>
  );
}

type Field = 'sets' | 'rep_low' | 'rep_high';

function ItemForm({
  item,
  index,
  count,
  onChange,
  onMove,
  onSuperset,
  onDone,
}: {
  item: RoutineItem;
  index: number;
  count: number;
  onChange: (p: Partial<RoutineItem>) => void;
  onMove: (by: number) => void;
  onSuperset: () => void;
  onDone: () => void;
}) {
  const [field, setField] = useState<Field>('sets');
  const [pristine, setPristine] = useState(true);

  const value = String(
    field === 'sets'
      ? item.sets
      : field === 'rep_low'
        ? (item.rep_low ?? 8)
        : (item.rep_high ?? 12),
  );

  return (
    <div className="space-y-4">
      <Segmented
        value={field}
        onChange={(f) => {
          setField(f);
          setPristine(true);
        }}
        options={[
          { value: 'sets', label: `${item.sets} sets` },
          { value: 'rep_low', label: `from ${item.rep_low ?? 8}` },
          { value: 'rep_high', label: `to ${item.rep_high ?? 12}` },
        ]}
      />

      <div className="display text-center">
        {value}
        <span className="ml-1.5 text-[20px] font-medium text-muted">
          {field === 'sets' ? 'sets' : 'reps'}
        </span>
      </div>

      <NumberPad
        maxDigits={2}
        onChange={(u) => {
          const next = u(pristine ? '' : value);
          setPristine(false);
          const n = Number(next);
          if (!Number.isFinite(n)) return;
          onChange({ [field]: Math.max(0, Math.min(99, n)) } as Partial<RoutineItem>);
        }}
        onSubmit={onDone}
      />

      <div>
        <p className="mb-2 px-1 text-[13px] font-semibold text-muted">Rest between sets</p>
        <div className="rail -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          {REST_PRESETS_SEC.map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => onChange({ rest_sec: sec })}
              aria-pressed={(item.rest_sec ?? 120) === sec}
              className={`h-10 shrink-0 rounded-full px-4 text-[14px] font-semibold tabular ${
                (item.rest_sec ?? 120) === sec
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-2 text-ink-2'
              }`}
            >
              {formatClock(sec)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <IconButton
          icon={ArrowUp}
          label="Move up"
          className="bg-surface-2"
          onClick={() => onMove(-1)}
          disabled={index === 0}
        />
        <IconButton
          icon={ArrowDown}
          label="Move down"
          className="bg-surface-2"
          onClick={() => onMove(1)}
          disabled={index === count - 1}
        />
        <Button
          icon={Link2}
          className={`flex-1 ${item.superset ? 'text-accent-2' : ''}`}
          disabled={index === 0}
          onClick={onSuperset}
        >
          {item.superset ? 'Break superset' : 'Superset with the one above'}
        </Button>
      </div>

      <Button variant="primary" size="lg" className="w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
