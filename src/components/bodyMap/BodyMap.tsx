// SPEC §20.18 — the body, filled by what the routines train.
//
// A picture, not a control. Every figure on it is also in the list beside it, which is where it
// can be read and tapped: a forearm on a 170-pixel figure is not a target anyone can hit, and a
// screen reader gets the same facts in a sentence rather than a hundred unnamed shapes.
//
// One colour, in steps. The worked muscle is `accent`, as in the exercise art (MASTER.md), mixed
// toward the untrained grey rather than faded toward the background, so a lightly trained
// muscle reads as "some colour" and an untrained one as "none" — two different things, not two
// shades of the same dimness. Over the band is drawn as full, not louder: more colour would read
// as better, and it is not.
import {
  fillLevel,
  REGION_MUSCLE,
  regionSets,
  type BalanceReport,
  type FillLevel,
  type FillScale,
  type MappedRegion,
} from '@/core/balance';
import { MUSCLE_LABEL } from '@/core/muscles';
import type { Muscle } from '@/core/types';
import { BACK_PARTS, FRONT_PARTS, type AnatomyPart, type AnatomySlug } from './anatomy';

type Side = 'front' | 'back';
type Report = Pick<BalanceReport, 'muscles' | 'delts'>;

/**
 * The source's views are 724 × 1448 and the figure fills x 53–675, y 96–1340 of them (measured
 * with getBBox). Cropped to that with a 12-unit margin, so the figure is as large as its column
 * allows instead of floating in a tenth of empty page above the head and below the feet.
 */
export const VIEWBOX: Record<Side, string> = {
  front: '41 84 646 1269',
  back: '761 84 646 1269',
};

/**
 * How much of the accent each level carries, mixed into the untrained grey. Spread wider than
 * even steps: on the dark theme the grey is dark enough that 38 % and 68 % read as one colour.
 */
const MIX: Record<FillLevel, number> = { 0: 0, 1: 30, 2: 62, 3: 100 };

export function levelFill(level: FillLevel): string {
  if (level === 0) return 'var(--surface-3)';
  if (level === 3) return 'var(--accent)';
  return `color-mix(in srgb, var(--accent) ${MIX[level]}%, var(--surface-3))`;
}

const isMapped = (slug: AnatomySlug): slug is MappedRegion => slug in REGION_MUSCLE;

function Figure({
  side,
  report,
  selected,
  scale,
}: {
  side: Side;
  report: Report;
  selected?: Muscle | undefined;
  scale: FillScale;
}) {
  const parts: readonly AnatomyPart[] = side === 'front' ? FRONT_PARTS : BACK_PARTS;
  return (
    <svg
      viewBox={VIEWBOX[side]}
      className="block h-auto w-full"
      aria-hidden
      focusable="false"
      data-side={side}
    >
      {parts.map((p) => {
        if (!isMapped(p.slug)) {
          // Head, hands, knees, feet: the figure, not a muscle anyone trains.
          return (
            <g key={p.slug} fill="var(--surface-2)">
              {p.paths.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
          );
        }
        const muscle = REGION_MUSCLE[p.slug];
        const level = fillLevel(regionSets(report, p.slug, side), scale);
        const on = selected === muscle;
        return (
          <g
            key={p.slug}
            data-region={p.slug}
            data-muscle={muscle}
            data-level={level}
            fill={levelFill(level)}
            stroke={on ? 'var(--ink)' : undefined}
            strokeWidth={on ? 2.5 : undefined}
            strokeLinejoin="round"
            className="transition-[fill] duration-300"
          >
            {p.paths.map((d, i) => (
              <path key={i} d={d} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The sentence a screen reader gets in place of the picture. A week names what it misses; a
 * single session does not, since one day of a split is meant to leave most muscles alone.
 */
export function describeMap(report: Report, scale: FillScale = 'week'): string {
  const level = (sets: number) => fillLevel(sets, scale);
  const muscles = report.muscles.filter((m) => m.muscle !== 'neck' || m.sets > 0);
  const label = (m: (typeof muscles)[number]) => MUSCLE_LABEL[m.muscle];
  const trained = muscles.filter((m) => level(m.sets) === 3).map(label);
  const some = muscles.filter((m) => level(m.sets) === 1 || level(m.sets) === 2).map(label);
  const none = muscles.filter((m) => m.sets <= 0 && m.target).map(label);
  const parts = ['Muscle map.'];
  if (scale === 'week') {
    if (trained.length) parts.push(`Ten or more sets a week: ${trained.join(', ')}.`);
    if (some.length) parts.push(`Some work: ${some.join(', ')}.`);
    if (none.length) parts.push(`Not trained: ${none.join(', ')}.`);
  } else {
    if (trained.length) parts.push(`Mostly: ${trained.join(', ')}.`);
    if (some.length) parts.push(`Also: ${some.join(', ')}.`);
  }
  return parts.join(' ');
}

export function BodyMap({
  report,
  selected,
  compact = false,
  scale = 'week',
  className = '',
}: {
  report: Report;
  selected?: Muscle | undefined;
  /** Small, captionless and legend-less: for a card that links to the full map. */
  compact?: boolean;
  /** A week against the band, or one session on its own (core/balance.ts `FillScale`). */
  scale?: FillScale;
  className?: string;
}) {
  return (
    <div className={className}>
      <div
        role="img"
        aria-label={describeMap(report, scale)}
        className={`mx-auto grid grid-cols-2 ${compact ? 'max-w-[150px] gap-2' : 'max-w-[340px] gap-5'}`}
      >
        {(['front', 'back'] as const).map((side) => (
          <figure key={side} className="m-0">
            <Figure side={side} report={report} selected={selected} scale={scale} />
            {!compact && (
              <figcaption className="mt-2 text-center text-[13px] font-medium text-muted">
                {side === 'front' ? 'Front' : 'Back'}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
      {!compact && <Legend />}
    </div>
  );
}

const LEGEND: { level: FillLevel; label: string }[] = [
  { level: 0, label: 'None' },
  { level: 1, label: '1–4' },
  { level: 2, label: '5–9' },
  { level: 3, label: '10+' },
];

/** What the steps mean, in sets a week. */
export function Legend() {
  return (
    <div className="mt-4 flex items-center justify-center gap-4 text-[12px] text-muted">
      <span className="font-medium">Sets a week</span>
      {LEGEND.map((l) => (
        <span key={l.level} className="inline-flex items-center gap-1.5 tabular">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: levelFill(l.level) }}
          />
          {l.label}
        </span>
      ))}
    </div>
  );
}
