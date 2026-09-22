// UI primitives. Tokens and rules: design-system/kalib/MASTER.md.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary font-semibold',
  accent: 'bg-accent text-on-accent font-semibold',
  secondary: 'bg-surface-2 text-ink active:bg-surface-3',
  ghost: 'bg-transparent text-ink-2 active:bg-surface-2',
  danger: 'bg-transparent text-danger active:bg-surface-2',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'md' | 'lg' | 'sm';
  icon?: LucideIcon;
}) {
  const h =
    size === 'lg' ? 'h-14 text-[17px]' : size === 'sm' ? 'h-10 text-[14px]' : 'h-12 text-[16px]';
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 font-medium transition-[transform,background-color,opacity] duration-200 ease-[var(--ease-out-soft)] active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 ${h} ${VARIANT[variant]} ${className}`}
    >
      {Icon && <Icon size={size === 'sm' ? 16 : 19} strokeWidth={2.2} aria-hidden />}
      {children}
    </button>
  );
}

/** 44 px icon-only control; `label` is required so it is never unnamed. */
export function IconButton({
  icon: Icon,
  label,
  className = '',
  size = 22,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; size?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      {...rest}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 transition-[transform,background-color] duration-200 active:scale-90 active:bg-surface-2 disabled:opacity-30 ${className}`}
    >
      <Icon size={size} strokeWidth={2.2} aria-hidden />
    </button>
  );
}

export function Chip({
  active = false,
  wrap = false,
  icon: Icon,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  wrap?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-[15px] transition-[transform,background-color,color] duration-200 active:scale-95 disabled:opacity-40 ${
        wrap ? 'h-auto min-h-11 flex-col py-2 text-center' : 'h-10 whitespace-nowrap'
      } ${active ? 'bg-primary font-semibold text-on-primary' : 'bg-surface-2 text-ink active:bg-surface-3'} ${className}`}
    >
      {Icon && <Icon size={16} strokeWidth={2.2} aria-hidden />}
      {children}
    </button>
  );
}

/** Exclusive choice among 2–4 options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = '',
}: {
  value: T;
  options: { value: T; label: string; icon?: LucideIcon }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={`flex rounded-full bg-surface-2 p-1 ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-[14px] transition-[background-color,color,transform] duration-200 ${
              active
                ? 'bg-surface font-semibold text-ink shadow-[0_2px_8px_rgba(0,0,0,0.18)]'
                : 'text-muted active:bg-surface-3'
            }`}
          >
            {o.icon && <o.icon size={16} strokeWidth={2.2} aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Elevated surface. Lists and forms live in cards; the page background carries the rest. */
export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`card block w-full text-left transition-transform duration-200 ease-[var(--ease-out-soft)] active:scale-[0.985] ${className}`}
      >
        {children}
      </button>
    );
  }
  return <div className={`card ${className}`}>{children}</div>;
}

/** Section heading: sentence case, sits on the page, optional trailing figure. */
export function SectionHeading({
  children,
  trailing,
  className = '',
}: {
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-3 flex items-baseline justify-between px-1 ${className}`}>
      <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">{children}</h2>
      {trailing && <span className="tabular text-[14px] text-muted">{trailing}</span>}
    </div>
  );
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
  title?: string | undefined;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close"
        className="fade-in absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="sheet-in relative mx-auto max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-surface px-5 pt-2.5 pb-5 shadow-[0_-10px_40px_rgba(0,0,0,0.3)] safe-bottom">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-surface-3" />
        {title && <h2 className="mb-4 text-[22px] font-bold tracking-[-0.01em]">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function ListRow({
  title,
  subtitle,
  value,
  valueSub,
  icon: Icon,
  iconTone = 'muted',
  onClick,
  badge,
  wrapTitle = false,
  chevron = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  valueSub?: ReactNode;
  icon?: LucideIcon;
  iconTone?: 'muted' | 'accent' | 'kcal' | 'protein' | 'fiber' | 'carb' | 'fat';
  onClick?: (() => void) | undefined;
  badge?: ReactNode;
  /** Two-line titles for long database names, where the tail carries meaning (raw vs cooked). */
  wrapTitle?: boolean;
  chevron?: boolean;
}) {
  const tone: Record<NonNullable<typeof iconTone>, string> = {
    muted: 'bg-surface-2 text-ink-2',
    accent: 'bg-accent/15 text-accent',
    kcal: 'bg-kcal/15 text-kcal',
    protein: 'bg-protein/15 text-protein',
    fiber: 'bg-fiber/15 text-fiber',
    carb: 'bg-carb/15 text-carb',
    fat: 'bg-fat/15 text-fat',
  };
  const inner = (
    <>
      {Icon && (
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone[iconTone]}`}
        >
          <Icon size={18} strokeWidth={2.2} aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={`${wrapTitle ? 'line-clamp-2' : 'truncate'} text-[16px] font-medium leading-snug`}
          >
            {title}
          </span>
          {badge}
        </span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-[13px] text-muted tabular">{subtitle}</span>
        )}
      </span>
      {value != null && (
        <span className="shrink-0 text-right">
          <span className="block tabular text-[16px] font-semibold">{value}</span>
          {valueSub && <span className="block text-[12px] text-muted">{valueSub}</span>}
        </span>
      )}
      {chevron && <ChevronGlyph />}
    </>
  );
  const cls = 'flex min-h-16 w-full items-center gap-3.5 px-4 py-3 text-left';
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${cls} transition-colors duration-150 first:rounded-t-[24px] last:rounded-b-[24px] active:bg-surface-2`}
    >
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function ChevronGlyph() {
  return (
    <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden className="shrink-0 text-muted">
      <path
        d="M1 1l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Badge({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'kcal' | 'accent';
}) {
  const t =
    tone === 'kcal'
      ? 'bg-kcal/15 text-kcal'
      : tone === 'accent'
        ? 'bg-accent/15 text-accent'
        : 'bg-surface-2 text-muted';
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-semibold ${t}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-ink-2">
        <Icon size={24} strokeWidth={2} aria-hidden />
      </span>
      <p className="text-[17px] font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-[30ch] text-[14px] leading-snug text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} aria-hidden />;
}

/**
 * For waits long enough to need one (roughly half a second and up). Reduced motion turns the
 * ring static rather than removing it, so the state is still visible.
 */
export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`spinner inline-block shrink-0 rounded-full ${className}`}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 9)) }}
      aria-hidden
    />
  );
}

/**
 * A named step with a determinate bar: for a multi-second job the honest thing is to say what
 * is happening and how far along it is, not to spin indefinitely.
 */
export function StepProgress({
  label,
  done,
  total,
  className = '',
}: {
  label: string;
  done: number;
  total: number;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className={className} role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-[14px] text-ink-2">
        <Spinner size={16} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {total > 1 && (
          <span className="shrink-0 text-[12px] text-muted tabular">
            {done}/{total}
          </span>
        )}
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-[var(--ease-out-soft)]"
          style={{ width: `${Math.max(6, pct)}%` }}
        />
      </div>
    </div>
  );
}

export function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between px-4 py-3">
      <span className="text-ink-2">{label}</span>
      <span className="tabular font-semibold">
        {value}
        {sub && <span className="ml-1 text-[13px] font-normal text-muted">{sub}</span>}
      </span>
    </div>
  );
}

export function fmt(n: number, dp = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp });
}
