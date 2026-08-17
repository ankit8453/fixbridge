import { AdminLink } from '../AdminLink';

/**
 * A number with somewhere to go, with a severity tint — ported from
 * apps/admin/src/components/ui/Card.tsx's `StatTile`.
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
  neutral: 'border-slate-200',
  warn: 'border-amber-300 bg-amber-50',
  alert: 'border-red-300 bg-red-50',
};

export function StatTile({
  label,
  value,
  href,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: string | number;
  /** Relative to the admin root, e.g. `"/providers?suspended=true"` — see AdminLink. */
  href?: string;
  tone?: Tone;
  hint?: string;
}) {
  const body = (
    <>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
    </>
  );

  const shell = `block rounded-xl border bg-white px-4 py-3 ${TONES[tone]}`;

  if (!href) return <div className={shell}>{body}</div>;

  return (
    <AdminLink href={href} className={`${shell} min-h-touch transition-colors active:bg-slate-50`}>
      {body}
    </AdminLink>
  );
}
