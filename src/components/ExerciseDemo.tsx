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

/**
 * The still, for lists.
 *
 * A list of thirty results showing thirty 47 KB animations would pull over a megabyte before
 * you had chosen anything, which on a roaming connection is a real cost for a thumbnail. The
 * poster is one frame at a few kilobytes, so every row can carry one; the animation still loads
 * only when an exercise is actually opened.
 */
export function ExerciseThumb({
  media,
  name,
  className = '',
}: {
  media: string | undefined;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const base = `h-11 w-11 shrink-0 overflow-hidden rounded-xl ${className}`;

  if (!media || failed) {
    return (
      <span className={`${base} flex items-center justify-center bg-surface-2 text-muted`}>
        <Dumbbell size={18} strokeWidth={1.6} aria-hidden />
      </span>
    );
  }
  return (
    <img
      src={`/exercises/posters/${media}.webp`}
      // The name is already the row's own text, so repeating it here would make a screen reader
      // say every exercise twice. The picture adds nothing a reader needs.
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`${base} bg-surface object-contain`}
      data-exercise-thumb={name}
    />
  );
}

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
    // Said, not just shown: an empty square reads as broken. A few mainstream exercises Kalib
    // added itself have no demonstration yet (§20.19); a clip that failed to load is usually a
    // phone offline before the exercise was ever opened.
    return (
      <div
        role="img"
        aria-label={`${name}: ${media ? 'demonstration unavailable' : 'no demonstration yet'}`}
        className={`flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-[20px] bg-surface-2 px-6 text-center text-muted ${className}`}
        data-exercise-demo="none"
      >
        <Dumbbell size={32} strokeWidth={1.6} aria-hidden />
        <span className="text-[13px] leading-snug">
          {media ? 'Can’t load the demonstration right now' : 'No demonstration for this one yet'}
        </span>
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
