import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';

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
    <section className={`rounded border border-slate-200 bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * A number with somewhere to go.
 *
 * Every queue depth on the overview is a link, without exception. A dashboard
 * that reports "14 verifications pending" and then makes ops navigate to find
 * them has told them about a problem and left them to it.
 */
export function StatTile({
  label,
  value,
  to,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: string | number;
  to?: string;
  tone?: 'neutral' | 'warn' | 'alert';
  hint?: string;
}) {
  const tones = {
    neutral: 'border-slate-200',
    warn: 'border-amber-300 bg-amber-50',
    alert: 'border-red-300 bg-red-50',
  } as const;

  const body = (
    <>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
    </>
  );

  const shell = `block rounded border bg-white px-4 py-3 ${tones[tone]}`;

  if (!to) return <div className={shell}>{body}</div>;

  return (
    <Link to={to} className={`${shell} transition-colors hover:border-slate-400 hover:bg-slate-50`}>
      {body}
    </Link>
  );
}

/** A label/value pair. The provider and booking pages are mostly these. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-slate-100 py-1.5 text-sm last:border-b-0">
      <dt className="w-44 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-slate-900">{children}</dd>
    </div>
  );
}
