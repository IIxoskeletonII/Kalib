// SPEC §20.2 — the looping form demonstration.
//
// The clips are rendered in the app's own palette by scripts/render-exercise-media.py: the
// figure in `ink-2` on `surface`, the worked muscle in `accent`. So there is no plate to draw
// and nothing to fight — the clip's own ground is the card it sits in, and the only thing with
// colour in it is the muscle the movement trains.
//
// Nothing is downloaded until an exercise is actually opened; the service worker then keeps it,
// so a routine becomes fully offline after one session with it (§20.3).
import { Dumbbell } from 'lucide-react';
import { useState } from 'react';

export function ExerciseDemo({
  media,
  name,
  className = '',
}: {
  media: string | undefined;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!media || failed) {
    return (
      <div
        className={`flex aspect-square w-full items-center justify-center rounded-[20px] bg-surface-2 text-muted ${className}`}
      >
        <Dumbbell size={32} strokeWidth={1.6} aria-hidden />
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-[20px] bg-surface ${className}`}>
      <img
        src={`/exercises/${media}.webp`}
        alt={`${name}, demonstrated`}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="aspect-square w-full object-contain"
      />
    </div>
  );
}
