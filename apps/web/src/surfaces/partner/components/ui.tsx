import type { ComponentType, ReactNode } from 'react';
import type { LucideProps } from 'lucide-react';

/**
 * The partner surface's visual vocabulary.
 *
 * Every page here used the same three shapes — a heading, a bordered white
 * box, a row of numbers — but each rebuilt them inline with slightly different
 * padding, radius and type scale. The result read as ten pages built by ten
 * people. These are those shapes, once, so a change to how a card looks is one
 * edit rather than ten.
 *
 * Colour comes from the brand tokens (`bg-brand`, `text-success`, …), never a
 * literal hex — see `src/brand/tokens.ts`. A palette retune has to keep
 * working without touching this file.
 */

/* -------------------------------------------------------------------------- */
/* Page scaffolding                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A page title with optional supporting copy and a right-aligned action.
 *
 * `description` is not decoration: several of these screens (trust, earnings,
 * verification) show a number whose meaning is not self-evident, and the
 * explanation belongs next to it rather than in a tooltip a technician on a
 * phone will never open.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900 lg:text-2xl">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** A white surface with a hairline border. The default container for anything. */
export function Panel({
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
  /** Off for panels whose child manages its own edges — a table, a list. */
  padded?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const hasHeader = Boolean(title || action);
  return (
    <section
      className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {hasHeader ? (
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5 lg:px-5">
          <div className="min-w-0">
            {title ? (
              <h3 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h3>
            ) : null}
            {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={padded ? 'p-4 lg:p-5' : ''}>{children}</div>
    </section>
  );
}

/** A responsive grid. One column on a phone, `cols` from `sm` upward. */
export function Grid({ cols = 2, children }: { cols?: 2 | 3 | 4; children: ReactNode }) {
  const at = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
  }[cols];
  return <div className={`grid grid-cols-1 gap-3 lg:gap-4 ${at}`}>{children}</div>;
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                    */
/* -------------------------------------------------------------------------- */

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

/**
 * Icon chips carry a gradient rather than a flat tint.
 *
 * A row of stat tiles is the first thing on most of these screens, and flat
 * pastel squares are what made the old palette read as institutional. A short
 * two-stop gradient with white glyph gives the row some depth at effectively
 * no cost -- and because every stop is a brand token, a rebrand still only
 * touches src/brand/tokens.ts.
 */
const TONE_ICON: Record<Tone, string> = {
  neutral: 'bg-gradient-to-br from-slate-500 to-slate-700 text-white',
  brand: 'bg-gradient-to-br from-brand to-brand-deep text-white',
  success: 'bg-gradient-to-br from-success to-emerald-700 text-white',
  warning: 'bg-gradient-to-br from-warning to-amber-600 text-white',
  danger: 'bg-gradient-to-br from-danger to-rose-700 text-white',
};

/**
 * One headline number.
 *
 * The value is deliberately the largest thing in the tile and the label the
 * smallest — these get read at a glance, mid-job, on a phone in daylight. The
 * icon is decorative and marked `aria-hidden`; a screen reader gets the label
 * and the value, which is the whole content.
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
    <div className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">
            {label}
          </p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
            {value}
          </p>
          {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
        </div>
        {Icon ? (
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ring-inset ring-white/20 ${TONE_ICON[tone]}`}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={2} />
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
  brand: 'bg-brand/10 text-brand ring-brand/20',
  success: 'bg-success/10 text-success ring-success/20',
  warning: 'bg-warning/10 text-warning ring-warning/20',
  danger: 'bg-danger/10 text-danger ring-danger/20',
};

/**
 * A status word.
 *
 * Tinted background plus a matching ring rather than a solid fill: a booking
 * list is mostly pills, and ten saturated blocks compete with the content they
 * are supposed to be annotating.
 */
export function StatusPill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${TONE_PILL[tone]}`}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty and loading                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What a screen shows when there is nothing yet.
 *
 * An empty list used to render as blank space, which is indistinguishable from
 * a failed load. Saying "no jobs yet" is the difference between a working app
 * and a broken one, from the user's side.
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
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
          <Icon className="h-6 w-6 text-slate-400" aria-hidden="true" strokeWidth={1.75} />
        </span>
      ) : null}
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Shimmering placeholders sized like the content they stand in for. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
          <div className="mt-2.5 h-3 w-2/3 animate-pulse rounded bg-slate-100" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Key/value                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A labelled value in a detail view.
 *
 * Stacks on a phone and sits side-by-side from `sm` up, because a two-column
 * row at 360px wraps the value onto its own line anyway — at which point the
 * columns are lying about the layout.
 */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2.5 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500 sm:w-40">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm text-slate-900">{children}</dd>
    </div>
  );
}
