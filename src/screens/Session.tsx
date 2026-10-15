// SPEC §20.3 — the live session. The screen someone stands in front of a rack holding.
//
// Two decisions shape it. Numbers are entered on a docked NumberPad rather than the OS keyboard
// (§8): the pad sits under the list, the selected cell carries a ring, and moving between
// weight and reps is one tap with no keyboard animation in between. And every set shows what
// was done last time in the same row, because that — not a record from eighteen months ago —
// is the number you are trying to beat.
import { BookOpen, Check, ChevronLeft, Flame, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ExercisePicker } from '@/components/ExercisePicker';
import { MicButton } from '@/components/MicButton';
import { NumberPad } from '@/components/NumberPad';
import { RestBar } from '@/components/RestBar';
import { SwipeRow } from '@/components/SwipeRow';
import { toast } from '@/components/Toast';
import { Button, Card, IconButton, Sheet } from '@/components/ui';
import { usesReps, usesWeight } from '@/core/exercises';
import { describePlates, plateLoad, warmupRamp } from '@/core/plates';
import { formatClock } from '@/core/restTimer';
import { isWorkingSet } from '@/core/sets';
import type { LoadType, WorkoutEntry, WorkoutSession, WorkoutSet } from '@/core/types';
import { describeSpokenSet, parseSpokenSet } from '@/core/voiceSet';
import { displayValue, fromDisplay, formatWeight, UNIT_LABEL } from '@/core/weightUnit';
import { getExercise } from '@/db/repo/exercises';
import { useBack } from '@/hooks/useBack';
import {
  elapsedSince,
  useActiveSession,
  useExercisesByIds,
  useLastPerformances,
  useNow,
  useWeightUnit,
} from '@/hooks/useWorkouts';
import {
  addExercise,
  addSet,
  discardSession,
  finishSession,
  removeEntry,
  removeSet,
  replaceSets,
  toggleSetDone,
  updateSet,
} from '@/services/workouts';

type Field = 'weight' | 'reps' | 'seconds';
interface Editing {
  e: number;
  s: number;
  field: Field;
}

export default function Session() {
  const session = useActiveSession();
  const navigate = useNavigate();
  const back = useBack('/train');

  // A session that has ended (or never started) has no business on this screen.
  useEffect(() => {
    if (session === null) navigate('/train', { replace: true });
  }, [session, navigate]);

  if (session == null) return null;
  return <SessionView session={session} onLeave={back} />;
}

function SessionView({ session, onLeave }: { session: WorkoutSession; onLeave: () => void }) {
  const navigate = useNavigate();
  const unit = useWeightUnit();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState('');
  const [pristine, setPristine] = useState(true);
  const [picking, setPicking] = useState(false);
  const [menu, setMenu] = useState<number | 'session' | null>(null);

  const now = useNow(true);
  const elapsed = elapsedSince(session.started_at, now);

  const exerciseIds = useMemo(() => session.entries.map((e) => e.exercise_id), [session.entries]);
  const previous = useLastPerformances(exerciseIds, session.id);
  const exercises = useExercisesByIds(exerciseIds);

  const totals = useMemo(() => {
    let done = 0;
    let total = 0;
    for (const e of session.entries) {
      for (const s of e.sets) {
        total++;
        if (isWorkingSet(s)) done++;
      }
    }
    return { done, total };
  }, [session.entries]);

  /** Writes the pad's value into the set it belongs to. */
  const commit = async (at: Editing, value: string) => {
    const n = Number(value);
    if (value === '' || !Number.isFinite(n)) return;
    const patch: Partial<WorkoutSet> =
      at.field === 'weight'
        ? { weight_kg: fromDisplay(n, unit) }
        : at.field === 'reps'
          ? { reps: Math.round(n) }
          : { seconds: Math.round(n) };
    await updateSet(session.id, at.e, at.s, patch);
  };

  const select = async (next: Editing | null) => {
    if (editing) await commit(editing, draft);
    setEditing(next);
    setPristine(true);
    if (!next) {
      setDraft('');
      return;
    }
    const set = session.entries[next.e]?.sets[next.s];
    setDraft(
      next.field === 'weight'
        ? set?.weight_kg != null
          ? displayValue(set.weight_kg, unit)
          : ''
        : next.field === 'reps'
          ? set?.reps != null
            ? String(set.reps)
            : ''
          : set?.seconds != null
            ? String(set.seconds)
            : '',
    );
  };

  const tick = async (e: number, s: number) => {
    if (editing) {
      await commit(editing, draft);
      setEditing(null);
      setDraft('');
    }
    const entry = session.entries[e];
    const set = entry?.sets[s];
    // Accepting the ghost is the whole point of showing it: repeating last week's set is one
    // tap, and only then does the suggestion become a logged figure.
    if (entry && set && !set.done) {
      const ghost = previous?.get(entry.exercise_id)?.sets[s];
      const patch: Partial<WorkoutSet> = {};
      if (set.weight_kg == null && ghost?.weight_kg != null) patch.weight_kg = ghost.weight_kg;
      if (set.reps == null && ghost?.reps != null) patch.reps = ghost.reps;
      if (set.seconds == null && ghost?.seconds != null) patch.seconds = ghost.seconds;
      if (Object.keys(patch).length > 0) await updateSet(session.id, e, s, patch);
    }
    const r = await toggleSetDone(session.id, e, s);
    if (r.done) void navigator.vibrate?.(8);
  };

  const finish = async () => {
    if (editing) await commit(editing, draft);
    const result = await finishSession(session.id);
    // The summary is where the totals, the records and the energy figure live; a toast cannot
    // carry the sentence that makes the energy figure safe to show.
    if (result) {
      // `justFinished` is how the summary knows which of its two jobs it is doing: the end of
      // a workout, or a session read back from history weeks later.
      navigate(`/train/summary/${encodeURIComponent(session.id)}`, {
        replace: true,
        state: { justFinished: true },
      });
    } else navigate('/train', { replace: true });
  };

  /**
   * A set, said out loud. Fills the first set not yet ticked on the exercise being worked,
   * reads back what it understood, and leaves it to be confirmed with the tick rather than
   * writing it through silently — a misheard number would otherwise become next week's target.
   */
  const heard = async (text: string) => {
    const parsed = parseSpokenSet(text);
    if (!parsed) {
      toast('Did not catch that. Try "eighty for eight".');
      return;
    }
    const ei = session.entries.findIndex((e) => e.sets.some((x) => !x.done));
    if (ei < 0) {
      toast('Every set is already done.');
      return;
    }
    const entry = session.entries[ei]!;
    const si = entry.sets.findIndex((x) => !x.done);
    const patch: Partial<WorkoutSet> = {};
    if (parsed.weight != null && usesWeight(entry.load_type)) {
      // A unit spoken aloud wins over the app's setting: "225 pounds" means pounds even on a
      // phone set to kilograms.
      patch.weight_kg = fromDisplay(parsed.weight, parsed.unit ?? unit);
    }
    if (parsed.reps != null && usesReps(entry.load_type)) patch.reps = parsed.reps;
    if (parsed.seconds != null) patch.seconds = parsed.seconds;
    if (parsed.rir != null) patch.rir = parsed.rir;
    if (Object.keys(patch).length === 0) {
      toast(`That does not fit ${entry.name}.`);
      return;
    }
    await updateSet(session.id, ei, si, patch);
    toast(`${entry.name} set ${si + 1}: ${describeSpokenSet(parsed, unit)}`);
  };

  const pick = async (id: string) => {
    const ex = await getExercise(id);
    setPicking(false);
    if (ex) await addExercise(session.id, ex);
  };

  /**
   * The weight a warm-up would ramp to: the first working set's own figure, or the one it is
   * suggesting. Nothing to ramp to means the control is not offered.
   */
  const warmupFor = (ei: number) => {
    const entry = session.entries[ei];
    if (!entry || entry.load_type !== 'weight_reps') return undefined;
    const working = entry.sets.find((x) => x.kind !== 'warmup');
    const ghost = previous?.get(entry.exercise_id)?.sets[0];
    const kg = working?.weight_kg ?? ghost?.weight_kg;
    if (kg == null || kg <= 0) return undefined;
    const ramp = warmupRamp(kg, { unit });
    if (ramp.length === 0) return undefined;
    return { ramp, target: formatWeight(kg, unit) };
  };

  const addWarmup = async (ei: number) => {
    const plan = warmupFor(ei);
    setMenu(null);
    if (!plan) return;
    const entry = session.entries[ei];
    if (!entry) return;
    // Warm-ups go in front, already ticked off as the plan rather than as work: they are
    // excluded from volume and from records (core/sets.ts), so they cost the history nothing.
    const sets: WorkoutSet[] = [
      ...plan.ramp.map((w) => ({
        kind: 'warmup' as const,
        weight_kg: w.weight_kg,
        reps: w.reps,
        done: false,
      })),
      ...entry.sets.filter((x) => x.kind !== 'warmup'),
    ];
    await replaceSets(session.id, ei, sets);
  };

  const padFor = editing ? session.entries[editing.e]?.load_type : undefined;
  // Only for a bar: "bar + 25 + 7.5 a side" is nonsense for a dumbbell or a stack.
  const editingEquipment = editing
    ? exercises?.get(session.entries[editing.e]?.exercise_id ?? '')?.equipment
    : undefined;
  const onABar = editingEquipment != null && /barbell|smith/i.test(editingEquipment);
  const plates =
    editing?.field === 'weight' && onABar && draft !== ''
      ? plateLoad(fromDisplay(Number(draft) || 0, unit), { unit })
      : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={onLeave} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] leading-tight font-bold tracking-[-0.01em]">
            {session.name}
          </h1>
          <p className="text-[13px] text-muted tabular">
            {formatClock(elapsed)} · {totals.done} of {totals.total} sets
          </p>
        </div>
        <IconButton
          icon={MoreHorizontal}
          label="Workout options"
          onClick={() => setMenu('session')}
        />
      </div>

      <RestBar />

      <div className="mt-3 flex-1 space-y-4 overflow-y-auto pb-6">
        {session.entries.length === 0 && (
          <Card className="p-6 text-center">
            <p className="text-[15px] text-ink-2">Nothing in this workout yet.</p>
            <Button
              variant="primary"
              size="lg"
              icon={Plus}
              className="mt-4 w-full"
              onClick={() => setPicking(true)}
            >
              Add an exercise
            </Button>
          </Card>
        )}

        {session.entries.map((entry, ei) => (
          <ExerciseBlock
            key={`${entry.exercise_id}-${ei}`}
            entry={entry}
            index={ei}
            unit={unit}
            previous={previous?.get(entry.exercise_id)?.sets}
            firstOfSuperset={
              entry.superset != null && session.entries[ei - 1]?.superset !== entry.superset
            }
            editing={editing?.e === ei ? editing : null}
            draft={draft}
            onSelect={select}
            onTick={tick}
            onAddSet={() => void addSet(session.id, ei)}
            onRemoveSet={(si) => void removeSet(session.id, ei, si)}
            onMenu={() => setMenu(ei)}
          />
        ))}

        {session.entries.length > 0 && (
          <Button icon={Plus} size="lg" className="w-full" onClick={() => setPicking(true)}>
            Add an exercise
          </Button>
        )}
      </div>

      {editing && padFor ? (
        <div className="sheet-in border-t border-line bg-surface px-4 pt-3 pb-2 safe-bottom">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 text-[13px] font-semibold text-muted">
              {editing.field === 'weight' && plates ? (
                // Arithmetic done between sets, badly, while tired. Hevy charges for this.
                <span className="tabular">
                  <span className="text-ink-2">Bar + {describePlates(plates)}</span>
                  <span className="text-muted"> a side</span>
                  {plates.short_kg > 0 && (
                    <span className="text-muted">
                      {' '}
                      · {formatWeight(plates.short_kg, unit)} short
                    </span>
                  )}
                </span>
              ) : (
                <>
                  Set {editing.s + 1} ·{' '}
                  {editing.field === 'weight'
                    ? `Weight (${UNIT_LABEL[unit]})`
                    : editing.field === 'reps'
                      ? 'Reps'
                      : 'Seconds'}
                </>
              )}
            </span>
            <Button size="sm" onClick={() => void select(null)}>
              Done
            </Button>
          </div>
          <NumberPad
            decimal={editing.field === 'weight'}
            maxDigits={editing.field === 'weight' ? 5 : 4}
            onChange={(u) => {
              setDraft((prev) => u(pristine ? '' : prev));
              setPristine(false);
            }}
            onSubmit={() => {
              // Enter moves to the next field rather than closing: weight then reps is the
              // order every set is entered in.
              if (editing.field === 'weight' && usesReps(padFor)) {
                void select({ ...editing, field: 'reps' });
              } else {
                void select(null);
              }
            }}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-line bg-surface px-4 pt-3 pb-2 safe-bottom">
          {/* Chalky hands, heart rate up, phone on the floor: saying the set is the shortest
              path there is, and the recogniser is already here for describing meals. */}
          <MicButton
            label="Say the set"
            className="h-14 w-14 shrink-0 rounded-full bg-surface-2"
            onText={(text, final) => {
              if (final) void heard(text);
            }}
          />
          <Button variant="primary" size="lg" className="flex-1" onClick={finish}>
            Finish workout
          </Button>
        </div>
      )}

      <ExercisePicker open={picking} onClose={() => setPicking(false)} onPick={pick} />

      <Sheet
        open={menu != null}
        onClose={() => setMenu(null)}
        title={menu === 'session' ? session.name : session.entries[menu as number]?.name}
      >
        <div className="space-y-2">
          {menu === 'session' ? (
            <Button
              variant="danger"
              size="lg"
              icon={Trash2}
              className="w-full"
              onClick={() => {
                void discardSession(session.id).then(() => {
                  setMenu(null);
                  navigate('/train', { replace: true });
                  toast('Workout discarded');
                });
              }}
            >
              Discard this workout
            </Button>
          ) : (
            <>
              {warmupFor(menu as number) && (
                <Button
                  size="lg"
                  icon={Flame}
                  className="w-full"
                  onClick={() => void addWarmup(menu as number)}
                >
                  Warm up to {warmupFor(menu as number)!.target}
                </Button>
              )}
              <Button
                size="lg"
                icon={BookOpen}
                className="w-full"
                onClick={() => {
                  const id = session.entries[menu as number]?.exercise_id;
                  setMenu(null);
                  if (id) navigate(`/train/exercise/${encodeURIComponent(id)}`);
                }}
              >
                How it is done
              </Button>
              <Button
                variant="danger"
                size="lg"
                icon={Trash2}
                className="w-full"
                onClick={() => {
                  const i = menu as number;
                  void removeEntry(session.id, i).then(() => setMenu(null));
                }}
              >
                Remove this exercise
              </Button>
            </>
          )}
        </div>
      </Sheet>
    </div>
  );
}
function ExerciseBlock({
  entry,
  index,
  unit,
  previous,
  firstOfSuperset,
  editing,
  draft,
  onSelect,
  onTick,
  onAddSet,
  onRemoveSet,
  onMenu,
}: {
  entry: WorkoutEntry;
  index: number;
  unit: 'kg' | 'lb';
  previous: WorkoutSet[] | undefined;
  firstOfSuperset: boolean;
  editing: Editing | null;
  draft: string;
  onSelect: (e: Editing | null) => void;
  onTick: (e: number, s: number) => void;
  onAddSet: () => void;
  onRemoveSet: (s: number) => void;
  onMenu: () => void;
}) {
  // The cells already carry last time's figures as ghosts, so repeating them here would be
  // saying it twice. This line carries what they cannot: the rest interval, which is otherwise
  // invisible until a set is ticked, and whether there is any history at all.
  const meta = previous?.length
    ? entry.rest_sec != null
      ? `Rest ${formatClock(entry.rest_sec)}`
      : undefined
    : 'First time — the cells start empty';

  return (
    <section
      className={`rise-in ${entry.superset ? 'border-l-2 border-l-accent-2 pl-3' : ''}`}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="mb-2 flex items-start gap-2 px-1">
        <div className="min-w-0 flex-1">
          {/* The name gets the whole line: a row's primary text never truncates for a badge. */}
          <h2 className="text-[17px] leading-snug font-bold">{entry.name}</h2>
          <p className="mt-0.5 truncate text-[13px] text-muted tabular">
            {/* The rule down the left already groups a superset, so the word appears once, on
                the first member, rather than on every one of them. */}
            {firstOfSuperset && (
              <span className="text-accent-2">
                Superset {entry.superset}
                {meta ? ' · ' : ''}
              </span>
            )}
            {meta}
          </p>
        </div>
        <IconButton
          icon={MoreHorizontal}
          label={`${entry.name} options`}
          size={18}
          className="-mt-1 h-9 w-9 text-muted"
          onClick={onMenu}
        />
      </div>

      <Card className="divide-y divide-line">
        <div className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold text-muted">
          <span className="w-7">Set</span>
          <span className="flex-1" />
          {usesWeight(entry.load_type) && (
            <span className="w-[86px] text-center">{UNIT_LABEL[unit]}</span>
          )}
          <span className="w-[76px] text-center">
            {usesReps(entry.load_type) ? 'Reps' : 'Seconds'}
          </span>
          <span className="w-9" />
        </div>

        {entry.sets.map((set, si) => (
          <SwipeRow key={si} onDelete={() => onRemoveSet(si)} deleteLabel="Remove set">
            <SetRow
              set={set}
              index={si}
              load_type={entry.load_type}
              unit={unit}
              ghost={previous?.[si]}
              editing={editing?.s === si ? editing.field : null}
              draft={draft}
              onSelect={(field) => onSelect({ e: index, s: si, field })}
              onTick={() => onTick(index, si)}
            />
          </SwipeRow>
        ))}
      </Card>

      <button
        type="button"
        onClick={onAddSet}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-full bg-surface-2 py-2.5 text-[14px] font-semibold text-ink-2 active:scale-[0.98]"
      >
        <Plus size={16} strokeWidth={2.4} aria-hidden /> Add set
      </button>
    </section>
  );
}

/**
 * One set.
 *
 * The cells carry what you did last time as a ghost — real enough to accept with the tick,
 * faint enough to read as a suggestion rather than a record. Repeating a weight therefore costs
 * one tap instead of two numbers on the pad, and the figure appears once instead of twice:
 * Hevy prefills the input *and* prints the same value in a Previous column beside it, which
 * spends a whole column saying something the cell already says.
 */
function SetRow({
  set,
  index,
  load_type,
  unit,
  ghost,
  editing,
  draft,
  onSelect,
  onTick,
}: {
  set: WorkoutSet;
  index: number;
  load_type: LoadType;
  unit: 'kg' | 'lb';
  ghost: WorkoutSet | undefined;
  editing: Field | null;
  draft: string;
  onSelect: (f: Field) => void;
  onTick: () => void;
}) {
  const done = set.done;

  const cell = (field: Field, width: string) => {
    const active = editing === field;
    const own =
      field === 'weight'
        ? set.weight_kg != null
          ? displayValue(set.weight_kg, unit)
          : undefined
        : field === 'reps'
          ? set.reps != null
            ? String(set.reps)
            : undefined
          : set.seconds != null
            ? String(set.seconds)
            : undefined;
    const suggestion =
      field === 'weight'
        ? ghost?.weight_kg != null
          ? displayValue(ghost.weight_kg, unit)
          : undefined
        : field === 'reps'
          ? ghost?.reps != null
            ? String(ghost.reps)
            : undefined
          : ghost?.seconds != null
            ? String(ghost.seconds)
            : undefined;

    const shown = active ? draft : (own ?? suggestion ?? '—');
    const isGhost = !active && own == null && suggestion != null;

    return (
      <button
        type="button"
        onClick={() => onSelect(field)}
        aria-label={`${field} for set ${index + 1}`}
        className={`${width} rounded-xl py-2.5 text-center text-[17px] tabular font-semibold transition-colors ${
          active ? 'bg-surface-3 ring-2 ring-accent' : 'bg-surface-2'
        } ${isGhost || (done && !active) ? 'text-muted' : 'text-ink'}`}
      >
        {active && draft === '' ? <span className="text-surface-3">0</span> : shown}
      </button>
    );
  };

  return (
    <div className={`flex items-center gap-2 px-4 py-2 ${done ? 'bg-surface-2/40' : ''}`}>
      <span
        className={`w-7 text-[15px] tabular font-semibold ${done ? 'text-muted' : 'text-ink-2'}`}
      >
        {set.kind === 'warmup' ? 'W' : index + 1}
      </span>
      <span className="flex-1" />

      {usesWeight(load_type) && cell('weight', 'w-[86px]')}
      {usesReps(load_type) ? cell('reps', 'w-[76px]') : cell('seconds', 'w-[76px]')}

      {/* The house checklist mark (DailyChecks): 28 pt, a bare ring when open — a greyed check
          in an un-ticked row reads as half-finished — and an accent fill with the tick when done. */}
      <button
        type="button"
        onClick={onTick}
        aria-label={done ? `Mark set ${index + 1} not done` : `Complete set ${index + 1}`}
        aria-pressed={done}
        className="flex h-9 w-9 shrink-0 items-center justify-center"
      >
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full border-2 transition-[background-color,border-color] duration-200 ${
            done ? 'pop border-accent bg-accent text-on-accent' : 'border-surface-3'
          }`}
          aria-hidden
        >
          {done && <Check size={16} strokeWidth={3} />}
        </span>
      </button>
    </div>
  );
}
