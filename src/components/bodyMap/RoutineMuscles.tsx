// SPEC §20.18 — what one routine trains, drawn: for a routine's own screen.
//
// The same figure as the balance screen, filled by this routine alone as if done once. It
// answers "what is this day for" before the first set, which a list of exercise names only
// answers to someone who already knows every movement.
import { MUSCLE_LABEL } from '@/core/muscles';
import { useRoutineBalance } from '@/hooks/useBalance';
import { BodyMap } from './BodyMap';

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

export function RoutineMuscles({
  routineId,
  className = '',
}: {
  routineId: string;
  className?: string;
}) {
  const report = useRoutineBalance(routineId);
  if (!report) return null;
  const main = report.muscles
    .filter((m) => m.direct_sets > 0)
    .sort((a, b) => b.direct_sets - a.direct_sets)
    .map((m) => MUSCLE_LABEL[m.muscle].toLowerCase());
  if (main.length === 0) return null;
  return (
    <section
      aria-label="Muscles this routine trains"
      className={`flex items-center gap-4 ${className}`}
    >
      <BodyMap report={report} compact scale="session" className="w-[112px] shrink-0" />
      <p className="min-w-0 flex-1 text-[14px] leading-snug text-muted">
        Mostly {LIST.format(main.slice(0, 3))}.
      </p>
    </section>
  );
}
