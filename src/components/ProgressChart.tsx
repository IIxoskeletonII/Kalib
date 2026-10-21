import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { fromDateKey } from '@/core/dates';
import type { ProgressPoint } from '@/core/strength';

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const HEIGHT = 180;

/**
 * One exercise's line (SPEC §20.11): every session as a dot, records filled in the accent.
 * `display` converts a stored value into what the axis prints — kilograms to pounds, say — and
 * `label` is the whole sentence a screen reader gets in place of the canvas.
 */
export function ProgressChart({
  points,
  display,
  label,
}: {
  points: readonly ProgressPoint[];
  display: (v: number) => number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const xs = points.map((p) => fromDateKey(p.date).getTime() / 1000);
    const ys = points.map((p) => display(p.value));
    const records = points.map((p, i) => (p.record ? ys[i]! : null));
    const data: uPlot.AlignedData = [xs, ys, records];

    const build = () => {
      const accent = token('--accent');
      const muted = token('--muted');
      const line = token('--line');
      const surface = token('--surface');
      const font = `12px ${token('--font-sans') || 'system-ui'}`;
      plot.current?.destroy();
      plot.current = new uPlot(
        {
          width: el.clientWidth,
          height: HEIGHT,
          padding: [16, 12, 0, 0],
          cursor: { show: false },
          legend: { show: false },
          // Whole numbers on the axis: the line is an estimate, and so are its ticks.
          scales: {
            x: { time: true },
            y: { range: (_u, lo, hi) => [Math.floor(lo - 1), Math.ceil(hi + 1)] },
          },
          axes: [
            {
              stroke: muted,
              grid: { stroke: line, width: 1 },
              ticks: { show: false },
              font,
              values: (_u, splits) =>
                splits.map((s) =>
                  new Date(s * 1000).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  }),
                ),
            },
            {
              stroke: muted,
              grid: { stroke: line, width: 1 },
              ticks: { show: false },
              font,
              size: 40,
              values: (_u, splits) => splits.map((s) => (Number.isInteger(s) ? String(s) : '')),
            },
          ],
          series: [
            {},
            {
              stroke: muted,
              width: 1.5,
              points: { show: true, size: 6, fill: surface, stroke: muted, width: 1.5 },
            },
            {
              stroke: 'transparent',
              points: { show: true, size: 9, fill: accent, stroke: accent },
            },
          ],
        },
        data,
        el,
      );
    };
    build();
    const ro = new ResizeObserver(() => {
      if (plot.current && el.clientWidth !== plot.current.width) {
        plot.current.setSize({ width: el.clientWidth, height: HEIGHT });
      }
    });
    ro.observe(el);
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', build);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', build);
      plot.current?.destroy();
      plot.current = null;
    };
  }, [points, display]);

  return <div ref={ref} role="img" aria-label={label} className="w-full" />;
}
