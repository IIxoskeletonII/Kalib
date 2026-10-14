// SPEC §20.2 / §20.5 — one exercise: how it is done, what you have lifted on it, and when.
import { ChevronLeft } from 'lucide-react';
import { useParams } from 'react-router';
import { ExerciseDemo } from '@/components/ExerciseDemo';
import { Badge, Card, EmptyState, IconButton, Row, SectionHeading } from '@/components/ui';
import { MUSCLE_LABEL } from '@/core/muscles';
import { formatDuration } from '@/core/restTimer';
import { isWorkingSet } from '@/core/sets';
import { formatWeight } from '@/core/weightUnit';
import { Dumbbell } from 'lucide-react';
import { useBack } from '@/hooks/useBack';
import { useExercise, useExerciseHistory, useExercisePR, useWeightUnit } from '@/hooks/useWorkouts';

/** The library shouts its equipment in lower case; the muscle beside it is sentence case. */
function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function ExerciseDetail() {
  const { id } = useParams();
  const exercise = useExercise(id);
  const pr = useExercisePR(id);
  const history = useExerciseHistory(id);
  const unit = useWeightUnit();
  const back = useBack('/train');

  if (exercise === undefined) return null;
  if (exercise === null) {
    return (
      <div className="pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <EmptyState
          icon={Dumbbell}
          title="Exercise not found"
          body="It may have been deleted on another device."
        />
      </div>
    );
  }

  return (
    <div className="pb-24">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] leading-tight font-bold tracking-[-0.01em]">
            {exercise.name}
          </h1>
          <p className="truncate text-[13px] text-muted">
            {MUSCLE_LABEL[exercise.primary_muscle]} · {sentence(exercise.equipment)}
          </p>
        </div>
        {exercise.source === 'custom' && <Badge tone="accent">Mine</Badge>}
      </div>

      <ExerciseDemo media={exercise.media} name={exercise.name} className="mt-4" />

      {exercise.secondary_muscles.length > 0 && (
        <p className="mt-3 px-1 text-[13px] text-muted">
          Also works{' '}
          {exercise.secondary_muscles.map((m) => MUSCLE_LABEL[m].toLowerCase()).join(', ')}.
        </p>
      )}

      {exercise.instructions && exercise.instructions.length > 0 && (
        <section className="mt-7">
          <SectionHeading>How it is done</SectionHeading>
          <Card className="p-5">
            <ol className="space-y-3">
              {exercise.instructions.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[12px] font-bold tabular text-ink-2">
                    {i + 1}
                  </span>
                  <span className="text-[15px] leading-snug text-ink-2">{step}</span>
                </li>
              ))}
            </ol>
          </Card>
        </section>
      )}

      {pr && (pr.heaviest_kg != null || pr.best_seconds != null) && (
        <section className="mt-7">
          <SectionHeading>Records</SectionHeading>
          <Card className="divide-y divide-line">
            {pr.heaviest_kg != null && (
              <Row
                label="Heaviest"
                value={formatWeight(pr.heaviest_kg, unit)}
                {...(pr.heaviest_reps != null ? { sub: `for ${pr.heaviest_reps}` } : {})}
              />
            )}
            {pr.best_e1rm_kg != null && (
              <Row label="Best estimated 1RM" value={formatWeight(pr.best_e1rm_kg, unit)} />
            )}
            {pr.best_set_volume_kg != null && (
              <Row
                label="Best set"
                value={formatWeight(pr.best_set_volume_kg, unit)}
                sub="lifted"
              />
            )}
            {pr.best_seconds != null && (
              <Row label="Longest hold" value={formatDuration(pr.best_seconds)} />
            )}
          </Card>
        </section>
      )}

      <section className="mt-7">
        <SectionHeading trailing={history?.length ? `${history.length} sessions` : undefined}>
          History
        </SectionHeading>
        {history == null ? null : history.length === 0 ? (
          <EmptyState
            icon={Dumbbell}
            title="Not done yet"
            body="Add it to a workout and its history starts here."
          />
        ) : (
          <div className="space-y-3">
            {history.slice(0, 20).map((s, i) => {
              const entry = s.entries.find((e) => e.exercise_id === exercise.id);
              const sets = entry?.sets.filter(isWorkingSet) ?? [];
              if (sets.length === 0) return null;
              return (
                <Card
                  key={s.id}
                  className="rise-in p-4"
                  style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-[14px] font-semibold">
                      {new Date(s.started_at).toLocaleDateString(undefined, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                    <span className="text-[12px] text-muted tabular">{sets.length} sets</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sets.map((set, j) => (
                      <span
                        key={j}
                        className="rounded-lg bg-surface-2 px-2 py-1 text-[13px] tabular text-ink-2"
                      >
                        {set.seconds != null
                          ? `${set.seconds}s`
                          : `${set.weight_kg != null ? formatWeight(set.weight_kg, unit) : '—'} × ${set.reps ?? 0}`}
                      </span>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
