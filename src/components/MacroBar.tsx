import { fmt } from './ui';

export type MacroColor = 'kcal' | 'protein' | 'fiber' | 'carb' | 'fat';

const FILL: Record<MacroColor, string> = {
  kcal: 'bg-kcal',
  protein: 'bg-protein',
  fiber: 'bg-fiber',
  carb: 'bg-carb',
  fat: 'bg-fat',
};

export function MacroBar({
  label,
  value,
  target,
  unit,
  color,
  size = 'md',
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  color: MacroColor;
  size?: 'lg' | 'md' | 'sm';
}) {
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const over = target > 0 && value > target;
  const big = size === 'lg';
  return (
    <div className={size === 'sm' ? 'space-y-1' : 'space-y-1.5'}>
      <div className="flex items-baseline justify-between">
        <span className={`${big ? 'text-base' : 'text-sm'} text-muted`}>{label}</span>
        <span
          className={`tabular ${big ? 'text-2xl font-semibold' : size === 'md' ? 'text-base' : 'text-sm'}`}
        >
          {fmt(value)}
          <span className="text-muted">
            {' '}
            / {fmt(target)}
            {unit}
          </span>
        </span>
      </div>
      <div
        className={`${big ? 'h-3' : size === 'md' ? 'h-2' : 'h-1.5'} w-full overflow-hidden rounded-full bg-surface-2`}
      >
        <div
          className={`h-full rounded-full ${FILL[color]} ${over ? 'opacity-60' : ''} transition-[width] duration-300`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
