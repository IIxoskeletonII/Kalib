// SPEC §20.15 — the run, the aim, and the milestones.
//
// Read, not played. The lifetime figures sit on the page like every other total in the app; the
// run gets its last twelve weeks drawn as marks because "which weeks counted" is the one thing
// a single number cannot say; and the milestones are a plain list, earned ones dated, with only
// the next of each kind showing how far there is to go. No locks, no greyed-out trophies cabinet,
// no confetti: this is a screen opened to look something up, and applause for something
// already known is noise (MASTER.md).
import { CalendarCheck, ChevronLeft, Repeat, Trophy, Weight, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { Card, IconButton, SectionHeading, Segmented, Skeleton, fmt } from '@/components/ui';
import {
  comparison,
  formatMass,
  nextUp,
  progressOf,
  type Achievement,
  type AchievementKind,
} from '@/core/achievements';
import { fromDateKey } from '@/core/dates';
import { describeRun, skipsLine, weekLine, type StreakWeek } from '@/core/streak';
import type { WeightUnit } from '@/core/types';
import { useBack } from '@/hooks/useBack';
import { useMomentum } from '@/hooks/useMomentum';
import { useWeightUnit } from '@/hooks/useWorkouts';
import { markSeen, setAim } from '@/services/momentum';

const KINDS: { kind: AchievementKind; heading: string; icon: LucideIcon }[] = [
  { kind: 'volume', heading: 'Weight lifted', icon: Weight },
  { kind: 'sessions', heading: 'Workouts', icon: CalendarCheck },
  { kind: 'streak', heading: 'Runs', icon: Repeat },
];

const AIMS = ['auto', '1', '2', '3', '4', '5', '6'] as const;
type AimChoice = (typeof AIMS)[number];

/** How many past weeks the strip draws. A quarter: long enough to see a pattern. */
const STRIP_WEEKS = 12;

export default function Achievements() {
  const back = useBack('/train');
  const m = useMomentum();
  const unit = useWeightUnit();

  // Opening the list is seeing what is on it.
  const fresh = m?.fresh.map((a) => a.id).join(',') ?? '';
  useEffect(() => {
    if (fresh) void markSeen(fresh.split(','));
  }, [fresh]);

  return (
    <div className="pb-10">
      <header className="flex items-start gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-[14px] font-medium text-muted">Training</p>
          <h1 className="mt-0.5 text-[24px] leading-none font-extrabold tracking-[-0.03em]">
            Achievements
          </h1>
        </div>
      </header>

      {!m ? (
        <Skeleton className="mt-7 h-[120px] w-full rounded-[20px]" />
      ) : (
        <>
          <Lifetime
            kg={m.report.lifetime.kg}
            unknown={m.report.lifetime.unknown_sets}
            sessions={m.report.lifetime.sessions}
            unit={unit}
          />
          <Run m={m} />
          {KINDS.map(({ kind, heading, icon }) => (
            <Milestones
              key={kind}
              heading={heading}
              icon={icon}
              items={m.report.items.filter((a) => a.kind === kind)}
              next={nextUp(m.report.items, kind)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function Lifetime({
  kg,
  unknown,
  sessions,
  unit,
}: {
  kg: number;
  unknown: number;
  sessions: number;
  unit: WeightUnit;
}) {
  const like = comparison(kg);
  return (
    <section className="mt-7" aria-label="Lifted in all">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-muted">Lifted in all</div>
          <div className="display mt-1">{formatMass(kg, unit)}</div>
        </div>
        <div className="pb-1 text-right tabular">
          <div className="text-[16px] font-bold">
            {fmt(sessions)}
            <span className="ml-1 text-[13px] font-medium text-muted">
              {sessions === 1 ? 'workout' : 'workouts'}
            </span>
          </div>
        </div>
      </div>
      {like && <p className="mt-2 text-[14px] text-ink-2">About {like}.</p>}
      {unknown > 0 && (
        <p className="mt-1 text-[12px] text-muted">
          {unknown} bodyweight {unknown === 1 ? 'set is' : 'sets are'} not in that total — weigh in
          and they will be.
        </p>
      )}
    </section>
  );
}

/** "14 Aug", with the year once it is not this one. */
function shortDate(key: string): string {
  const d = fromDateKey(key);
  const year = d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
  });
}

function Run({ m }: { m: NonNullable<ReturnType<typeof useMomentum>> }) {
  const { streak } = m;
  const choice: AimChoice = m.aim_setting == null ? 'auto' : (String(m.aim_setting) as AimChoice);
  const weeks = streak.history.slice(-STRIP_WEEKS);
  const auto = m.aim_setting == null;
  return (
    <section className="mt-7" aria-label="Weeks running">
      <SectionHeading trailing={`best ${describeRun(streak.best.weeks)}`}>
        {streak.current.weeks > 0
          ? `${describeRun(streak.current.weeks)} running`
          : 'A run starts this week'}
      </SectionHeading>
      <Card className="p-5">
        <WeekStrip weeks={weeks} />
        <p className="mt-4 text-[14px] leading-snug text-ink-2">
          {weekLine(streak.this_week)}. {skipsLine(streak.skips)}.
        </p>
        <div role="group" aria-labelledby="aim-label">
          <div className="mt-5 text-[13px] font-semibold text-muted" id="aim-label">
            Days a week
          </div>
          <Segmented
            className="mt-2"
            value={choice}
            options={AIMS.map((v) => ({ value: v, label: v === 'auto' ? 'Auto' : v }))}
            onChange={(v) => void setAim(v === 'auto' ? null : Number(v))}
          />
        </div>
        <p className="mt-2 text-[13px] leading-snug text-muted">
          {auto
            ? streak.this_week.aim_source === 'inferred'
              ? `Auto follows your last four weeks: ${streak.this_week.aim} this week.`
              : 'Auto asks for one day a week until there are two weeks to go on.'
            : 'From this week on. Weeks already over keep the aim they had.'}
        </p>
      </Card>
      <p className="mt-2 px-1 text-[12px] leading-snug text-muted">
        A week counts when you train on as many days as your aim. Each month forgives three days
        short, and an easier week never breaks a run.
      </p>
    </section>
  );
}

const MARK: Record<StreakWeek['status'], { cls: string; word: string }> = {
  met: { cls: 'bg-accent', word: 'counted' },
  forgiven: { cls: 'bg-accent/40', word: 'forgiven' },
  easy: { cls: 'bg-accent/40', word: 'easier week' },
  missed: { cls: 'bg-surface-3', word: 'short' },
  open: { cls: 'bg-surface-2 ring-1 ring-inset ring-line', word: 'this week' },
};

/** The last weeks as marks, oldest on the left, each named for a screen reader. */
function WeekStrip({ weeks }: { weeks: readonly StreakWeek[] }) {
  return (
    <div>
      <ol className="flex items-end gap-1.5" aria-label="Recent weeks">
        {weeks.map((w) => (
          <li
            key={w.monday}
            className="flex flex-1 justify-center"
            aria-label={`Week of ${shortDate(w.monday)}: ${w.days} of ${w.aim} ${w.aim === 1 ? 'day' : 'days'}, ${MARK[w.status].word}`}
          >
            <span className={`block h-6 w-2.5 rounded-full ${MARK[w.status].cls}`} />
          </li>
        ))}
      </ol>
      <div className="mt-2 flex justify-between text-[11px] font-semibold text-muted">
        <span>{weeks[0] ? shortDate(weeks[0].monday) : ''}</span>
        <span>This week</span>
      </div>
      {/* The two fills need naming once; the marks themselves are named for a screen reader. */}
      <div className="mt-3 flex gap-4 text-[12px] text-muted" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="block h-3 w-1.5 rounded-full bg-accent" />
          Counted
        </span>
        <span className="flex items-center gap-1.5">
          <span className="block h-3 w-1.5 rounded-full bg-accent/40" />
          Forgiven or easier
        </span>
      </div>
    </div>
  );
}

function Milestones({
  heading,
  icon: Icon,
  items,
  next,
}: {
  heading: string;
  icon: LucideIcon;
  items: Achievement[];
  next: Achievement | undefined;
}) {
  const earned = items.filter((a) => a.earned_on != null).length;
  return (
    <section className="mt-7" aria-label={heading}>
      <SectionHeading trailing={`${earned} of ${items.length}`}>{heading}</SectionHeading>
      <Card className="divide-y divide-line">
        {items.map((a) => {
          const done = a.earned_on != null;
          const isNext = a.id === next?.id;
          const pct = Math.floor(progressOf(a) * 100);
          return (
            <div key={a.id} className="flex min-h-16 items-center gap-3.5 px-4 py-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  done ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-muted'
                }`}
              >
                {done ? (
                  <Trophy size={18} strokeWidth={2.2} aria-hidden />
                ) : (
                  <Icon size={18} strokeWidth={2.2} aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-[16px] leading-snug font-medium ${done ? '' : 'text-ink-2'}`}>
                  {a.title}
                </div>
                <div className="mt-0.5 text-[13px] leading-snug text-muted">{a.detail}</div>
                {isNext && (
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
                    role="progressbar"
                    aria-label={`${a.title} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                  >
                    <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right tabular text-[13px]">
                {done ? (
                  <span className="text-ink-2">{shortDate(a.earned_on!)}</span>
                ) : isNext ? (
                  <span className="font-semibold text-ink-2">{pct}%</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </Card>
    </section>
  );
}
