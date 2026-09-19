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
  compact = false,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  color: MacroColor;
  compact?: boolean;
}) {
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const over = target > 0 && value > target;
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`${compact ? 'text-[13px]' : 'text-[14px]'} text-ink-2`}>{label}</span>
        <span className={`tabular ${compact ? 'text-[14px]' : 'text-[15px]'} font-medium`}>
          {fmt(value)}
          <span className="font-normal text-muted">
            {' of '}
            {fmt(target)}
            {' '}
            {unit}
          </span>
        </span>
      </div>
      <div
        className={`${compact ? 'h-1.5' : 'h-2'} w-full overflow-hidden rounded-full bg-surface-2`}
      >
        <div
          className={`h-full rounded-full ${FILL[color]} transition-[width] duration-500 ease-out`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      {over && !compact && (
        <div className="text-[12px] text-muted tabular">
          +{fmt(value - target)}
          {unit} over
        </div>
      )}
    </div>
  );
}
