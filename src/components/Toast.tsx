// One toast at a time, above the tab bar, with an optional action (Undo). Module-level
// store so any screen can call toast() without wiring.
import { useEffect, useState } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
  action?: { label: string; run: () => void | Promise<void> } | undefined;
}

type Listener = (t: ToastMessage | null) => void;
let listener: Listener | null = null;
let seq = 0;
let timer: number | undefined;

export function toast(text: string, action?: ToastMessage['action'], ms = 5000): void {
  const t: ToastMessage = { id: ++seq, text, action };
  listener?.(t);
  window.clearTimeout(timer);
  timer = window.setTimeout(() => listener?.(null), ms);
}

export function ToastHost({ liftedBy = 0 }: { liftedBy?: number }) {
  const [t, setT] = useState<ToastMessage | null>(null);
  useEffect(() => {
    listener = setT;
    return () => {
      listener = null;
    };
  }, []);
  if (!t) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 pb-3 safe-bottom"
      // Stacks on whatever already owns the bottom edge — the tab bar, and the running-workout
      // bar above it. It used to assume a tab bar that half the screens in the app hide.
      style={{ bottom: liftedBy }}
    >
      <div
        key={t.id}
        role="status"
        className="sheet-in pointer-events-auto flex items-center gap-3 rounded-full bg-primary py-2.5 pr-2.5 pl-5 text-[14px] font-medium text-on-primary shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
      >
        <span>{t.text}</span>
        {t.action && (
          <button
            type="button"
            onClick={() => {
              void t.action!.run();
              setT(null);
              window.clearTimeout(timer);
            }}
            className="rounded-full bg-on-primary/15 px-3 py-1 text-[13px] font-semibold"
          >
            {t.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
