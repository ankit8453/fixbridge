import { type ReactNode, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { TrendingDown, TrendingUp, type LucideProps } from 'lucide-react';

/**
 * `rounded-xl` + a hairline `border-slate-200` + a barely-there shadow — the
 * brief's "no heavy borders, no 3D bevels, no gradient soup" in one class
 * string, reused by every card-shaped thing in the kit.
 */
const CARD_SHELL = 'rounded-xl border border-border bg-surface shadow-card';

export function Card({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${CARD_SHELL} ${className}`}>
      {title || actions ? <CardHeader title={title} actions={actions} /> : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * Split out of `Card` so a caller that needs the header's exact layout
 * (e.g. a page's own top-level heading row, not nested in a bordered box)
 * can reuse it without dragging the card shell along.
 */
export function CardHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold text-slate-800">{title}</h2>
        {subtitle ? <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A number with somewhere to go, e.g. a homepage trust stat or a wallet
 * balance tile. `href` is optional — not every stat links anywhere, and a
 * tile that never navigates should not look clickable. `delta` reads as a
 * signed change (`+12%`, `-3 jobs`) and colours itself off its own sign
 * rather than a caller-supplied tone, so a page can't accidentally paint a
 * decline green.
 */
export function StatTile({
  label,
  value,
  href,
  hint,
  delta,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  href?: string;
  hint?: string;
  /** A signed number (12 -> "+12", -3 -> "-3") or a pre-formatted string ("+3 jobs"). */
  delta?: number | string;
  icon?: ComponentType<LucideProps>;
}) {
  // Literal class names, not `text-${tone}` — Tailwind's content scanner
  // greps the raw file text for whole class names, so a template-built one
  // never makes it into the generated CSS. A lookup table keeps every
  // candidate string physically present in this file.
  const DELTA_TONE_CLASS = {
    success: 'text-success',
    danger: 'text-danger',
    muted: 'text-muted',
  } as const;
  const deltaTone: keyof typeof DELTA_TONE_CLASS =
    typeof delta === 'number' ? (delta > 0 ? 'success' : delta < 0 ? 'danger' : 'muted') : 'muted';
  const deltaText = typeof delta === 'number' ? (delta > 0 ? `+${delta}` : String(delta)) : delta;
  const DeltaIcon =
    typeof delta === 'number' && delta !== 0 ? (delta > 0 ? TrendingUp : TrendingDown) : null;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
        {Icon ? (
          <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" strokeWidth={1.75} />
        ) : null}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      <div className="mt-1 flex items-center gap-2">
        {deltaText ? (
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-medium ${DELTA_TONE_CLASS[deltaTone]}`}
          >
            {DeltaIcon ? <DeltaIcon className="h-3 w-3" aria-hidden="true" /> : null}
            {deltaText}
          </span>
        ) : null}
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
    </>
  );

  if (!href) return <div className={`${CARD_SHELL} px-4 py-3`}>{body}</div>;

  return (
    <Link
      to={href}
      className={`${CARD_SHELL} min-h-touch block px-4 py-3 transition-colors duration-150 active:bg-slate-50`}
    >
      {body}
    </Link>
  );
}

/** A label/value pair for a detail screen (a booking, a provider profile, ...). */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2 text-sm last:border-b-0 sm:flex-row sm:gap-3">
      <dt className="text-muted sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-slate-900">{children}</dd>
    </div>
  );
}
