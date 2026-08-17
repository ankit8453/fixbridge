import { type ReactNode } from 'react';
import Link from 'next/link';

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
    <section className={`rounded-xl border border-slate-200 bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * A number with somewhere to go, e.g. a homepage trust stat or a wallet
 * balance tile. `href` is optional — not every stat links anywhere yet, and a
 * tile that never navigates should not look clickable.
 */
export function StatTile({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: string | number;
  href?: string;
  hint?: string;
}) {
  const body = (
    <>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
    </>
  );

  const shell = 'block rounded-xl border border-slate-200 bg-white px-4 py-3';

  if (!href) return <div className={shell}>{body}</div>;

  return (
    <Link href={href} className={`${shell} min-h-touch transition-colors active:bg-slate-50`}>
      {body}
    </Link>
  );
}

/** A label/value pair for a detail screen (a booking, a provider profile, ...). */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2 text-sm last:border-b-0 sm:flex-row sm:gap-3">
      <dt className="text-slate-500 sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-slate-900">{children}</dd>
    </div>
  );
}
