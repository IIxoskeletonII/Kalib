// SPEC §8: numbers are entered on a custom pad, never the OS keyboard. Summoning/dismissing
// the iOS keyboard alone costs 1–2 s per entry.
import { Delete } from 'lucide-react';
import { useCallback, useEffect } from 'react';

export interface NumberPadProps {
  /** Functional update, so presses batched into one render still compose correctly. */
  onChange: (update: (prev: string) => string) => void;
  onSubmit?: () => void;
  /** Allow one decimal separator. */
  decimal?: boolean;
  /** Max digits (excluding the separator). */
  maxDigits?: number;
  disabled?: boolean;
}

export function appendDigit(
  value: string,
  key: string,
  decimal: boolean,
  maxDigits: number,
): string {
  if (key === 'backspace') return value.slice(0, -1);
  if (key === '.') {
    if (!decimal || value.includes('.')) return value;
    return value === '' ? '0.' : value + '.';
  }
  const digits = value.replace('.', '').length;
  if (digits >= maxDigits) return value;
  if (value === '0') return key; // no leading zeros
  return value + key;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace'] as const;

export function NumberPad({
  onChange,
  onSubmit,
  decimal = false,
  maxDigits = 5,
  disabled = false,
}: NumberPadProps) {
  const press = useCallback(
    (k: string) => {
      if (disabled) return;
      onChange((prev) => appendDigit(prev, k, decimal, maxDigits));
    },
    [onChange, decimal, maxDigits, disabled],
  );

  // Hardware keyboards (desktop dev) still work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === '.' || e.key === ',') press('.');
      else if (e.key === 'Backspace') press('backspace');
      else if (e.key === 'Enter') onSubmit?.();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, onSubmit]);

  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Number pad">
      {KEYS.map((k) => {
        const isDot = k === '.';
        const isBack = k === 'backspace';
        const hidden = isDot && !decimal;
        return (
          <button
            key={k}
            type="button"
            disabled={disabled || hidden}
            aria-label={isBack ? 'Delete' : k}
            onClick={() => press(k)}
            className={[
              'flex h-15 items-center justify-center rounded-xl text-[26px] font-medium tabular transition-[transform,background-color] duration-100 active:scale-95 active:bg-surface-3',
              hidden ? 'invisible' : '',
              isBack ? 'bg-surface-2 text-ink-2' : 'bg-surface-2 text-ink',
              disabled ? 'opacity-40' : '',
            ].join(' ')}
          >
            {isBack ? <Delete size={24} strokeWidth={2} aria-hidden /> : k}
          </button>
        );
      })}
    </div>
  );
}
