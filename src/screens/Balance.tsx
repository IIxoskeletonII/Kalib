// SPEC §20.18 — the balance of your routines: what they train, what they miss, and the fix.
//
// Read top to bottom as a question and its answer. The body first, because it is the one
// picture that says at a glance what a list of nineteen numbers cannot; then the fixes, because
// they are what the screen is for; then the evidence — the pairs and every muscle's figure —
// for anyone who wants to check the arithmetic before tapping Apply.
import { ChevronLeft, ListPlus, Plus, Scale } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { BodyMap } from '@/components/bodyMap/BodyMap';
import { Explainer } from '@/components/Explainer';
import { toast } from '@/components/Toast';
import { Button, Card, EmptyState, IconButton, SectionHeading, Skeleton } from '@/components/ui';
import {
  deficitSets,
  describeDeficit,
  describeFix,
  formatSets,
  type BalanceFix,
  type BalanceReport,
  type MusclePlan,
  type PairReport,
} from '@/core/balance';
import { MUSCLE_LABEL } from '@/core/muscles';
import { MAX_SETS, MIN_SETS } from '@/core/trainingLoad';
import type { Muscle } from '@/core/types';
import { useBack } from '@/hooks/useBack';
import { useBalance } from '@/hooks/useBalance';
import { applyFix } from '@/services/balance';

export default function Balance() {
  const back = useBack('/train');
  const navigate = useNavigate();
  const b = useBalance();
  const [selected, setSelected] = useState<Muscle | undefined>();
  const map = useRef<HTMLDivElement>(null);

  const select = (m: Muscle) => {
    setSelected((s) => (s === m ? undefined : m));
    map.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  return (
    <div className="pb-10">
      <header className="flex items-start gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-[14px] font-medium text-muted">Training</p>
          <h1 className="mt-0.5 text-[24px] leading-none font-extrabold tracking-[-0.03em]">
            Muscle balance
          </h1>
        </div>
      </header>

      {!b ? (
        <Skeleton className="mt-7 h-[380px] w-full rounded-[20px]" />
      ) : b.report.routines === 0 ? (
        <EmptyState
          icon={Scale}
          title="No routines yet"
          body="Write a routine, or have one built, and this shows what your week trains and what it misses."
          action={
            <div className="flex flex-col gap-2">
              <Button variant="primary" icon={ListPlus} onClick={() => navigate('/train/build')}>
                Build a week for me
              </Button>
              <Button icon={Plus} onClick={() => navigate('/train/routine/new')}>
                New routine
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <p className="mt-3 px-1 text-[14px] leading-snug text-muted">
            Planned sets a week from your {b.report.routines}{' '}
            {b.report.routines === 1 ? 'routine' : 'routines'}
            {b.scheduled ? ', as often as each comes round.' : ', each counted once a week.'}
          </p>

          <section ref={map} aria-label="Muscle map" className="mt-6 scroll-mt-4">
            <BodyMap report={b.report} selected={selected} />
          </section>

          <Fixes fixes={b.fixes} report={b.report} />
          <Pairs pairs={b.report.pairs} />
          <Muscles report={b.report} selected={selected} onSelect={select} />

          <Explainer id="balance" summary="How this is counted" className="mt-8">
            <p>
              Each routine counts once a week until your week has days. A set counts once for the
              muscle it aims at and half for each muscle that assists — the same rule your week's
              coverage uses, so the two agree.
            </p>
            <p className="mt-2">
              Ten to twenty hard sets a week is where the evidence clusters. Forearms, traps, lower
              back and neck are shown but never chased: the big lifts already train them.
            </p>
          </Explainer>
        </>
      )}
    </div>
  );
}

function Fixes({ fixes, report }: { fixes: readonly BalanceFix[]; report: BalanceReport }) {
  const [busy, setBusy] = useState<string | undefined>();

  if (fixes.length === 0) {
    return (
      <section aria-label="Suggestions" className="mt-8">
        <SectionHeading>Suggestions</SectionHeading>
        <Card className="p-5">
          <p className="text-[15px] font-semibold">Nothing to fix</p>
          <p className="mt-1 text-[14px] leading-snug text-muted">
            Every muscle your week should cover gets its sets, and no pair is lopsided.
          </p>
        </Card>
      </section>
    );
  }

  const apply = async (f: BalanceFix) => {
    setBusy(f.id);
    try {
      const undo = await applyFix(f);
      toast(f.kind === 'add' ? `Added to ${f.routine_name}` : `Swapped in ${f.routine_name}`, {
        label: 'Undo',
        run: () => void undo(),
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That could not be applied.');
    } finally {
      setBusy(undefined);
    }
  };

  const setsOf = (f: BalanceFix) => deficitSets(report, f.for);

  return (
    <section aria-label="Suggestions" className="mt-8">
      <SectionHeading trailing={fixes.length}>Suggestions</SectionHeading>
      <Card className="divide-y divide-line">
        {fixes.map((f) => {
          const d = describeFix(f);
          return (
            <div key={f.id} className="flex items-start gap-3 px-4 py-4" data-fix={f.id}>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-muted">{describeDeficit(f.for, setsOf(f))}</p>
                <p className="mt-1 text-[15px] leading-snug font-semibold">
                  {d.title} <span className="font-normal text-muted">{d.where}</span>
                </p>
                <p className="mt-1 text-[13px] font-medium text-accent tabular">{d.effect}</p>
                {d.cost && <p className="text-[13px] text-muted tabular">{d.cost}</p>}
              </div>
              <Button
                size="sm"
                className="mt-1 shrink-0 px-4"
                disabled={busy != null}
                aria-label={`Apply: ${d.title} ${d.where}`}
                onClick={() => void apply(f)}
              >
                Apply
              </Button>
            </div>
          );
        })}
      </Card>
    </section>
  );
}

function Pairs({ pairs }: { pairs: readonly PairReport[] }) {
  const shown = pairs.filter((p) => p.verdict !== 'none');
  if (shown.length === 0) return null;
  return (
    <section aria-label="Pairs" className="mt-8">
      <SectionHeading>Pairs</SectionHeading>
      <Card className="divide-y divide-line">
        {shown.map((p) => {
          const total = p.a.sets + p.b.sets;
          const share = total > 0 ? (p.a.sets / total) * 100 : 50;
          const short = p.short === 'a' ? p.a.label : p.short === 'b' ? p.b.label : undefined;
          return (
            <div key={p.id} className="px-4 py-3.5" data-pair={p.id} data-verdict={p.verdict}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-semibold">{p.label}</span>
                <span className={`text-[13px] ${short ? 'font-medium text-ink-2' : 'text-muted'}`}>
                  {short ? `${short} behind` : 'Balanced'}
                </span>
              </div>
              <div className="mt-2.5 flex items-center gap-2 text-[12px] text-muted tabular">
                <span className="w-9 text-right">{formatSets(p.a.sets)}</span>
                <div className="flex h-2 flex-1 gap-[3px] overflow-hidden" aria-hidden>
                  <span
                    className={`h-full rounded-full ${p.short === 'a' ? 'bg-surface-3' : 'bg-accent'}`}
                    style={{ width: `${share}%` }}
                  />
                  <span
                    className={`h-full flex-1 rounded-full ${p.short === 'b' ? 'bg-surface-3' : 'bg-accent/55'}`}
                  />
                </div>
                <span className="w-9">{formatSets(p.b.sets)}</span>
              </div>
              <div className="mt-1 flex justify-between px-11 text-[12px] text-muted">
                <span>{p.a.label}</span>
                <span>{p.b.label}</span>
              </div>
            </div>
          );
        })}
      </Card>
    </section>
  );
}

/** The bar's scale: a little past the band, so "over" has somewhere to go. */
const BAR_MAX = MAX_SETS + 5;

const STATUS_WORDS: Record<MusclePlan['status'], string> = {
  untrained: 'Not trained',
  under: `Under ${MIN_SETS}`,
  'in range': 'In range',
  over: `Over ${MAX_SETS}`,
};

function Muscles({
  report,
  selected,
  onSelect,
}: {
  report: BalanceReport;
  selected: Muscle | undefined;
  onSelect: (m: Muscle) => void;
}) {
  const targets = report.muscles.filter((m) => m.target);
  const others = report.muscles.filter((m) => !m.target && (m.sets > 0 || m.muscle !== 'neck'));
  return (
    <>
      <section aria-label="Every muscle" className="mt-8">
        <SectionHeading trailing="sets a week">Every muscle</SectionHeading>
        <Card className="divide-y divide-line">
          {targets.map((m) => (
            <MuscleRow key={m.muscle} m={m} on={selected === m.muscle} onSelect={onSelect} />
          ))}
        </Card>
      </section>
      <section aria-label="Also counted" className="mt-6">
        <SectionHeading>Also counted</SectionHeading>
        <p className="-mt-1 mb-3 px-1 text-[13px] leading-snug text-muted">
          Usually trained by the big lifts, so shown but never chased.
        </p>
        <Card className="divide-y divide-line">
          {others.map((m) => (
            <MuscleRow key={m.muscle} m={m} on={selected === m.muscle} onSelect={onSelect} />
          ))}
        </Card>
      </section>
    </>
  );
}

function MuscleRow({
  m,
  on,
  onSelect,
}: {
  m: MusclePlan;
  on: boolean;
  onSelect: (m: Muscle) => void;
}) {
  const width = Math.min(100, (m.sets / BAR_MAX) * 100);
  const once = m.target && m.status === 'in range' && m.frequency > 0 && m.frequency < 2;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onSelect(m.muscle)}
      className={`flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left transition-colors ${on ? 'bg-surface-2' : 'active:bg-surface-2'}`}
      data-muscle={m.muscle}
      data-status={m.status}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[15px] font-semibold">{MUSCLE_LABEL[m.muscle]}</span>
          <span className="text-[12px] text-muted">
            {m.target ? (once ? 'All on one day' : STATUS_WORDS[m.status]) : ''}
          </span>
        </div>
        <div className="relative mt-2 h-1.5 rounded-full bg-surface-3" aria-hidden>
          {m.target && (
            <span
              className="absolute inset-y-0 rounded-full bg-ink/10"
              style={{
                left: `${(MIN_SETS / BAR_MAX) * 100}%`,
                width: `${((MAX_SETS - MIN_SETS) / BAR_MAX) * 100}%`,
              }}
            />
          )}
          <span
            className={`absolute inset-y-0 left-0 rounded-full ${m.sets >= MIN_SETS || !m.target ? 'bg-accent' : 'bg-accent/60'}`}
            style={{ width: `${width}%` }}
          />
        </div>
      </div>
      <span className="w-10 text-right text-[16px] font-bold tabular">{formatSets(m.sets)}</span>
    </button>
  );
}
