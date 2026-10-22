// SPEC §20.18 — the balance, small, for Train: the figure, one line, and the way in.
//
// A card that links rather than a card that explains. Its one sentence is the most useful
// thing the full screen would say — what is untrained, or that nothing is — and everything else
// is a tap away.
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Card } from '@/components/ui';
import { deficitLabel } from '@/core/balance';
import { useBalance } from '@/hooks/useBalance';
import { BodyMap } from './BodyMap';

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

/** The one thing the full screen would say first, in a sentence. */
export function balanceLine(b: NonNullable<ReturnType<typeof useBalance>>): string {
  const untrained = b.report.muscles.filter((m) => m.target && m.status === 'untrained');
  if (untrained.length > 0) {
    const names = LIST.format(untrained.map((m) => deficitLabel(m).toLowerCase()));
    return `Nothing trains your ${names}.`;
  }
  const lopsided = b.fixes.find((f) => f.for.reason !== 'under');
  if (lopsided) {
    return `Short on ${deficitLabel(lopsided.for).toLowerCase()}. ${fixCount(b.fixes.length)}`;
  }
  if (b.fixes.length > 0) return `Everything is trained. ${fixCount(b.fixes.length)}`;
  return 'Every muscle your week should cover gets its sets.';
}

const fixCount = (n: number) => (n === 1 ? 'One suggestion.' : `${n} suggestions.`);

export function BalanceCard({ className = '' }: { className?: string }) {
  const b = useBalance();
  const navigate = useNavigate();
  if (!b || b.report.routines === 0) return null;
  return (
    <section aria-label="Muscle balance" className={className}>
      <Card className="flex items-center gap-4 p-4" onClick={() => navigate('/train/balance')}>
        <BodyMap report={b.report} compact className="w-[112px] shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">Muscle balance</p>
          <p className="mt-1 text-[14px] leading-snug text-muted">{balanceLine(b)}</p>
        </div>
        <ChevronRight size={20} className="shrink-0 text-muted" aria-hidden />
      </Card>
    </section>
  );
}
