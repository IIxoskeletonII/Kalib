// SPEC §20.9 — writing the week.
//
// Two questions and a preview. Everything about the week follows from how many days and what
// kit, so that is all it asks; the rest is the routine editor's job once the week exists.
//
// The choices live in the URL rather than in state, so tapping an exercise to watch it and
// coming back lands on the same week instead of the default one.
import { ChevronLeft, Dumbbell } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ExerciseThumb } from '@/components/ExerciseDemo';
import { toast } from '@/components/Toast';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  ListRow,
  SectionHeading,
  Segmented,
  Skeleton,
  fmt,
} from '@/components/ui';
import { MAX_DAYS, MIN_DAYS, KITS, buildProgram, summarise, type Kit } from '@/core/program';
import { useBack } from '@/hooks/useBack';
import { useRoutines, useStrengthExercises } from '@/hooks/useWorkouts';
import { saveProgram, unsaveProgram } from '@/services/program';

const DAY_OPTIONS = Array.from({ length: MAX_DAYS - MIN_DAYS + 1 }, (_, i) => {
  const n = String(MIN_DAYS + i);
  return { value: n, label: n };
});

const KIT_OPTIONS = (Object.keys(KITS) as Kit[]).map((k) => ({ value: k, label: KITS[k].label }));

/** Three, because it is the fewest days on which every muscle comes round three times. */
const DEFAULT_DAYS = 3;

const list = (ms: readonly string[]) =>
  ms.length <= 1 ? (ms[0] ?? '') : `${ms.slice(0, -1).join(', ')} and ${ms.at(-1)}`;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function BuildWeek() {
  const navigate = useNavigate();
  const back = useBack('/train');
  const [params, setParams] = useSearchParams();
  const catalogue = useStrengthExercises();
  const routines = useRoutines();

  const asked = Number(params.get('days'));
  const days = asked >= MIN_DAYS && asked <= MAX_DAYS ? Math.round(asked) : DEFAULT_DAYS;
  const kitParam = params.get('kit');
  const kit: Kit = kitParam && kitParam in KITS ? (kitParam as Kit) : 'gym';

  const choose = (patch: { days?: number; kit?: Kit }) => {
    const next = new URLSearchParams(params);
    if (patch.days != null) next.set('days', String(patch.days));
    if (patch.kit != null) next.set('kit', patch.kit);
    // Replace, not push: changing your mind four times should not take four backs to undo.
    setParams(next, { replace: true });
  };

  const program = useMemo(
    () => (catalogue ? buildProgram(catalogue, { days, equipment: KITS[kit].equipment }) : null),
    [catalogue, days, kit],
  );
  const media = useMemo(() => new Map(catalogue?.map((e) => [e.id, e.media])), [catalogue]);
  const summary = program ? summarise(program) : null;
  const saving = program ? program.days.filter((d) => d.items.length > 0).length : 0;

  const save = async () => {
    if (!program) return;
    try {
      const ids = await saveProgram(program);
      navigate('/train', { replace: true });
      toast(`${ids.length} routines added`, {
        label: 'Undo',
        run: () => unsaveProgram(ids),
      });
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col pb-6">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="flex-1">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">Build a week</h1>
          <p className="text-[13px] text-muted">A starting point. Every day is yours to edit.</p>
        </div>
      </div>

      <div className="mt-4 flex-1 overflow-y-auto">
        <section aria-label="Days a week">
          <div className="mb-2 text-[13px] font-semibold text-muted">Days a week</div>
          <Segmented
            value={String(days)}
            options={DAY_OPTIONS}
            onChange={(v) => choose({ days: Number(v) })}
          />
        </section>

        <section className="mt-4" aria-label="Where you train">
          <div className="mb-2 text-[13px] font-semibold text-muted">Where you train</div>
          <Segmented value={kit} options={KIT_OPTIONS} onChange={(v) => choose({ kit: v })} />
        </section>

        {program == null ? (
          <Skeleton className="mt-6 h-[320px] w-full rounded-[24px]" />
        ) : saving === 0 ? (
          <div className="mt-6">
            <EmptyState
              icon={Dumbbell}
              title="Nothing to build from yet"
              body="The exercise library is still loading. Give it a moment and this fills in."
            />
          </div>
        ) : (
          <>
            {summary && summary.minFrequency > 0 && (
              <p className="mt-5 text-[14px] text-ink-2">
                Every muscle at least {summary.minFrequency}× a week,{' '}
                {summary.minSets === summary.maxSets
                  ? `${fmt(summary.minSets)} sets`
                  : `${fmt(summary.minSets)}–${fmt(summary.maxSets)} sets`}
                .
              </p>
            )}

            {/* Said plainly and before the list, because it is the thing to fix first. */}
            {program.improvised.length > 0 && (
              <p className="mt-2 text-[13px] text-muted">
                {program.improvised.length === 1
                  ? `${capital(list(program.improvised))}: nothing in the library trains it properly with this kit, so its pick is a stand-in. Swap it for something you can load.`
                  : `${capital(list(program.improvised))}: nothing in the library trains them properly with this kit, so their picks are stand-ins. Swap them for something you can load.`}
              </p>
            )}
            {program.uncovered.length > 0 && (
              <p className="mt-2 text-[13px] text-danger">
                No movement for {list(program.uncovered)} with this kit.
              </p>
            )}

            {program.days.map((day) => (
              <section key={day.name} className="mt-6" aria-label={day.name}>
                <SectionHeading>{day.name}</SectionHeading>
                <Card className="divide-y divide-line">
                  {day.items.map((it, i) => (
                    <ListRow
                      key={it.exercise_id}
                      className="rise-in"
                      style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                      leading={<ExerciseThumb media={media.get(it.exercise_id)} name={it.name} />}
                      title={it.name}
                      subtitle={`${it.sets} × ${it.rep_low ?? 8}–${it.rep_high ?? 12}`}
                      chevron
                      onClick={() =>
                        navigate(`/train/exercise/${encodeURIComponent(it.exercise_id)}`)
                      }
                    />
                  ))}
                </Card>
              </section>
            ))}
          </>
        )}
      </div>

      <div className="pt-3">
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={saving === 0}
          onClick={() => void save()}
        >
          {saving === 0 ? 'Add routines' : `Add ${saving} routines`}
        </Button>
        {routines && routines.length > 0 && saving > 0 && (
          <p className="mt-2 text-center text-[12px] text-muted">
            {`Added alongside your ${routines.length === 1 ? 'routine' : `${routines.length} routines`}. Nothing is replaced.`}
          </p>
        )}
      </div>
    </div>
  );
}
