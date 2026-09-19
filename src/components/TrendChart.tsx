import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { fromDateKey } from '@/core/dates';
import type { TrendPoint } from '@/core/trend';

/** Trend line, with raw weigh-ins as dots behind a toggle (SPEC §2.5). */
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

    const build = () => {
      plot.current?.destroy();
      const width = el.clientWidth;
      plot.current = new uPlot(
        {
          width,
          height: 240,
          padding: [12, 8, 0, 0],
          cursor: { show: false },
          legend: { show: false },
          scales: { x: { time: true } },
          axes: [
            {
              stroke: '#94a3b8',
              grid: { stroke: '#273449', width: 1 },
              ticks: { show: false },
              font: '12px system-ui',
              values: (_u, splits) =>
                splits.map((s) =>
                  new Date(s * 1000).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  }),
                ),
            },
            {
              stroke: '#94a3b8',
              grid: { stroke: '#273449', width: 1 },
              ticks: { show: false },
              font: '12px system-ui',
              size: 44,
              values: (_u, splits) => splits.map((s) => s.toFixed(1)),
            },
          ],
          series: [
            {},
            { stroke: '#22d3ee', width: 2.5, spanGaps: true, points: { show: false } },
            {
              show: showRaw,
              stroke: 'transparent',
              points: { show: true, size: 6, fill: '#94a3b8', stroke: 'transparent' },
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
        plot.current.setSize({ width: el.clientWidth, height: 240 });
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [points, showRaw]);

  return <div ref={ref} className="w-full" />;
}
