// Odometer digits: each place is a column of 0–9 that slides to the new digit. Grouping
// separators stay put. Reduced motion collapses to a plain number.
import { useEffect, useRef, useState } from 'react';

export function RollingNumber({ value, className = '' }: { value: number; className?: string }) {
  const text = Math.round(value).toLocaleString();
  // Keep the column count stable across a change so digits slide instead of re-mounting.
  const [width, setWidth] = useState(text.length);
  const prev = useRef(text);
  useEffect(() => {
    if (text.length !== prev.current.length) setWidth(text.length);
    prev.current = text;
  }, [text]);
  const chars = text.padStart(width, ' ').split('');
  return (
    <span className={`inline-flex overflow-hidden tabular ${className}`} aria-label={text}>
      {chars.map((ch, i) =>
        /\d/.test(ch) ? (
          <Digit key={`${chars.length}-${i}`} d={Number(ch)} />
        ) : (
          <span key={`${chars.length}-${i}`} aria-hidden>
            {ch === ' ' ? ' ' : ch}
          </span>
        ),
      )}
    </span>
  );
}

function Digit({ d }: { d: number }) {
  return (
    <span className="relative inline-block h-[1em] w-[0.62em] overflow-hidden" aria-hidden>
      <span
        className="absolute top-0 left-0 flex flex-col items-center leading-none transition-transform duration-700 ease-[var(--ease-out-soft)] motion-reduce:transition-none"
        style={{ transform: `translateY(-${d}em)` }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <span key={n} className="block h-[1em]">
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}
