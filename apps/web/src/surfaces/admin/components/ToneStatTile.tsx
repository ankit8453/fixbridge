import { Link } from 'react-router-dom';

/**
 * A queue-depth number with a severity tint — ported from
 * `legacy-next-src/components/admin/ui/StatTile.tsx`.
 *
 * Distinct from this surface's own `StatTile` (`components/ui.tsx`), which
 * has a `tone` for its *icon chip* but no severity rail and no link. The
 * overview and wallet screens need both: a queue depth's colour is a
 * judgement about consequence, not size (a parked webhook is money the
 * ledger has not heard about, so one is already red; a pending verification
 * is amber until it is a pile), and the tile is the fastest way into the
 * filtered list that clears it.
 *
 * Visually it is deliberately the same object as `StatTile` — same border,
 * radius, label case and numeric weight — plus a left severity rail. A
 * console shows a row of both at once and they must read as one family.
 */
type Tone = 'neutral' | 'warn' | 'alert';

const RAIL: Record<Tone, string> = {
  neutral: 'before:bg-slate-200',
  warn: 'before:bg-warning',
  alert: 'before:bg-danger',
};

export function ToneStatTile({
  label,
  value,
  href,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: string | number;
  /** An app-absolute path, e.g. `"/admin/providers?suspended=true"`. */
  href?: string;
  tone?: Tone;
  hint?: string;
}) {
  const body = (
    <>
      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1.5 text-[26px] font-semibold leading-none tabular-nums tracking-tight text-slate-900">
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-xs leading-snug text-slate-500">{hint}</p> : null}
    </>
  );

  // The rail is a pseudo-element rather than a `border-l-4` so the tile's
  // content box lines up with a plain `StatTile` standing next to it.
  const shell =
    'relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 pl-[18px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors ' +
    `before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-[''] ${RAIL[tone]}`;

  if (!href) return <div className={shell}>{body}</div>;

  return (
    <Link
      to={href}
      className={`${shell} block min-h-touch hover:border-slate-300 hover:bg-slate-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin`}
    >
      {body}
    </Link>
  );
}
