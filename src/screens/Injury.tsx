// SPEC §20.16 — something hurts: describe it, and get a keep / change / swap / leave-out
// decision for each exercise in a routine, or "see a doctor" when that is the answer.
import { ArrowRight, ChevronLeft, Send, Stethoscope, WifiOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from '@/components/Toast';
import { Badge, Button, Card, Chip, IconButton, SectionHeading } from '@/components/ui';
import { MAX_DESCRIPTION, type GroundedAdvice, type InjuryAction } from '@/core/injury';
import { LEVEL_ADVICE, worstLevel } from '@/core/redFlags';
import { useBack } from '@/hooks/useBack';
import { useInjuryConsent, useOnline } from '@/hooks/useInjury';
import { useExercise, useRoutines } from '@/hooks/useWorkouts';
import {
  InjuryHelpError,
  applySwap,
  askInjuryHelp,
  giveInjuryConsent,
  type InjuryResult,
} from '@/services/injury';

const ACTION_LABEL: Record<InjuryAction, string> = {
  keep: 'Keep',
  modify: 'Change',
  swap: 'Swap',
  skip: 'Leave out',
};

type Phase =
  | { state: 'input' }
  | { state: 'busy' }
  | { state: 'error'; message: string }
  // The routine is held with the answer: a swap takes the exercise out of it, and the screen
  // must not then go looking for a different routine to show the answer against.
  | { state: 'result'; result: InjuryResult; routineId: string | undefined };

export default function Injury() {
  const [params] = useSearchParams();
  const back = useBack('/train');
  const exerciseId = params.get('exercise') ?? undefined;
  const exercise = useExercise(exerciseId);
  const routines = useRoutines();
  const consent = useInjuryConsent();
  const online = useOnline();
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState<Phase>({ state: 'input' });
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);

  // The routine the exercise came from, else the first; "just this exercise" when none has it.
  const fallback = useMemo(() => {
    if (!routines) return undefined;
    const holding = exerciseId
      ? routines.find((r) => r.items.some((i) => i.exercise_id === exerciseId))
      : undefined;
    if (holding) return holding.id;
    if (exerciseId) return null;
    return routines[0]?.id ?? null;
  }, [routines, exerciseId]);
  const routineId = chosen === undefined ? fallback : chosen;
  const routine = routines?.find((r) => r.id === routineId);

  const busy = phase.state === 'busy';
  const text = description.trim();
  const canSend =
    text.length > 0 && !busy && consent != null && (routine != null || exercise != null);

  const send = async () => {
    if (!canSend) return;
    setPhase({ state: 'busy' });
    const askedAbout = routine?.id;
    // Pin the choice too, so "Ask again" comes back to the same routine after a swap.
    setChosen(askedAbout ?? null);
    try {
      const result = await askInjuryHelp(
        description,
        routine ? { routine } : { exercise_id: exerciseId },
      );
      setPhase({ state: 'result', result, routineId: askedAbout });
    } catch (err) {
      setPhase({
        state: 'error',
        message:
          err instanceof InjuryHelpError || err instanceof Error
            ? err.message
            : 'Something went wrong.',
      });
    }
  };

  return (
    <div className="pb-24">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">
            Something hurts?
          </h1>
          <p className="text-[13px] text-muted">Adjust a routine around an ache or strain.</p>
        </div>
      </div>

      <p className="mt-4 px-1 text-[13px] leading-snug text-muted">
        Kalib isn’t a doctor. This is for ordinary aches and strains: it suggests changes to your
        training, not a diagnosis or a treatment. Pain that is sharp, lasts more than two weeks or
        keeps getting worse needs a doctor or a physiotherapist.
      </p>

      {consent === null && (
        <ConsentCard onAgree={() => void giveInjuryConsent()} onDecline={back} />
      )}

      {consent != null && phase.state !== 'result' && (
        <>
          {routines && routines.length > 0 && (
            <section className="mt-6">
              <SectionHeading>Which routine?</SectionHeading>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {exercise && fallback === null && (
                  <Chip active={routineId === null} onClick={() => setChosen(null)}>
                    Just {exercise.name}
                  </Chip>
                )}
                {routines.map((r) => (
                  <Chip key={r.id} active={r.id === routineId} onClick={() => setChosen(r.id)}>
                    {r.name}
                  </Chip>
                ))}
              </div>
              {routine && (
                <p className="mt-2 px-1 text-[13px] leading-snug text-muted">
                  {routine.items.map((i) => i.name).join(', ')}
                </p>
              )}
            </section>
          )}

          <section className="mt-6">
            <label htmlFor="injury-description" className="mb-3 block px-1">
              <span className="text-[17px] font-bold tracking-[-0.01em]">
                What hurts, and when?
              </span>
            </label>
            <textarea
              id="injury-description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
              rows={4}
              maxLength={MAX_DESCRIPTION}
              placeholder="e.g. Left shoulder aches at the bottom of a bench press. Started last week, fine on rows."
              className="w-full resize-none rounded-[20px] bg-surface px-4 py-3 text-[16px] leading-snug outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
            />
            <p className="mt-1 px-1 text-right text-[12px] text-muted tabular">
              {description.length} of {MAX_DESCRIPTION}
            </p>
          </section>

          {routines && routines.length === 0 && !exercise && (
            <p className="mt-2 px-1 text-[14px] text-muted">
              Build a routine first, or open this from an exercise, so there is something to adjust.
            </p>
          )}

          {!online && (
            <p className="mt-2 flex items-center gap-2 px-1 text-[14px] text-muted">
              <WifiOff size={16} strokeWidth={2.2} aria-hidden />
              Injury help needs a connection. Your routines still work offline.
            </p>
          )}

          <Button
            variant="primary"
            size="lg"
            icon={Send}
            className="mt-3 w-full"
            disabled={!canSend || !online}
            onClick={send}
          >
            {busy ? 'Thinking it over…' : 'Send to injury help'}
          </Button>

          {phase.state === 'error' && (
            <Card className="mt-3 p-4 text-[14px]">
              <p role="alert">{phase.message}</p>
            </Card>
          )}
        </>
      )}

      {phase.state === 'result' && (
        <ResultView
          result={phase.result}
          routineId={phase.routineId}
          onAgain={() => setPhase({ state: 'input' })}
        />
      )}
    </div>
  );
}

function ConsentCard({ onAgree, onDecline }: { onAgree: () => void; onDecline: () => void }) {
  return (
    <section className="mt-6" aria-label="Before you describe it">
      <SectionHeading>Before you describe it</SectionHeading>
      <Card className="space-y-3 p-5 text-[14px] leading-snug text-ink-2">
        <p>
          What you type, and the names of the exercises you ask about, go to Kalib’s server and from
          there to an AI model run by OpenRouter. That is health information, so it is only sent if
          you agree.
        </p>
        <p>
          Nothing about it is kept: not by Kalib, not in a log. Your history, weight and other data
          stay on your phone.
        </p>
        <p>
          A few warning signs are checked on your phone first. If one is there, nothing is sent, and
          Kalib tells you to see a doctor instead.
        </p>
        <p className="text-muted">You can withdraw this any time in Settings.</p>
        <div className="flex gap-2 pt-1">
          <Button onClick={onDecline}>Not now</Button>
          <Button variant="primary" className="flex-1" onClick={onAgree}>
            I agree
          </Button>
        </div>
      </Card>
    </section>
  );
}

function ResultView({
  result,
  routineId,
  onAgain,
}: {
  result: InjuryResult;
  routineId: string | undefined;
  onAgain: () => void;
}) {
  if (result.kind === 'doctor') {
    const level = worstLevel(result.flags) ?? 'urgent';
    const advice = LEVEL_ADVICE[level];
    return (
      <section className="mt-6" aria-label="See a doctor">
        <div role="alert" className="card space-y-3 p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
              <Stethoscope size={18} strokeWidth={2.2} aria-hidden />
            </span>
            <h2 className="text-[19px] font-bold tracking-[-0.01em] text-danger">{advice.title}</h2>
          </div>
          <p className="text-[15px] leading-snug">{advice.body}</p>
          <p className="text-[14px] leading-snug text-muted">
            {result.source === 'description'
              ? `You mentioned ${listOf(result.flags.map((f) => f.label))}. That is for a doctor to look at, so Kalib won’t suggest exercises around it.`
              : `The answer touched on ${listOf(result.flags.map((f) => f.label))}, so Kalib won’t show it. Have it checked before you train on it.`}
          </p>
        </div>
        <Button variant="ghost" className="mt-3 w-full" onClick={onAgain}>
          Change the description
        </Button>
      </section>
    );
  }

  return (
    <section className="mt-6" aria-label="What to do">
      <SectionHeading
        trailing={
          result.used != null && result.cap != null
            ? `${result.used} of ${result.cap} today`
            : undefined
        }
      >
        What to do
      </SectionHeading>
      {result.summary && (
        <p className="mb-3 px-1 text-[15px] leading-snug text-ink-2">{result.summary}</p>
      )}
      {result.advice.length === 0 ? (
        <Card className="p-4 text-[14px] text-muted">
          No changes suggested. If it still hurts when you train, stop and have it looked at.
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {result.advice.map((a, i) => (
            <AdviceRow key={a.ref} advice={a} routineId={routineId} delay={i} />
          ))}
        </Card>
      )}
      <p className="mt-3 px-1 text-[13px] leading-snug text-muted">
        Training should feel no worse than mild discomfort, during and the day after. Stop if it
        gets sharp, and see a doctor if it is not easing within two weeks.
      </p>
      <Button variant="ghost" className="mt-2 w-full" onClick={onAgain}>
        Ask again
      </Button>
    </section>
  );
}

function AdviceRow({
  advice: a,
  routineId,
  delay,
}: {
  advice: GroundedAdvice;
  routineId: string | undefined;
  delay: number;
}) {
  const [swapped, setSwapped] = useState(false);
  const [busy, setBusy] = useState(false);

  const canApply = a.action === 'swap' && a.swap && routineId != null && a.index != null;
  const apply = async () => {
    if (!canApply || busy) return;
    setBusy(true);
    try {
      const undo = await applySwap(routineId, a.index!, a.exercise.id, a.swap!.id);
      setSwapped(true);
      toast(`${a.swap!.name} is in the routine`, {
        label: 'Undo',
        run: async () => {
          await undo();
          setSwapped(false);
        },
      });
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rise-in px-4 py-3" style={{ animationDelay: `${Math.min(delay, 8) * 40}ms` }}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[16px] font-medium">{a.exercise.name}</span>
        <Badge tone={a.action === 'swap' ? 'accent' : 'muted'}>{ACTION_LABEL[a.action]}</Badge>
      </div>
      {a.reason && <p className="mt-1 text-[14px] leading-snug text-ink-2">{a.reason}</p>}
      {a.change && <p className="mt-1 text-[14px] leading-snug text-ink">{a.change}</p>}
      {a.unmatched && (
        <p className="mt-1 text-[13px] leading-snug text-muted">
          It suggested {a.unmatched}, which isn’t in your library, so leave this one out for now.
        </p>
      )}
      {a.swap && (
        <div className="mt-2 flex items-center gap-2">
          <ArrowRight size={16} strokeWidth={2.2} className="shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{a.swap.name}</span>
          {canApply && (
            <Button
              size="sm"
              disabled={swapped || busy}
              onClick={apply}
              aria-label={swapped ? `Swapped in ${a.swap.name}` : `Swap in ${a.swap.name}`}
            >
              {swapped ? 'Swapped' : 'Swap'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
