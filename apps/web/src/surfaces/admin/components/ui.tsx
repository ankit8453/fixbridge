import type { ComponentType, ReactNode } from 'react';
import type { LucideProps } from 'lucide-react';

/**
 * The ops console's visual vocabulary.
 *
 * Deliberately a different register from `surfaces/partner/components/ui.tsx`:
 * denser, squarer, teal rather than indigo. The partner app is a product
 * somebody chose to work for; this is the tool the people running it stare at
 * all day, and the two should never be confused for one another at a glance.
 *
 * Colour comes from the `admin-*` tokens, never a literal hex — see
 * `adminColors` in `src/brand/tokens.ts`.
 */

/* -------------------------------------------------------------------------- */
/* Page scaffolding                                                           */
/* -------------------------------------------------------------------------- */

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
        {description ? (
          <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-slate-500">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * A white surface with a hairline border. The default container for anything.
 *
 * `padded={false}` for children that manage their own edges — a table, a list
 * whose rows carry their own dividers.
 */
export function Card({
  title,
  description,
  action,
  padded = true,
  children,
  className = '',
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  padded?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const hasHeader = Boolean(title || action);
  return (
    <section
      className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
    >
      {hasHeader ? (
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            {title ? (
              <h3 className="text-[13px] font-semibold tracking-tight text-slate-900">{title}</h3>
            ) : null}
            {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

/** One column on a phone, `cols` from `sm` upward. */
export function Grid({ cols = 4, children }: { cols?: 2 | 3 | 4; children: ReactNode }) {
  const at = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 xl:grid-cols-3',
    4: 'sm:grid-cols-2 xl:grid-cols-4',
  }[cols];
  return <div className={`grid grid-cols-1 gap-3 ${at}`}>{children}</div>;
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                    */
/* -------------------------------------------------------------------------- */

export type Tone = 'neutral' | 'admin' | 'success' | 'warning' | 'danger' | 'info';

const TONE_ICON: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  admin: 'bg-admin-soft text-admin',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-admin-alt/10 text-admin-alt',
};

/**
 * One number, read at a glance across a row of them.
 *
 * Flat tinted chips rather than the partner app's gradients: a console shows
 * eight of these at once, and eight gradients is noise. The number is what the
 * reviewer is here for.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ComponentType<LucideProps>;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </p>
          <p className="mt-1.5 text-[26px] font-semibold leading-none tabular-nums tracking-tight text-slate-900">
            {value}
          </p>
          {hint ? <p className="mt-1.5 text-xs leading-snug text-slate-500">{hint}</p> : null}
        </div>
        {Icon ? (
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE_ICON[tone]}`}
          >
            <Icon className="h-[17px] w-[17px]" aria-hidden="true" strokeWidth={2} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

const TONE_PILL: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  admin: 'bg-admin-soft text-admin ring-admin/20',
  success: 'bg-success/10 text-success ring-success/20',
  warning: 'bg-warning/10 text-warning ring-warning/20',
  danger: 'bg-danger/10 text-danger ring-danger/20',
  info: 'bg-admin-alt/10 text-admin-alt ring-admin-alt/20',
};

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONE_PILL[tone]}`}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty and loading                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What a screen shows when a queue is empty.
 *
 * An empty queue is usually GOOD news in a console — nothing waiting — so this
 * says so rather than rendering blank space a reviewer has to interpret as
 * either "done" or "broken".
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: ComponentType<LucideProps>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {Icon ? (
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
          <Icon className="h-5 w-5 text-slate-400" aria-hidden="true" strokeWidth={1.75} />
        </span>
      ) : null}
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-slate-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Placeholder rows sized like the table they stand in for. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-100" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="h-3 w-1/4 animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
          <div className="ml-auto h-5 w-16 animate-pulse rounded-md bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Key/value                                                                  */
/* -------------------------------------------------------------------------- */

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2.5 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:w-44">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-[13px] text-slate-900">{children}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The console's own button.
 *
 * Separate from the shared `components/ui/Button` because that one is brand
 * indigo, and every primary action in here should read teal — otherwise the
 * surfaces bleed into each other exactly where it matters most, on the buttons
 * that change something.
 */
export function AdminButton({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  disabled,
  onClick,
  children,
  className = '',
}: {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin';

  const sizing = size === 'sm' ? 'min-h-[32px] px-2.5 text-xs' : 'min-h-touch px-3.5 text-[13px]';

  const look = {
    primary: 'bg-admin text-admin-foreground hover:bg-admin-deep',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    danger: 'bg-danger text-danger-foreground hover:opacity-90',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  }[variant];

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${sizing} ${look} ${className}`}
    >
      {children}
    </button>
  );
}
