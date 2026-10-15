// Progressive disclosure: the whole explanation the first time, a line thereafter.
//
// Several things this app does are principled and invisible until they surprise you — a target
// that calls itself provisional, a Monday budget larger than a Tuesday one, grey numbers
// already in the set cells. Each deserves a paragraph, once, where it happens.
//
// Deliberately *not* a tutorial. A tour fires before you have the question, covers the screen
// to point at things, and goes stale as the app moves. This sits in place, in the one spot the
// thing it explains actually appears, and costs nothing once read.
//
// The short form stays tappable forever. Hiding an explanation behind a one-time event with no
// way back is how "I read that once and now I cannot find it" happens.
import { ChevronDown, Info } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { setSetting } from '@/db/repo/settings';
import { useSetting } from '@/hooks/useData';

/** Settings key for one explainer. Synced, so acknowledging it on one phone covers both. */
export const seenKey = (id: string) => `seen:${id}`;

export function Explainer({
  id,
  summary,
  children,
  className = '',
}: {
  /** Stable id; becomes `seen:<id>` in settings. */
  id: string;
  /** The one-liner shown once the long form has been acknowledged. */
  summary: string;
  children: ReactNode;
  className?: string;
}) {
  const seen = useSetting<boolean>(seenKey(id), false);
  const [reopened, setReopened] = useState(false);
  const open = !seen || reopened;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setReopened(true)}
        className={`flex w-full items-start gap-2 text-left text-[13px] leading-snug text-muted active:text-ink-2 ${className}`}
      >
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
        <span className="flex-1">{summary}</span>
        <ChevronDown size={14} className="mt-0.5 shrink-0" aria-hidden />
      </button>
    );
  }

  return (
    <div className={`rise-in space-y-2 text-[13px] leading-snug text-muted ${className}`}>
      {children}
      <button
        type="button"
        onClick={() => {
          if (seen) setReopened(false);
          else void setSetting(seenKey(id), true);
        }}
        className="h-9 rounded-full bg-surface-2 px-4 text-[13px] font-semibold text-ink-2 active:scale-[0.97]"
      >
        {seen ? 'Close' : 'Got it'}
      </button>
    </div>
  );
}
