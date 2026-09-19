import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-bg font-semibold',
  secondary: 'bg-surface-2 text-ink',
  ghost: 'bg-transparent text-muted',
  danger: 'bg-transparent text-fat',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...rest}
      className={`h-12 rounded-xl px-4 text-base active:scale-[0.98] transition-transform disabled:opacity-40 ${VARIANT[variant]} ${className}`}
    />
  );
}

export function Chip({
  active = false,
  wrap = false,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; wrap?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center rounded-full px-4 text-sm active:scale-95 transition-transform ${
        wrap ? 'h-auto min-h-10 flex-col py-2 text-center' : 'h-10 whitespace-nowrap'
      } ${active ? 'bg-accent text-bg font-semibold' : 'bg-surface-2 text-ink'} ${className}`}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-surface p-4 ${className}`}>{children}</section>;
}

/** Bottom sheet. Renders nothing when closed; the backdrop closes it. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="relative max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-bg px-4 pt-3 pb-4 safe-bottom">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        {title && <h2 className="mb-3 text-lg font-semibold leading-tight">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-muted">{label}</span>
      <span className="tabular">
        {value}
        {sub && <span className="ml-1 text-sm text-muted">{sub}</span>}
      </span>
    </div>
  );
}

export function fmt(n: number, dp = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp });
}
