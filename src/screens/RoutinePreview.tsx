// SPEC §20.17 — a routine, before you start it.
//
// Tapping a routine used to start it, which is a commitment made by brushing a list. Now it
// opens this: what is in it, how long it takes, what it works, what you did last time and what
// to aim for today, with Start at the bottom where a thumb is. The figures sit on the page and
// the exercises are the one card, as everywhere else (MASTER).
import { ChevronLeft, Dumbbell, Pencil, Play } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { RoutineMuscles } from '@/components/bodyMap/RoutineMuscles';
import { ExerciseThumb } from '@/components/ExerciseDemo';
import { toast } from '@/components/Toast';
import { Button, Card, EmptyState, IconButton, SectionHeading, Skeleton } from '@/components/ui';
import { dayLabel, weekdayLong } from '@/components/scheduleText';
import { todayKey } from '@/core/dates';
import { MUSCLE_LABEL } from '@/core/muscles';
import type { Prescription } from '@/core/progression';
import { describeRest, describeSets, describeTarget, groupSupersets } from '@/core/routineSummary';
import type { RoutineItem, WeightUnit } from '@/core/types';
import { formatEstimate, formatWeight } from '@/core/weightUnit';
import { useBack } from '@/hooks/useBack';
import { useRoutinePreview } from '@/hooks/useSchedule';
import { useActiveSession, useWeightUnit } from '@/hooks/useWorkouts';
import type { PreviewItem } from '@/services/routinePreview';
import { startSession } from '@/services/workouts';

/** "today" and "yesterday" read mid-sentence in lower case; a date keeps its capital. */
const relative = (label: string) =>
  label === 'Today' || label === 'Yesterday' ? label.toLowerCase() : label;

export default function RoutinePreview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const back = useBack('/train');
  const p = useRoutinePreview(id);
  const active = useActiveSession();
  const unit = useWeightUnit();
  const today = todayKey();

  if (p === null) {
    return (
      <div className="pb-10">
        <header className="flex items-start gap-1 pt-1">
          <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        </header>
        <EmptyState
          icon={Dumbbell}
          title="This routine is gone"
          body="It was deleted, or the link is out of date."
          action={
            <Button onClick={() => navigate('/train', { replace: true })}>Go to Train</Button>
          }
        />
      </div>
    );
  }

  const start = async () => {
    if (!p) return;
    try {
      await startSession(p.routine);
      navigate('/train/session');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const context = !p
    ? ''
    : p.next_on
      ? p.next_on === today
        ? 'On today'
        : `Next on ${weekdayLong(p.next_on, today)}`
      : p.is_next
        ? 'Up next'
        : p.last_done
          ? `Last done ${relative(dayLabel(p.last_done, today))}`
          : 'Not done yet';

  const runningHere = active && p && active.routine_id === p.routine.id;

  return (
    <div className="flex h-full flex-col pb-6">
      <header className="flex items-start gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-[14px] font-medium text-muted">{context || ' '}</p>
          <h1 className="mt-0.5 text-[24px] leading-tight font-extrabold tracking-[-0.03em]">
            {p?.routine.name ?? ''}
          </h1>
        </div>
        {p && (
          <IconButton
            icon={Pencil}
            label="Edit routine"
            size={20}
            onClick={() => navigate(`/train/routine/${encodeURIComponent(p.routine.id)}`)}
          />
        )}
      </header>

      <div className="mt-2 flex-1 overflow-y-auto">
        {!p ? (
          <Skeleton className="mt-5 h-[320px] w-full rounded-[24px]" />
        ) : (
          <>
            {/* The figures sit on the page. */}
            <section className="mt-5 flex items-end gap-6" aria-label="Size">
              <Figure value={String(p.routine.items.length)} label="exercises" />
              <Figure value={String(p.sets)} label="sets" />
              {p.minutes > 0 && <Figure value={`~${p.minutes}`} label="min" />}
            </section>

            {p.muscles.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Muscles worked">
                {p.muscles.map((m) => (
                  <li
                    key={m.muscle}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] text-ink-2"
                  >
                    {MUSCLE_LABEL[m.muscle]}
                    <span className="text-muted tabular">{m.sets}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* The same day on the body (§20.18), scaled to a session rather than a week. */}
            <RoutineMuscles routineId={p.routine.id} className="mt-4" />

            <section className="mt-7" aria-label="Exercises">
              <SectionHeading>Exercises</SectionHeading>
              {p.routine.items.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={Dumbbell}
                    title="Nothing in it yet"
                    body="Add exercises in the editor, then they show here."
                  />
                </Card>
              ) : (
                <Card className="divide-y divide-line">
                  {groupSupersets(p.routine.items).map((g) => (
                    <div
                      key={`${g.superset ?? 'x'}-${g.items[0]!.index}`}
                      className={g.superset ? 'border-l-[3px] border-l-accent-2' : ''}
                    >
                      {g.superset && (
                        <div className="px-4 pt-3 text-[12px] font-semibold text-accent-2">
                          Superset {g.superset}
                        </div>
                      )}
                      {g.items.map(({ item, index }) => (
                        <ItemRow
                          key={index}
                          item={item}
                          info={p.items[index]!}
                          unit={unit}
                          onOpen={() =>
                            navigate(`/train/exercise/${encodeURIComponent(item.exercise_id)}`)
                          }
                        />
                      ))}
                    </div>
                  ))}
                </Card>
              )}
            </section>
          </>
        )}
      </div>

      <div className="pt-3">
        {runningHere ? (
          <Button
            variant="primary"
            size="lg"
            icon={Play}
            className="w-full"
            onClick={() => navigate('/train/session')}
          >
            Carry on
          </Button>
        ) : active ? (
          <>
            <Button size="lg" className="w-full" onClick={() => navigate('/train/session')}>
              Go to the workout in progress
            </Button>
            <p className="mt-2 text-center text-[12px] text-muted">
              {active.name} is still running. Finish it before starting another.
            </p>
          </>
        ) : (
          <Button
            variant="primary"
            size="lg"
            icon={Play}
            className="w-full"
            disabled={!p || p.routine.items.length === 0}
            onClick={() => void start()}
          >
            Start workout
          </Button>
        )}
      </div>
    </div>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-[28px] leading-none font-extrabold tracking-[-0.02em] tabular">
        {value}
      </div>
      <div className="mt-1 text-[13px] font-medium text-muted">{label}</div>
    </div>
  );
}

/** What to aim for next time, from §20.8, in the session's own words where it has a number. */
function aimLine(p: Prescription | undefined, unit: WeightUnit): string | undefined {
  if (!p || p.kind === 'no_advice' || p.kind === 'first_time') return undefined;
  const w = p.weight_kg != null ? formatWeight(p.weight_kg, unit) : undefined;
  const reps = p.reps != null ? `${p.reps} reps` : undefined;
  const target = w && p.reps != null ? `${w} × ${p.reps}` : (w ?? reps);
  if (!target) return undefined;
  // "Aim", not "today": the page is read days before the routine comes round.
  switch (p.kind) {
    case 'add_load':
      return `Aim ${target}, up from last time`;
    case 'deload':
      return `Aim ${target}, a step back to build again`;
    case 'easy':
      return `Easier week: ${target}`;
    default:
      return `Aim ${target}`;
  }
}

function ItemRow({
  item,
  info,
  unit,
  onOpen,
}: {
  item: RoutineItem;
  info: PreviewItem;
  unit: WeightUnit;
  onOpen: () => void;
}) {
  const plan = [describeTarget(item), describeRest(item.rest_sec)].filter(Boolean).join(' · ');
  const last = info.last ? describeSets(info.last.sets, item.load_type, unit) : undefined;
  const r = info.records;
  const best =
    r.best_e1rm_kg != null
      ? `Best est. 1RM ${formatEstimate(r.best_e1rm_kg, unit)}`
      : r.heaviest_kg != null && r.heaviest_kg > 0
        ? `Heaviest ${formatWeight(r.heaviest_kg, unit)}${r.heaviest_reps ? ` × ${r.heaviest_reps}` : ''}`
        : r.best_seconds != null
          ? `Longest ${Math.round(r.best_seconds)} s`
          : undefined;
  const aim = aimLine(info.prescription, unit);
  const name = info.exercise?.name ?? item.name;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3.5 px-4 py-3.5 text-left transition-colors duration-150 active:bg-surface-2"
    >
      <ExerciseThumb media={info.exercise?.media} name={name} />
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] leading-snug font-medium">{name}</span>
        <span className="mt-0.5 block text-[13px] text-ink-2 tabular">{plan}</span>
        {aim && (
          <span className="mt-1 block text-[13px] font-semibold text-accent-2 tabular">{aim}</span>
        )}
        <span className="mt-0.5 block text-[13px] text-muted tabular">
          {last ? `Last ${last}` : 'Not done yet'}
          {best ? ` · ${best}` : ''}
        </span>
      </span>
    </button>
  );
}
