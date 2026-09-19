import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { fromDateKey } from '@/core/dates';
import type { TrendPoint } from '@/core/trend';

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Trend line, with raw weigh-ins as dots behind a toggle (SPEC §2.5). Colours come from the theme tokens. */
export function TrendChart({ points, showRaw }: { points: TrendPoint[]; showRaw: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const xs = points.map((p) => fromDateKey(p.date).getTime() / 1000);
    const trend = points.map((p) => p.trend);
    const raw = points.map((p) => (p.weighed ? (p.raw ?? null) : null));
    const data: uPlot.AlignedData = [xs, trend, raw];
    const accent = token('--accent');
    const muted = token('--muted');
    const line = token('--line');
    const font = `12px ${token('--font-sans') || 'system-ui'}`;

    const build = () => {
      plot.current?.destroy();
      plot.current = new uPlot(
        {
          width: el.clientWidth,
          height: 220,
          padding: [16, 8, 0, 0],
          cursor: { show: false },
          legend: { show: false },
          scales: { x: { time: true } },
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
              size: 48,
              values: (_u, splits) => splits.map((s) => s.toFixed(1)),
            },
          ],
          series: [
            {},
            {
              stroke: accent,
              width: 2.5,
              spanGaps: true,
              points: { show: false },
              // Soft gradient under the line — reads as "area", not decoration.
              fill: (u) => {
                const g = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
                g.addColorStop(0, `${accent}55`);
                g.addColorStop(1, `${accent}00`);
                return g;
              },
            },
            {
              show: showRaw,
              stroke: 'transparent',
              points: { show: true, size: 6, fill: muted, stroke: 'transparent' },
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
        plot.current.setSize({ width: el.clientWidth, height: 220 });
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
  }, [points, showRaw]);

  return <div ref={ref} className="w-full" />;
}
