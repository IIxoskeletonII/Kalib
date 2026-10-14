// SPEC §20.1 — the training home.
//
// Structured the way the rest of the app is: the week's figures sit directly on the background,
// and the cards below are things you tap. Starting a routine is the common act, so the routines
// carry the weight; an empty workout is the exception and reads like one.
import { Dumbbell, Play, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { toast } from '@/components/Toast';
import { Button, Card, EmptyState, ListRow, SectionHeading, Skeleton, fmt } from '@/components/ui';
import { fromDateKey, toDateKey } from '@/core/dates';
import { formatDuration } from '@/core/restTimer';
import { trainingWeek, weekStart } from '@/core/trainingWeek';
import type { Routine } from '@/core/types';
import { toDisplay, UNIT_LABEL } from '@/core/weightUnit';
import { useWeighIns } from '@/hooks/useData';
import {
  useActiveSession,
  useRecentSessions,
  useRoutines,
  useWeightUnit,
} from '@/hooks/useWorkouts';
import { startSession } from '@/services/workouts';

export default function Train() {
  const navigate = useNavigate();
  const active = useActiveSession();
  const routines = useRoutines();
  const recent = useRecentSessions(30);
  const unit = useWeightUnit();
  const weighIns = useWeighIns();

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
          </>
        )}
      </section>

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
              <Button variant="primary" icon={Plus} onClick={() => navigate('/train/routine/new')}>
                New routine
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
