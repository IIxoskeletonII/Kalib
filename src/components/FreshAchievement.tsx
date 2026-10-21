// SPEC §20.15 — a milestone, shown once.
//
// Celebration happens once, where the thing happened (MASTER.md): the session summary is that
// place, and Train is the fallback for anything earned elsewhere — on another device, or by a
// streak that closed over a weekend. Someone arriving with a year of history gets one moment,
// the newest, and "Got it" retires everything earned so far, so it never becomes a queue.
import { Trophy } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button, Card } from '@/components/ui';
import { earnedLine } from '@/core/achievements';
import { useMomentum } from '@/hooks/useMomentum';
import { useWeightUnit } from '@/hooks/useWorkouts';
import { markSeen } from '@/services/momentum';

export function FreshAchievement({ className = '' }: { className?: string }) {
  const m = useMomentum();
  const unit = useWeightUnit();
  const navigate = useNavigate();
  const newest = m?.fresh[0];
  if (!m || !newest) return null;

  const ids = m.fresh.map((a) => a.id);
  const more = m.fresh.length - 1;
  return (
    <section className={className} aria-label="New achievement">
      <Card className="p-5">
        <div className="flex items-start gap-3.5">
          <span className="pop flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Trophy size={20} strokeWidth={2.2} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-accent">New achievement</div>
            <div className="mt-0.5 text-[20px] leading-tight font-bold">{newest.title}</div>
            <p className="mt-1 text-[14px] leading-snug text-ink-2">{earnedLine(newest, unit)}</p>
            {more > 0 && <p className="text-[13px] text-muted">Plus {more} more.</p>}
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={() => {
              void markSeen(ids);
              navigate('/train/achievements');
            }}
          >
            See all
          </Button>
          <Button variant="primary" size="sm" className="flex-1" onClick={() => void markSeen(ids)}>
            Got it
          </Button>
        </div>
      </Card>
    </section>
  );
}
