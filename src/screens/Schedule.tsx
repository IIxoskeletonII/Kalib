// SPEC §20.17 — your week: the days you train, and the order your routines come round.
//
// Two choices and a preview of what they produce. The days are seven toggles; the order is the
// cycle, a routine allowed more than once, edited a row at a time through a sheet (MASTER: one
// control per row). Below them, the next two weeks as the app will lay them out, so the effect
// of either choice is visible the moment it is made.
import { ArrowDown, ArrowUp, ChevronLeft, Plus, Repeat, Shuffle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { DaysPicker } from '@/components/DaysPicker';
import { toast } from '@/components/Toast';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  ListRow,
  SectionHeading,
  Sheet,
  Skeleton,
} from '@/components/ui';
import {
  dayLabel,
  KIND_LABEL,
  musclesText,
  sizeText,
  weekdayLong,
} from '@/components/scheduleText';
import { addSlot, moveSlot, removeSlot, type ScheduleDay } from '@/core/schedule';
import { useBack } from '@/hooks/useBack';
import { useSchedule } from '@/hooks/useSchedule';
import {
  getStoredCycle,
  resetCycle,
  restoreCycle,
  setCycle,
  setPlan,
  type Schedule as ScheduleData,
} from '@/services/schedule';

export default function Schedule() {
  const back = useBack('/train');
  const s = useSchedule();

  return (
    <div className="pb-10">
      <header className="flex items-start gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-[14px] font-medium text-muted">Training</p>
          <h1 className="mt-0.5 text-[24px] leading-none font-extrabold tracking-[-0.03em]">
            Your week
          </h1>
        </div>
      </header>

      {!s ? (
        <Skeleton className="mt-7 h-[220px] w-full rounded-[24px]" />
      ) : (
        <>
          <section className="mt-7" aria-label="Days">
            <SectionHeading>Days you train</SectionHeading>
            <Card className="p-5">
              <DaysPicker plan={s.plan} onChange={(p) => void setPlan(p)} />
            </Card>
            <p className="mt-2 px-1 text-[12px] leading-snug text-muted">
              Also your weekly aim on Achievements and in your circle, and the days that eat more
              when that is on.
            </p>
          </section>

          <Order s={s} />
          <Ahead s={s} />
        </>
      )}
    </div>
  );
}

/** The cycle. Rows open a sheet; the sheet holds every change a slot can take. */
function Order({ s }: { s: ScheduleData }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const byId = new Map(s.routines.map((r) => [r.id, r]));

  const edit = async (slots: string[], message: string) => {
    const before = await getStoredCycle();
    await setCycle(slots);
    toast(message, { label: 'Undo', run: () => restoreCycle(before) });
  };

  if (s.routines.length === 0) {
    return (
      <section className="mt-7" aria-label="Order">
        <SectionHeading>Order</SectionHeading>
        <Card>
          <EmptyState
            icon={Repeat}
            title="No routines yet"
            body="Routines come round in the order you set here. Build a week, or make one, first."
            action={
              <Button variant="primary" onClick={() => navigate('/train/build')}>
                Build a week for me
              </Button>
            }
          />
        </Card>
      </section>
    );
  }

  const slot = open == null ? undefined : s.cycle[open];
  const name = (id: string | undefined) => (id ? (byId.get(id)?.name ?? '') : '');

  return (
    <section className="mt-7" aria-label="Order">
      <SectionHeading trailing={`${s.cycle.length} in the cycle`}>Order</SectionHeading>

      {s.suggestion && <Suggestion s={s} onUse={(slots) => void edit(slots, 'Order changed')} />}

      <Card className="divide-y divide-line">
        {s.cycle.map((id, i) => {
          const f = s.facts[id];
          const kind = KIND_LABEL[s.kinds[id] ?? 'other'];
          return (
            <ListRow
              key={`${id}-${i}`}
              onClick={() => setOpen(i)}
              leading={
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-2/15 text-[14px] font-bold text-accent-2 tabular"
                  aria-hidden
                >
                  {i + 1}
                </span>
              }
              title={name(id)}
              subtitle={[kind, f ? musclesText(f.muscles) : ''].filter(Boolean).join(' · ')}
              chevron
            />
          );
        })}
      </Card>

      <div className="mt-3 flex gap-2">
        <Button icon={Plus} className="flex-1" onClick={() => setAdding(true)}>
          Add to the order
        </Button>
        {!s.cycle_is_default && (
          <Button
            variant="ghost"
            className="shrink-0"
            onClick={() => {
              void (async () => {
                const before = await getStoredCycle();
                await resetCycle();
                toast('Back to list order', { label: 'Undo', run: () => restoreCycle(before) });
              })();
            }}
          >
            List order
          </Button>
        )}
      </div>
      <p className="mt-2 px-1 text-[12px] leading-snug text-muted">
        A routine can come round more than once. Missed a day? Its routine moves to the next
        training day rather than being skipped.
      </p>

      <Sheet open={open != null} onClose={() => setOpen(null)} title={name(slot)}>
        {open != null && slot && (
          <div className="space-y-2">
            <p className="mb-3 text-[14px] text-muted">Number {open + 1} in the order.</p>
            <Button
              icon={ArrowUp}
              className="w-full"
              disabled={open === 0}
              onClick={() => {
                void edit(moveSlot(s.cycle, open, open - 1), 'Moved earlier');
                setOpen(null);
              }}
            >
              Move earlier
            </Button>
            <Button
              icon={ArrowDown}
              className="w-full"
              disabled={open === s.cycle.length - 1}
              onClick={() => {
                void edit(moveSlot(s.cycle, open, open + 1), 'Moved later');
                setOpen(null);
              }}
            >
              Move later
            </Button>
            <Button
              icon={Repeat}
              className="w-full"
              onClick={() => {
                void edit(addSlot(s.cycle, slot), `${name(slot)} added again`);
                setOpen(null);
              }}
            >
              Add it again at the end
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              className="w-full"
              disabled={s.cycle.length <= 1}
              onClick={() => {
                void edit(removeSlot(s.cycle, open), `${name(slot)} taken out of the order`);
                setOpen(null);
              }}
            >
              Take out of the order
            </Button>
            <p className="pt-1 text-center text-[12px] text-muted">
              The routine itself stays in your list.
            </p>
          </div>
        )}
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add to the order">
        <Card className="divide-y divide-line">
          {s.routines.map((r) => (
            <ListRow
              key={r.id}
              title={r.name}
              subtitle={s.facts[r.id] ? sizeText(s.facts[r.id]!) : undefined}
              icon={Plus}
              iconTone="accent"
              onClick={() => {
                void edit(addSlot(s.cycle, r.id), `${r.name} added`);
                setAdding(false);
              }}
            />
          ))}
        </Card>
      </Sheet>
    </section>
  );
}

/**
 * The alternating lap (§20.17), offered once there is one that differs from the order in force.
 * It says which kind repeats, because "alternate your routines" alone would not say why.
 */
function Suggestion({ s, onUse }: { s: ScheduleData; onUse: (slots: string[]) => void }) {
  const slots = s.suggestion!;
  const byId = new Map(s.routines.map((r) => [r.id, r.name]));
  const counts = new Map<string, Set<string>>();
  for (const id of slots) {
    const k = KIND_LABEL[s.kinds[id] ?? 'other'] || 'Other';
    counts.set(k, (counts.get(k) ?? new Set()).add(id));
  }
  const repeated = [...counts.entries()].filter(([, v]) => v.size > 1).map(([k]) => k);
  const title =
    repeated.length === 1
      ? `Alternate your ${repeated[0]!.toLowerCase()} days?`
      : 'Alternate your routines?';
  return (
    <section aria-label="Suggested order" className="mb-3">
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-2/15 text-accent-2">
            <Shuffle size={18} strokeWidth={2.2} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] leading-tight font-bold">{title}</div>
            <p className="mt-1 text-[14px] leading-snug text-ink-2">
              Taking turns, every lap keeps the same shape and each variant comes round in its
              place:
            </p>
            <ol className="mt-2 space-y-0.5 text-[14px] text-ink-2">
              {slots.map((id, i) => (
                <li key={`${id}-${i}`} className="flex gap-2">
                  <span className="w-4 shrink-0 text-right text-muted tabular">{i + 1}</span>
                  <span className="truncate">{byId.get(id)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <Button variant="primary" size="sm" className="mt-4 w-full" onClick={() => onUse(slots)}>
          Use this order
        </Button>
      </Card>
    </section>
  );
}

/** The next two weeks as they will be laid out, or, with no fixed days, what comes next. */
function Ahead({ s }: { s: ScheduleData }) {
  const navigate = useNavigate();
  const byId = new Map(s.routines.map((r) => [r.id, r]));
  const open = (id: string | undefined) =>
    id && byId.has(id) && navigate(`/train/routines/${encodeURIComponent(id)}`);

  if (s.routines.length === 0) return null;

  if (s.plan.weekdays.length === 0) {
    return (
      <section className="mt-7" aria-label="Coming up">
        <SectionHeading>Coming up</SectionHeading>
        <Card className="divide-y divide-line">
          {s.upcoming.map((u, i) => (
            <ListRow
              key={`${u.routine_id}-${i}`}
              title={byId.get(u.routine_id)?.name ?? ''}
              subtitle={i === 0 ? 'Next' : `Then, ${ordinal(i + 1)}`}
              onClick={() => open(u.routine_id)}
              chevron
            />
          ))}
        </Card>
        <p className="mt-2 px-1 text-[12px] leading-snug text-muted">
          With no fixed days, each routine is simply next until it is done. Choose days above to see
          them on a calendar.
        </p>
      </section>
    );
  }

  const shown = s.days.filter((d) => d.planned || d.state === 'done');
  return (
    <section className="mt-7" aria-label="Coming up">
      <SectionHeading>Next two weeks</SectionHeading>
      {s.missed && (
        <p className="mb-3 px-1 text-[14px] text-ink-2">
          Missed {weekdayLong(s.missed.missed, s.today)}?{' '}
          {byId.get(s.missed.routine_id)?.name ?? 'It'} moves to{' '}
          {s.missed.moved_to === s.today ? 'today' : weekdayLong(s.missed.moved_to, s.today)}.
        </p>
      )}
      <Card className="divide-y divide-line">
        {shown.map((d) => (
          <AheadRow
            key={d.date}
            d={d}
            today={s.today}
            name={(id) => byId.get(id)?.name}
            onOpen={open}
          />
        ))}
      </Card>
    </section>
  );
}

function AheadRow({
  d,
  today,
  name,
  onOpen,
}: {
  d: ScheduleDay;
  today: string;
  name: (id: string) => string | undefined;
  onOpen: (id: string | undefined) => void;
}) {
  const routineId = d.slot?.routine_id ?? d.done.find((x) => x.routine_id)?.routine_id;
  const title =
    d.state === 'done'
      ? d.done.map((x) => (x.routine_id ? (name(x.routine_id) ?? x.name) : x.name)).join(', ')
      : d.slot
        ? (name(d.slot.routine_id) ?? '')
        : 'Training day';
  const value =
    d.state === 'done'
      ? 'Done'
      : d.state === 'missed'
        ? 'Missed'
        : d.state === 'today'
          ? 'Today'
          : '';
  return (
    <ListRow
      title={title}
      subtitle={dayLabel(d.date, today)}
      value={value || undefined}
      onClick={routineId ? () => onOpen(routineId) : undefined}
      chevron={!!routineId}
      className={d.state === 'missed' ? 'opacity-60' : ''}
    />
  );
}

function ordinal(n: number): string {
  return (
    ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'][n] ?? `${n}th`
  );
}
