import { Link } from 'react-router-dom';

/**
 * A queue-depth number with a severity tint — ported from
 * `legacy-next-src/components/admin/ui/StatTile.tsx`.
 *
 * `@/components/ui`'s `StatTile` (the shared one) has no `tone`: it is
 * correct for that component to stay generic, because every other surface's
 * stat tiles are just numbers. The overview and wallet screens here are
 * different — a queue depth's colour is a judgement about consequence, not
 * size (a parked webhook is money the ledger has not heard about, so one is
 * already red; a pending verification is amber until it is a pile), and
 * that judgement is specific enough to this surface's domain that it
 * belongs here rather than as a fourth prop bolted onto the shared
 * component for one caller.
 */
type Tone = 'neutral' | 'warn' | 'alert';

const TONES: Record<Tone, string> = {
  neutral: 'border-border bg-surface',
  warn: 'border-amber-300 bg-amber-50',
  alert: 'border-red-300 bg-red-50',
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
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </>
  );

  const shell = `block rounded-xl border px-4 py-3 shadow-card ${TONES[tone]}`;

  if (!href) return <div className={shell}>{body}</div>;

  return (
    <Link
      to={href}
      className={`${shell} min-h-touch transition-colors duration-150 active:bg-slate-50`}
    >
      {body}
    </Link>
  );
}
