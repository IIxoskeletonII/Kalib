// SPEC §20.1 / §20.17 — the training home.
//
// Structured the way the rest of the app is: the week's figures sit directly on the background,
// with the seven days drawn under them — what was done, what is planned, today ringed. Then one
// card that answers the only question someone opening this tab has: what am I doing today? It
// names the routine the schedule lays on today (or the next one, on a rest day), shows what it
// works and how long it takes, and starts it. Below that, the days coming up, three small doors
// (the run, the body map, the circle), and the routines themselves, each now a page to read
// before it is a workout to start.
import {
  CalendarDays,
  Check,
  Dumbbell,
  Feather,
  ListPlus,
  Moon,
  PersonStanding,
  Play,
  Plus,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { ExerciseThumb } from '@/components/ExerciseDemo';
import { BalanceCard } from '@/components/bodyMap/BalanceCard';
import { FreshAchievement } from '@/components/FreshAchievement';
import { SwipeRow } from '@/components/SwipeRow';
import { toast } from '@/components/Toast';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ListRow,
  SectionHeading,
  Skeleton,
  fmt,
} from '@/components/ui';
import {
  dayLabel,
  musclesText,
  shortDayLabel,
  sizeText,
  weekdayLong,
} from '@/components/scheduleText';
import type { BlockState } from '@/core/block';
import { addDays, fromDateKey } from '@/core/dates';
import { formatDuration } from '@/core/restTimer';
import { describePlan, type ScheduleDay } from '@/core/schedule';
import { describeRun } from '@/core/streak';
import { MAX_SETS, MIN_SETS, type LoadReport } from '@/core/trainingLoad';
import { trainingWeek, weekStart } from '@/core/trainingWeek';
import type { Routine, WorkoutSession } from '@/core/types';
import { toDisplay, UNIT_LABEL } from '@/core/weightUnit';
import { deleteRoutine, restoreRoutine } from '@/db/repo/workouts';
import { useWeighIns } from '@/hooks/useData';
import { useMomentum } from '@/hooks/useMomentum';
import { useSchedule } from '@/hooks/useSchedule';
import {
  useActiveSession,
  useBlock,
  useRecentSessions,
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
import type { RoutineFacts, Schedule } from '@/services/schedule';
import { startSession } from '@/services/workouts';

/**
 * Where the week is short (§20.8).
 *
 * One line, not a chart. A per-muscle bar chart would be the obvious thing to build and the
 * wrong thing to read here: the only question worth answering on this screen is whether anything
 * needs attention. The body map has its own screen for the rest.
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
    <p className="mt-3 text-[13px] text-muted">
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
  const s = useSchedule();
  const recent = useRecentSessions(30);
  const unit = useWeightUnit();
  const coverage = useWeeklyLoad();
  const weighIns = useWeighIns();
  const block = useBlock();
  const momentum = useMomentum();

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
  const view = (id: string) => navigate(`/train/routines/${encodeURIComponent(id)}`);

  const remove = (r: Routine) => {
    void deleteRoutine(r.id).then(() =>
      toast(`${r.name} deleted`, { label: 'Undo', run: () => restoreRoutine(r.id) }),
    );
  };

  const fixed = (s?.plan.weekdays.length ?? 0) > 0;
  const hasRoutines = (s?.routines.length ?? 0) > 0;

  return (
    <div className="pb-32">
      <header className="pt-2">
        <p className="text-[14px] font-medium text-muted">
          {new Date().toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
        <h1 className="mt-0.5 text-[34px] leading-none font-extrabold tracking-[-0.03em]">Train</h1>
      </header>

      {/* The week sits on the background. Cards start below it. */}
      <section className="mt-6" aria-label="This week">
        {recent == null || !s ? (
          <Skeleton className="h-[132px] w-full rounded-[20px]" />
        ) : (
          <>
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-[13px] font-semibold text-muted">
                  {fixed
                    ? 'Training days this week'
                    : week.sessions === 1
                      ? 'Session this week'
                      : 'Sessions this week'}
                </div>
                <div className="display mt-1">
                  {fixed ? (
                    <>
                      {week.days.length}
                      <span className="ml-1.5 text-[22px] font-semibold text-muted">
                        of {s.plan.weekdays.length}
                      </span>
                    </>
                  ) : (
                    week.sessions
                  )}
                </div>
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
            <WeekDays days={s.days.slice(0, 7)} today={s.today} names={routineNames(s)} />
            {coverage && <Coverage report={coverage} easy={block?.kind === 'easy'} />}
          </>
        )}
      </section>

      {active ? (
        <InProgress session={active} onOpen={() => navigate('/train/session')} />
      ) : (
        s && hasRoutines && <TodayCard s={s} onStart={(r) => void begin(r)} onView={view} />
      )}

      {s && hasRoutines && !active && <ComingUp s={s} onView={view} />}

      {s && (
        <PlanRow
          s={s}
          onOpen={() => navigate('/train/schedule')}
          className={active ? 'mt-6' : 'mt-3'}
        />
      )}

      {!active && block && <BlockCard block={block} />}

      {/* Earned on another device, or by a week that closed: the summary is the first place. */}
      {!active && <FreshAchievement className="mt-6" />}

      <section className="mt-6 grid grid-cols-3 gap-2" aria-label="More">
        <Tile
          icon={Trophy}
          label="Run"
          value={
            !momentum || momentum.report.lifetime.sessions === 0
              ? 'Not yet'
              : momentum.streak.current.weeks > 0
                ? describeRun(momentum.streak.current.weeks)
                : 'This week'
          }
          sub={
            !momentum || momentum.report.lifetime.sessions === 0
              ? 'Train to start'
              : skipsShort(momentum.streak.skips.left)
          }
          onClick={() => navigate('/train/achievements')}
        />
        <Tile
          icon={PersonStanding}
          label="Balance"
          value="Body map"
          sub="What you hit"
          onClick={() => navigate('/train/balance')}
        />
        <Tile
          icon={Users}
          label="Circle"
          value="Friends"
          sub="By invite"
          onClick={() => navigate('/train/circle')}
        />
      </section>

      {/* §20.18 — the routines on the body: what they train and what they leave grey. */}
      {!active && <BalanceCard className="mt-6" />}

      <section className="mt-7" aria-label="Routines">
        <SectionHeading trailing={hasRoutines ? 'Swipe left to delete' : undefined}>
          Routines
        </SectionHeading>
        {!s ? (
          <Skeleton className="h-[140px] w-full rounded-[24px]" />
        ) : !hasRoutines ? (
          <Card>
            <EmptyState
              icon={Dumbbell}
              title="No routines yet"
              body="A routine is the list you work through. Build a week and choose your days, and Train lays it out for you."
              action={
                // Writing a week is the better first step for someone with nothing yet; building
                // one routine by hand is the button just below.
                <Button variant="primary" icon={ListPlus} onClick={() => navigate('/train/build')}>
                  Build a week for me
                </Button>
              }
            />
          </Card>
        ) : (
          <Card className="divide-y divide-line">
            {s.routines.map((r, i) => (
              <SwipeRow key={r.id} onDelete={() => remove(r)}>
                <RoutineRow
                  routine={r}
                  facts={s.facts[r.id]}
                  tag={nextTag(s, r.id)}
                  onOpen={() => view(r.id)}
                  delay={Math.min(i, 8) * 40}
                />
              </SwipeRow>
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
        {hasRoutines && (
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
            {recent.slice(0, 8).map((x, i) => (
              <ListRow
                key={x.id}
                className="rise-in"
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                onClick={() => navigate(`/train/summary/${encodeURIComponent(x.id)}`)}
                chevron
                title={x.name}
                subtitle={`${new Date(x.started_at).toLocaleDateString(undefined, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })} · ${formatDuration(x.duration_sec ?? 0)}`}
                value={x.volume_kg ? fmt(toDisplay(x.volume_kg, unit)) : ''}
                valueSub={x.volume_kg ? `${UNIT_LABEL[unit]} lifted` : undefined}
              />
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

function routineNames(s: Schedule): (id: string) => string | undefined {
  const byId = new Map(s.routines.map((r) => [r.id, r.name]));
  return (id) => byId.get(id);
}

/** "2 skips left", "No skips left": the tile's second line, shorter than `skipsLine`. */
function skipsShort(left: number): string {
  if (left <= 0) return 'No skips left';
  return `${left} ${left === 1 ? 'skip' : 'skips'} left`;
}

/** The soonest day this routine is laid on in the coming week, as a short tag. */
function nextTag(s: Schedule, id: string): string | undefined {
  const d = s.days.find(
    (x) => x.date >= s.today && x.slot?.routine_id === id && x.state !== 'done',
  );
  if (d) {
    if (d.date === s.today) return 'Today';
    if (d.date <= addDays(s.today, 6)) {
      return fromDateKey(d.date).toLocaleDateString(undefined, { weekday: 'short' });
    }
    return undefined;
  }
  if (s.plan.weekdays.length === 0 && s.next?.routine.id === id) return 'Next';
  return undefined;
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
 * The week, drawn: seven days, Monday first. Done days are filled, training days still ahead are
 * tinted in training's blue, today is ringed. Missed days are not marked as failures — a missed
 * day's routine has simply moved on (§20.17), and the strip says nothing more than that it was
 * a training day.
 */
function WeekDays({
  days,
  today,
  names,
}: {
  days: ScheduleDay[];
  today: string;
  names: (id: string) => string | undefined;
}) {
  return (
    <ol className="mt-4 grid grid-cols-7 gap-1" aria-label="Days of this week">
      {days.map((d) => {
        const date = fromDateKey(d.date);
        const isToday = d.date === today;
        const what =
          d.state === 'done'
            ? `trained${d.done[0]?.routine_id ? `, ${names(d.done[0].routine_id) ?? d.done[0].name}` : ''}`
            : d.slot
              ? `${isToday ? 'today, ' : ''}${names(d.slot.routine_id) ?? 'training'}`
              : d.planned
                ? d.state === 'missed'
                  ? 'training day, nothing logged'
                  : 'training day'
                : 'rest';
        const circle =
          d.state === 'done'
            ? 'bg-accent text-on-accent'
            : d.planned && d.state !== 'missed'
              ? isToday
                ? 'bg-accent-2/15 text-accent-2 ring-2 ring-accent-2'
                : 'bg-accent-2/15 text-accent-2'
              : isToday
                ? 'text-ink ring-2 ring-surface-3'
                : d.planned
                  ? 'bg-surface-2 text-muted'
                  : 'text-muted';
        return (
          <li
            key={d.date}
            className="flex flex-col items-center"
            aria-label={`${date.toLocaleDateString(undefined, { weekday: 'long' })} ${date.getDate()}: ${what}`}
          >
            <span
              className={`text-[11px] font-semibold ${isToday ? 'text-ink' : 'text-muted'}`}
              aria-hidden
            >
              {date.toLocaleDateString(undefined, { weekday: 'narrow' })}
            </span>
            <span
              className={`mt-1.5 flex h-9 w-9 items-center justify-center rounded-full text-[14px] font-bold tabular transition-colors duration-700 ease-[var(--ease-out-soft)] ${circle}`}
              aria-hidden
            >
              {d.state === 'done' ? <Check size={16} strokeWidth={3} /> : date.getDate()}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function InProgress({ session, onOpen }: { session: WorkoutSession; onOpen: () => void }) {
  return (
    <section className="mt-6" aria-label="In progress">
      <Card className="p-5" onClick={onOpen}>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Play size={20} strokeWidth={2.4} aria-hidden />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[17px] font-bold">{session.name}</span>
            <span className="block text-[13px] text-muted">In progress — tap to carry on</span>
          </span>
        </div>
      </Card>
    </section>
  );
}

/**
 * Today's routine, and the button that starts it.
 *
 * With fixed days it reads the schedule: Today on a training day, Done today once trained (and
 * points at the next one), Rest day otherwise. With no fixed days it is the rotation's next
 * routine (§20.10), saying what it comes after, because a suggestion that does not show its
 * working reads as the app having an opinion. Once today is trained its button steps down, so it
 * never reads as asking for a second session.
 */
function TodayCard({
  s,
  onStart,
  onView,
}: {
  s: Schedule;
  onStart: (r: Routine) => void;
  onView: (id: string) => void;
}) {
  const byId = new Map(s.routines.map((r) => [r.id, r]));
  const todayDay = s.days.find((d) => d.date === s.today);
  const fixed = s.plan.weekdays.length > 0;
  const upcoming = s.days.find((d) => d.date > s.today && d.slot);

  let label: string;
  let region: string;
  let icon: LucideIcon = Play;
  let routine: Routine | undefined;
  let when: string | undefined;
  let primary = true;

  if (fixed) {
    if (todayDay?.state === 'today' && todayDay.slot) {
      routine = byId.get(todayDay.slot.routine_id);
      label = 'Today';
      region = 'Today';
    } else if (todayDay?.state === 'done') {
      routine = upcoming?.slot ? byId.get(upcoming.slot.routine_id) : undefined;
      label = 'Done today';
      region = 'Next time';
      icon = Check;
      primary = false;
      when = upcoming ? weekdayLong(upcoming.date, s.today) : undefined;
    } else {
      routine = upcoming?.slot ? byId.get(upcoming.slot.routine_id) : s.next?.routine;
      label = 'Rest day';
      region = 'Rest day';
      icon = Moon;
      primary = false;
      when = upcoming ? weekdayLong(upcoming.date, s.today) : undefined;
    }
  } else {
    routine = s.next?.routine;
    const trained = s.next?.trained_today ?? false;
    label = trained ? 'Next time' : 'Up next';
    region = label;
    primary = !trained;
  }
  if (!routine) return null;

  const f = s.facts[routine.id];
  const after =
    !fixed && s.next?.after && s.next.after_date
      ? `after ${s.next.after.name} ${relativeDay(s.next.after_date, s.today)}`
      : !fixed
        ? 'first in your list'
        : undefined;
  const missed =
    s.missed && s.missed.routine_id === routine.id && s.missed.moved_to === s.today
      ? `Moved from ${weekdayLong(s.missed.missed, s.today)}, when it was missed`
      : undefined;

  return (
    <section className="mt-6" aria-label={region}>
      <Card className="p-5">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-accent-2">
          {(() => {
            const Icon = icon;
            return <Icon size={14} strokeWidth={2.6} aria-hidden />;
          })()}
          <span>{label}</span>
          {when && <span className="font-medium text-muted">· next on {when}</span>}
        </div>
        <div className="mt-1.5 text-[26px] leading-tight font-extrabold tracking-[-0.02em]">
          {routine.name}
        </div>
        {f && f.muscles.length > 0 && (
          <div className="mt-1 text-[14px] text-ink-2">{musclesText(f.muscles)}</div>
        )}
        <div className="mt-0.5 text-[13px] text-muted tabular">
          {f ? sizeText(f) : `${routine.items.length} exercises`}
          {after ? `, ${after}` : ''}
        </div>
        {missed && <div className="mt-1 text-[13px] text-muted">{missed}</div>}

        {f && f.thumbs.length > 0 && (
          <div className="mt-4 flex gap-2" aria-hidden>
            {f.thumbs.map((t) => (
              <ExerciseThumb key={t.media} media={t.media} name={t.name} className="h-14 w-14" />
            ))}
            {routine.items.length > f.thumbs.length && (
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-[14px] font-semibold text-muted tabular">
                +{routine.items.length - f.thumbs.length}
              </span>
            )}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <Button
            variant={primary ? 'primary' : 'secondary'}
            icon={Play}
            className="flex-1"
            aria-label={`Start ${routine.name}`}
            onClick={() => onStart(routine)}
          >
            {primary ? 'Start' : 'Start now'}
          </Button>
          <Button
            className="shrink-0"
            aria-label={`View ${routine.name}`}
            onClick={() => onView(routine.id)}
          >
            View
          </Button>
        </div>
      </Card>
    </section>
  );
}

/** "today", "yesterday", "on Wed 14 Oct": as far back as a rotation reaches. */
function relativeDay(date: string, today: string): string {
  const l = dayLabel(date, today);
  if (l === 'Today' || l === 'Yesterday') return l.toLowerCase();
  return `on ${l}`;
}

/**
 * The training days after the one on the card above, as many as fit in the week ahead. With no
 * fixed days, the routines that follow next in the cycle.
 */
function ComingUp({ s, onView }: { s: Schedule; onView: (id: string) => void }) {
  const byId = new Map(s.routines.map((r) => [r.id, r]));
  const fixed = s.plan.weekdays.length > 0;
  const todayDay = s.days.find((d) => d.date === s.today);
  // The card above shows today's when it is a training day; otherwise it shows the first one
  // ahead, which is then not repeated here.
  const ahead = s.days.filter((d) => d.date > s.today && d.slot);
  const shown = fixed ? (todayDay?.state === 'today' ? ahead : ahead.slice(1)).slice(0, 3) : [];
  const rows = fixed
    ? shown.map((d) => ({
        key: d.date,
        id: d.slot!.routine_id,
        when: shortDayLabel(d.date, s.today),
      }))
    : // Distinct ones only: a lap shorter than the list would repeat the card above.
      s.upcoming.slice(1, Math.min(4, s.cycle.length)).map((u, i) => ({
        key: `${u.routine_id}-${i}`,
        id: u.routine_id,
        when: i === 0 ? 'After that' : 'Then',
      }));
  if (rows.length === 0) return null;

  return (
    <section className="mt-3" aria-label="Coming up">
      <Card className="divide-y divide-line">
        {rows.map((row) => {
          const f = s.facts[row.id];
          return (
            <ListRow
              key={row.key}
              onClick={() => onView(row.id)}
              leading={
                <span className="w-[68px] shrink-0 text-[13px] font-semibold text-muted tabular">
                  {row.when}
                </span>
              }
              title={byId.get(row.id)?.name ?? ''}
              subtitle={f && f.muscles.length > 0 ? musclesText(f.muscles) : undefined}
              chevron
            />
          );
        })}
      </Card>
    </section>
  );
}

/** The plan in one row, and the way to change it. Prompts when nothing is chosen yet. */
function PlanRow({
  s,
  onOpen,
  className = '',
}: {
  s: Schedule;
  onOpen: () => void;
  className?: string;
}) {
  const chosen = s.plan.weekdays.length > 0 || s.plan.per_week != null;
  const order = s.suggestion
    ? `a better order is suggested`
    : s.cycle_is_default
      ? 'routines in list order'
      : `a ${s.cycle.length}-day cycle`;
  return (
    <section className={className} aria-label="Your week">
      <Card className="divide-y divide-line">
        <ListRow
          onClick={onOpen}
          icon={CalendarDays}
          iconTone="accent"
          title={chosen ? describePlan(s.plan) : 'Choose your training days'}
          subtitle={chosen ? `Your week, ${order}` : 'So Train can lay your routines on them'}
          chevron
        />
      </Card>
    </section>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  sub,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <Card className="p-3.5" onClick={onClick}>
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-2/15 text-accent-2">
        <Icon size={16} strokeWidth={2.2} aria-hidden />
      </span>
      <span className="mt-2.5 block text-[12px] font-semibold text-muted">{label}</span>
      <span className="block truncate text-[15px] leading-tight font-bold">{value}</span>
      <span className="mt-0.5 block truncate text-[12px] text-muted">{sub}</span>
    </Card>
  );
}

/** A routine as a row worth reading: its face, what it works, its size, and when it is next. */
function RoutineRow({
  routine,
  facts,
  tag,
  onOpen,
  delay,
}: {
  routine: Routine;
  facts: RoutineFacts | undefined;
  tag: string | undefined;
  onOpen: () => void;
  delay: number;
}) {
  const thumb = facts?.thumbs[0];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rise-in flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors duration-150 active:bg-surface-2"
      style={{ animationDelay: `${delay}ms` }}
    >
      <ExerciseThumb media={thumb?.media} name={thumb?.name ?? routine.name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[16px] leading-snug font-semibold">{routine.name}</span>
          {tag && <Badge tone="accent">{tag}</Badge>}
        </span>
        {facts && facts.muscles.length > 0 && (
          <span className="mt-0.5 block truncate text-[13px] text-ink-2">
            {musclesText(facts.muscles)}
          </span>
        )}
        <span className="mt-0.5 block truncate text-[13px] text-muted tabular">
          {/* Sets are on the routine's page; the row keeps room for when it was last done. */}
          {facts ? sizeText({ ...facts, sets: 0 }) : `${routine.items.length} exercises`}
          {facts?.last_done
            ? ` · last ${fromDateKey(facts.last_done).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
              })}`
            : ''}
        </span>
      </span>
      <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden className="shrink-0 text-muted">
        <path
          d="M1 1l6 6-6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
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
