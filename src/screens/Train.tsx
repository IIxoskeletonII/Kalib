// SPEC §20.1 — the training home.
//
// Structured the way the rest of the app is: the week's figures sit directly on the background,
// and the cards below are things you tap. Starting a routine is the common act, so the routines
// carry the weight; an empty workout is the exception and reads like one.
import { Dumbbell, Feather, ListPlus, Play, Plus, Trophy, Users } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { FreshAchievement } from '@/components/FreshAchievement';
import { toast } from '@/components/Toast';
import { Button, Card, EmptyState, ListRow, SectionHeading, Skeleton, fmt } from '@/components/ui';
import type { BlockState } from '@/core/block';
import { fromDateKey, toDateKey } from '@/core/dates';
import { formatDuration } from '@/core/restTimer';
import { nextRoutine, type NextRoutine } from '@/core/rotation';
import { describeRun, skipsLine, weekLine, type TrainingStreak } from '@/core/streak';
import { MAX_SETS, MIN_SETS, type LoadReport } from '@/core/trainingLoad';
import { trainingWeek, weekStart } from '@/core/trainingWeek';
import type { Routine } from '@/core/types';
import { toDisplay, UNIT_LABEL } from '@/core/weightUnit';
import { useWeighIns } from '@/hooks/useData';
import { useMomentum } from '@/hooks/useMomentum';
import {
  useActiveSession,
  useBlock,
  useRecentSessions,
  useRoutines,
  useWeeklyLoad,
  useWeightUnit,
} from '@/hooks/useWorkouts';
import {
  declineEasyWeek,
  endEasyWeekNow,
  restoreBlock,
  snapshotBlock,
  startEasyWeek,
} from '@/services/block';
import { startSession } from '@/services/workouts';

/**
 * Where the week is short (§20.8).
 *
 * One line, not a chart. A per-muscle bar chart would be the obvious thing to build and the
 * wrong thing to read: the only question worth answering on this screen is whether anything
 * needs attention, and a chart makes you work that out for yourself. Muscles are named at most
 * three at a time for the same reason.
 */
function Coverage({ report, easy }: { report: LoadReport; easy: boolean }) {
  const name = (ms: readonly string[]) =>
    ms.length <= 3 ? ms.join(', ') : `${ms.slice(0, 3).join(', ')} +${ms.length - 3}`;

  // A muscle your own routines mean to train and have not is the most actionable gap, so it is
  // read first; under-trained is the same complaint one degree weaker.
  const short = [...report.untrained, ...report.under];
  let line: string | undefined;
  // In an easier week fewer sets is the point, so being under the band is not news (§20.12).
  if (easy) line = 'Easier week: fewer sets is the point';
  else if (short.length > 0) line = `Short this week: ${name(short)}`;
  else if (report.concentrated.length > 0) line = `All in one day: ${name(report.concentrated)}`;
  else if (report.over.length > 0) line = `Over ${MAX_SETS} sets: ${name(report.over)}`;
  else if (report.muscles.length > 0) line = `Every muscle inside ${MIN_SETS}-${MAX_SETS} sets`;

  if (!line && report.unknown_sets === 0) return null;

  return (
    <p className="mt-2 text-[13px] text-muted">
      {line}
      {report.unknown_sets > 0 && (
        <span className={line ? 'before:content-["_·_"]' : ''}>
          {report.unknown_sets} {report.unknown_sets === 1 ? 'set' : 'sets'} unattributed
        </span>
      )}
    </p>
  );
}

export default function Train() {
  const navigate = useNavigate();
  const active = useActiveSession();
  const routines = useRoutines();
  const recent = useRecentSessions(30);
  const unit = useWeightUnit();
  const coverage = useWeeklyLoad();
  const weighIns = useWeighIns();
  const block = useBlock();
  const momentum = useMomentum();

  const next = useMemo(
    () => (routines && recent ? nextRoutine(routines, recent) : undefined),
    [routines, recent],
  );

  const week = useMemo(
    () => trainingWeek(recent ?? [], weekStart(), weighIns?.at(-1)?.weight_kg),
    [recent, weighIns],
  );

  const begin = async (routine?: Routine) => {
    try {
      await startSession(routine);
      navigate('/train/session');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <div className="pb-32">
      <header className="pt-2">
        <p className="text-[14px] font-medium text-muted">Strength and sessions</p>
        <h1 className="mt-0.5 text-[34px] leading-none font-extrabold tracking-[-0.03em]">Train</h1>
      </header>

      {/* The week sits on the background. Cards start below it. */}
      <section className="mt-6" aria-label="This week">
        {recent == null ? (
          <Skeleton className="h-[86px] w-full rounded-[20px]" />
        ) : (
          <>
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-[13px] font-semibold text-muted">
                  {week.sessions === 1 ? 'Session this week' : 'Sessions this week'}
                </div>
                <div className="display mt-1">{week.sessions}</div>
              </div>
              <div className="pb-1 text-right tabular">
                <div className="text-[16px] font-bold">
                  {fmt(week.working_sets)}
                  <span className="ml-1 text-[13px] font-medium text-muted">sets</span>
                </div>
                {week.volume_kg > 0 && (
                  <div className="mt-0.5 text-[16px] font-bold">
                    {fmt(toDisplay(week.volume_kg, unit))}
                    <span className="ml-1 text-[13px] font-medium text-muted">
                      {UNIT_LABEL[unit]} lifted
                    </span>
                  </div>
                )}
              </div>
            </div>
            <WeekDots trained={week.days} />
            {coverage && <Coverage report={coverage} easy={block?.kind === 'easy'} />}
          </>
        )}
      </section>

      {/* One routine is its own answer, and a running session already says what is next. */}
      {!active && next && routines && routines.length >= 2 && (
        <UpNext next={next} onStart={() => void begin(next.routine)} />
      )}

      {!active && block && <BlockCard block={block} />}

      {/* Earned on another device, or by a week that closed: the summary is the first place. */}
      {!active && <FreshAchievement className="mt-6" />}

      {/* Nothing to keep going until something has been done. */}
      {momentum && momentum.report.lifetime.sessions > 0 && (
        <MomentumCard streak={momentum.streak} onOpen={() => navigate('/train/achievements')} />
      )}

      {/* §21 — a quiet way in: the circle is invited into, never pushed. */}
      {!active && (
        <Button
          variant="ghost"
          size="sm"
          icon={Users}
          className="mt-2 w-full"
          onClick={() => navigate('/train/circle')}
        >
          Your circle
        </Button>
      )}

      {active && (
        <Card className="mt-6 p-5" onClick={() => navigate('/train/session')}>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Play size={20} strokeWidth={2.4} aria-hidden />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[17px] font-bold">{active.name}</span>
              <span className="block text-[13px] text-muted">In progress — tap to carry on</span>
            </span>
          </div>
        </Card>
      )}

      <section className="mt-7">
        <SectionHeading>Routines</SectionHeading>
        {routines == null ? (
          <Skeleton className="h-[140px] w-full rounded-[24px]" />
        ) : routines.length === 0 ? (
          <EmptyState
            icon={Dumbbell}
            title="No routines yet"
            body="A routine is the list you work through — build one once and start it in a tap."
            action={
              // Writing a week is the better first step for someone with nothing yet; building
              // one routine by hand is the button just below.
              <Button variant="primary" icon={ListPlus} onClick={() => navigate('/train/build')}>
                Build a week for me
              </Button>
            }
          />
        ) : (
          <Card className="divide-y divide-line">
            {routines.map((r, i) => (
              <ListRow
                key={r.id}
                className="rise-in"
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                onClick={() => void begin(r)}
                chevron
                title={r.name}
                subtitle={`${r.items.length} exercise${r.items.length === 1 ? '' : 's'}${
                  r.last_performed
                    ? ` · last ${fromDateKey(r.last_performed).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                      })}`
                    : ''
                }`}
              />
            ))}
          </Card>
        )}

        {/* Starting a routine is the act; an empty workout is the exception and reads like one. */}
        <div className="mt-3 flex gap-2">
          <Button icon={Plus} className="flex-1" onClick={() => navigate('/train/routine/new')}>
            New routine
          </Button>
          {/* No icon: with one, the label wraps to two lines at this width. */}
          <Button className="flex-1" onClick={() => void begin()}>
            Empty workout
          </Button>
        </div>
        {routines && routines.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            icon={ListPlus}
            className="mt-2 w-full"
            onClick={() => navigate('/train/build')}
          >
            Build a week for me
          </Button>
        )}
        {/* Asking for one is always possible; the card above only appears when one is due. */}
        {block?.kind === 'block' && !block.offer && (
          <Button
            variant="ghost"
            size="sm"
            icon={Feather}
            className="mt-1 w-full"
            onClick={() => void takeEasyWeek()}
          >
            Take an easier week
          </Button>
        )}
      </section>

      {recent && recent.length > 0 && (
        <section className="mt-7">
          <SectionHeading>Recent workouts</SectionHeading>
          <Card className="divide-y divide-line">
            {recent.slice(0, 8).map((s, i) => (
              <ListRow
                key={s.id}
                className="rise-in"
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                onClick={() => navigate(`/train/summary/${encodeURIComponent(s.id)}`)}
                chevron
                title={s.name}
                subtitle={`${new Date(s.started_at).toLocaleDateString(undefined, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })} · ${formatDuration(s.duration_sec ?? 0)}`}
                value={s.volume_kg ? fmt(toDisplay(s.volume_kg, unit)) : ''}
                valueSub={s.volume_kg ? `${UNIT_LABEL[unit]} lifted` : undefined}
              />
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

async function takeEasyWeek(): Promise<void> {
  const before = await snapshotBlock();
  const week = await startEasyWeek();
  toast(`Easier week until ${shortDay(week.to)}`, {
    label: 'Undo',
    run: () => restoreBlock(...before),
  });
}

function shortDay(key: string): string {
  return fromDateKey(key).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** "Bench and Squat", "Bench, Squat and 2 more". */
function lifts(names: readonly string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

/**
 * The easier week (§20.12): running, or offered. Offered with its reason, and with the honest
 * caveat, because the evidence is that these keep you fresh rather than make you grow, and a
 * card that oversold them would be the app having an opinion it cannot back.
 */
function BlockCard({ block }: { block: BlockState }) {
  if (block.kind === 'easy') {
    const end = async () => {
      const before = await snapshotBlock();
      await endEasyWeekNow();
      toast('Easier week ended', { label: 'Undo', run: () => restoreBlock(...before) });
    };
    return (
      <section className="mt-6" aria-label="Easier week">
        <Card className="p-5">
          <div className="text-[13px] font-semibold text-accent">Easier week</div>
          <div className="mt-1 text-[20px] leading-tight font-bold">
            Until {shortDay(block.week.to)}
          </div>
          <p className="mt-1 text-[14px] leading-snug text-ink-2">
            Half the sets at the same weights, stopping at the bottom of each range. Progress picks
            up where it left off.
          </p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void end()}>
            End it early
          </Button>
        </Card>
      </section>
    );
  }
  if (block.kind !== 'block' || !block.offer) return null;
  const { reason } = block.offer;
  const title =
    reason === 'stalled'
      ? `${lifts(block.offer.lifts)} have stalled`
      : reason === 'slipping'
        ? `${lifts(block.offer.lifts)} are slipping`
        : `${block.week - 1} weeks without a break`;
  const decline = async () => {
    const before = await snapshotBlock();
    await declineEasyWeek();
    toast('Carrying on — a new block starts today', {
      label: 'Undo',
      run: () => restoreBlock(...before),
    });
  };
  return (
    <section className="mt-6" aria-label="An easier week?">
      <Card className="p-5">
        <div className="text-[13px] font-semibold text-muted">An easier week?</div>
        <div className="mt-1 text-[20px] leading-tight font-bold">{title}</div>
        <p className="mt-1 text-[14px] leading-snug text-ink-2">
          A week at half the sets, same weights, helps you stay fresh. It is not shown to build more
          muscle, so skipping one is fine if you feel good.
        </p>
        <div className="mt-3 flex gap-2">
          {/* No icon, and the width goes to the answer that matters: split evenly, or with an
              icon, the label wrapped to two lines at 390 px. */}
          <Button
            variant="primary"
            size="sm"
            className="flex-1 whitespace-nowrap"
            onClick={() => void takeEasyWeek()}
          >
            Start easier week
          </Button>
          <Button variant="secondary" size="sm" className="shrink-0" onClick={() => void decline()}>
            Not now
          </Button>
        </div>
      </Card>
    </section>
  );
}

/**
 * The run (§20.15). Two lines and nothing to press but the card: how many weeks, what this week
 * still needs, and how much slack the month has left. It never says a run ended — a new one
 * simply starts — because the evidence is that a broken streak is what makes people stop.
 */
function MomentumCard({ streak, onOpen }: { streak: TrainingStreak; onOpen: () => void }) {
  const weeks = streak.current.weeks;
  return (
    <section className="mt-6" aria-label="Weeks running">
      <Card className="p-5" onClick={onOpen}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-muted">Weeks running</div>
            <div className="mt-1 text-[20px] leading-tight font-bold">
              {weeks > 0 ? describeRun(weeks) : 'A run starts this week'}
            </div>
            <div className="mt-1 text-[13px] leading-snug text-muted">
              {weekLine(streak.this_week)}
            </div>
            <div className="text-[13px] leading-snug text-muted">{skipsLine(streak.skips)}</div>
          </div>
          <Trophy size={20} strokeWidth={2.2} className="shrink-0 text-muted" aria-hidden />
        </div>
      </Card>
    </section>
  );
}

/** "yesterday", "today", or a short weekday and date: as far back as a rotation reaches. */
function whenDone(key: string): string {
  const today = toDateKey(new Date());
  const d = new Date();
  d.setDate(d.getDate() - 1);
  if (key === today) return 'today';
  if (key === toDateKey(d)) return 'yesterday';
  return `on ${fromDateKey(key).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })}`;
}

/**
 * The routine after the last one you did (§20.10).
 *
 * It says what it is next *after*, because a suggestion that does not show its working reads
 * as the app having an opinion. Once today is trained it turns into "next time" and its button
 * steps down, so it never reads as asking for a second session.
 */
function UpNext({ next, onStart }: { next: NextRoutine; onStart: () => void }) {
  const { routine, after, after_date, trained_today } = next;
  const count = `${routine.items.length} exercise${routine.items.length === 1 ? '' : 's'}`;
  return (
    <section className="mt-6" aria-label={trained_today ? 'Next time' : 'Up next'}>
      <Card className="p-5">
        <div className="text-[13px] font-semibold text-muted">
          {trained_today ? 'Next time' : 'Up next'}
        </div>
        <div className="mt-1 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[20px] leading-tight font-bold">{routine.name}</div>
            <div className="mt-0.5 text-[13px] text-muted">
              {after && after_date
                ? `${count}, after ${after.name} ${whenDone(after_date)}`
                : `${count}, first in your list`}
            </div>
          </div>
          <Button
            variant={trained_today ? 'secondary' : 'primary'}
            size="sm"
            icon={Play}
            aria-label={`Start ${routine.name}`}
            onClick={onStart}
          >
            Start
          </Button>
        </div>
      </Card>
    </section>
  );
}

/** Which days of this week were trained. The read-only cousin of Today's week strip. */
function WeekDots({ trained }: { trained: readonly string[] }) {
  const start = weekStart();
  const today = toDateKey(new Date());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="mt-4 flex gap-1.5">
      {days.map((d) => {
        const key = toDateKey(d);
        const did = trained.includes(key);
        const isToday = key === today;
        return (
          <div
            key={key}
            className="flex-1 text-center"
            aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long' })}${
              did ? ', trained' : ''
            }`}
          >
            <div
              className={`h-1.5 rounded-full transition-colors duration-700 ease-[var(--ease-out-soft)] ${
                did ? 'bg-accent' : isToday ? 'bg-surface-3' : 'bg-surface-2'
              }`}
            />
            <div
              className={`mt-1.5 text-[11px] font-semibold ${did ? 'text-ink-2' : 'text-muted'}`}
            >
              {d.toLocaleDateString(undefined, { weekday: 'narrow' })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
