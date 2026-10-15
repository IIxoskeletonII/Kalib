// SPEC §20.5 / §20.6 — what the session came to, shown once, right after it ends.
//
// This is where celebration belongs. The convention across the good trackers is that a record
// is a quiet badge during the set and the fuss happens here; a history screen opened weeks
// later stays neutral, because confetti over something you already knew is noise.
//
// It is also the only place the energy figure appears, and it appears with the sentence that
// makes it safe: the measured burn already contains it, so the food budget has not moved. A
// number like that shown without its caveat is the one thing that would undo §20.7.
import { Check, ChevronLeft, Flame, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { Explainer } from '@/components/Explainer';
import { Button, Card, IconButton, SectionHeading } from '@/components/ui';
import { MUSCLE_LABEL } from '@/core/muscles';
import { describePR } from '@/core/pr';
import { formatDuration } from '@/core/restTimer';
import { describeEnergy } from '@/core/workoutEnergy';
import type { Muscle } from '@/core/types';
import { formatWeight, toDisplay, UNIT_LABEL } from '@/core/weightUnit';
import { fmt } from '@/components/ui';
import { getExercises } from '@/db/repo/exercises';
import { useBack } from '@/hooks/useBack';
import { useWeightUnit } from '@/hooks/useWorkouts';
import { summaryFor, type SessionSummary as Summary } from '@/services/workouts';

export default function SessionSummary() {
  const { id } = useParams();
  const navigate = useNavigate();
  const back = useBack('/train');
  // Set by Session on finishing. Absent when the row was opened from Recent workouts, and
  // absent after a reload — which lands on the quieter of the two, the right way round.
  const justFinished =
    (useLocation().state as { justFinished?: boolean } | null)?.justFinished === true;
  const unit = useWeightUnit();
  const [summary, setSummary] = useState<Summary | null | undefined>();
  const [muscles, setMuscles] = useState<Muscle[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = id ? await summaryFor(id) : undefined;
      if (cancelled) return;
      setSummary(s ?? null);
      if (!s) return;
      const ex = await getExercises(s.session.entries.map((e) => e.exercise_id));
      if (cancelled) return;
      const seen: Muscle[] = [];
      for (const e of s.session.entries) {
        const m = ex.get(e.exercise_id)?.primary_muscle;
        if (m && !seen.includes(m)) seen.push(m);
      }
      setMuscles(seen);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (summary === null) navigate('/train', { replace: true });
  }, [summary, navigate]);

  if (!summary) return null;
  const { session, records, volume, energy } = summary;
  const done = new Date(session.ended_at ?? session.started_at);

  return (
    <div className="flex h-full flex-col pb-6">
      <header className={justFinished ? 'pt-6' : 'flex items-start gap-1 pt-1'}>
        {!justFinished && <IconButton icon={ChevronLeft} label="Back" onClick={back} />}
        <div className={justFinished ? '' : 'min-w-0 flex-1 pt-1'}>
          <p className="text-[14px] font-medium text-muted">
            {done.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1
            className={`mt-0.5 leading-none font-extrabold tracking-[-0.03em] ${
              justFinished ? 'text-[34px]' : 'text-[24px]'
            }`}
          >
            {session.name}
          </h1>
        </div>
      </header>

      {/* The figures sit on the page; the cards below are things you read. */}
      <section className="mt-7 flex items-end justify-between gap-4" aria-label="Session totals">
        <div>
          <div className="text-[13px] font-semibold text-muted">Volume</div>
          <div className="display mt-1">
            {fmt(toDisplay(volume.kg, unit))}
            <span className="ml-1.5 text-[20px] font-medium text-muted">{UNIT_LABEL[unit]}</span>
          </div>
        </div>
        <div className="pb-1 text-right tabular">
          <div className="text-[16px] font-bold">
            {volume.working_sets}
            <span className="ml-1 text-[13px] font-medium text-muted">sets</span>
          </div>
          <div className="mt-0.5 text-[16px] font-bold">
            {formatDuration(session.duration_sec ?? 0)}
          </div>
        </div>
      </section>

      {volume.unknown_sets > 0 && (
        <p className="mt-2 text-[12px] text-muted">
          {volume.unknown_sets} bodyweight {volume.unknown_sets === 1 ? 'set is' : 'sets are'} not
          in that total — weigh in and they will be.
        </p>
      )}

      {muscles.length > 0 && (
        <p className="mt-3 text-[13px] text-muted">
          {muscles.map((m) => MUSCLE_LABEL[m]).join(' · ')}
        </p>
      )}

      {records.length > 0 && (
        <section className="mt-7">
          <SectionHeading>
            <span className="inline-flex items-center gap-2">
              <Trophy size={16} className="text-accent" aria-hidden />
              {records.length === 1 ? 'A record' : `${records.length} records`}
            </span>
          </SectionHeading>
          <Card className="divide-y divide-line">
            {records.slice(0, 8).map((r, i) => (
              <div
                key={`${r.exercise_id}-${r.kind}-${i}`}
                className="rise-in flex items-center gap-3 px-4 py-3"
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <Check size={17} strokeWidth={2.8} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-medium">{r.name}</span>
                  <span className="block text-[13px] text-muted">{describePR(r)}</span>
                </span>
                <span className="shrink-0 text-right tabular">
                  <span className="block text-[16px] font-bold">
                    {r.kind === 'reps'
                      ? `${r.value} reps`
                      : r.kind === 'seconds'
                        ? formatDuration(r.value)
                        : formatWeight(r.value, unit)}
                  </span>
                  <span className="block text-[12px] text-muted">
                    was{' '}
                    {r.kind === 'reps'
                      ? r.previous
                      : r.kind === 'seconds'
                        ? formatDuration(r.previous)
                        : formatWeight(r.previous, unit)}
                  </span>
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}

      {energy && energy.kcal > 0 && (
        <section className="mt-7">
          <SectionHeading>
            <span className="inline-flex items-center gap-2">
              <Flame size={16} className="text-kcal" aria-hidden />
              Energy
            </span>
          </SectionHeading>
          <Card className="p-5">
            <p className="text-[17px] font-bold tabular">{describeEnergy(energy)}</p>
            <Explainer
              id="workout-energy"
              className="mt-3"
              summary="Already in your measured burn — your food budget is unchanged."
            >
              <p>
                An estimate from how long and how densely you worked. No wearable is accurate for
                lifting, so this is a range rather than a figure.
              </p>
              <p>
                <strong className="font-semibold text-ink-2">
                  Your food budget has not changed.
                </strong>{' '}
                Most apps guess your burn from your height, weight and a dropdown, so they have to
                add a workout on top. Kalib measures it instead: if you eat 2,500 a day and your
                weight holds, you burn about 2,500 — and those weeks already had your sessions in
                them.
              </p>
              <p>
                So this number is already inside your target. Spending it again would be counting
                the same session twice.
              </p>
            </Explainer>
          </Card>
        </section>
      )}

      {/* Only the end of a workout gets a button to close it off. Reading an old session back
          is a detail screen like any other, and the back arrow is how you leave one. */}
      {justFinished && (
        <div className="mt-auto pt-7">
          <Button
            variant="primary"
            size="lg"
            icon={Check}
            className="w-full"
            onClick={() => navigate('/train', { replace: true })}
          >
            Done
          </Button>
        </div>
      )}
    </div>
  );
}
