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
  neutral:
    'border-slate-200/60 border-l-slate-300 hover:border-slate-300/80 bg-white border-l-4 shadow-[0_4px_20px_-4px_rgba(15,23,42,0.03)]',
  warn: 'border-slate-200/60 border-l-amber-500 hover:border-slate-300/80 bg-white border-l-4 shadow-[0_4px_20px_-4px_rgba(245,158,11,0.06)]',
  alert:
    'border-slate-200/60 border-l-red-500 hover:border-slate-300/80 bg-white border-l-4 shadow-[0_4px_20px_-4px_rgba(239,68,68,0.06)]',
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
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tracking-tight text-slate-800 tabular-nums">
        {value}
      </div>
      {hint ? (
        <div className="mt-1.5 text-xs font-medium text-slate-400 leading-normal">{hint}</div>
      ) : null}
    </>
  );

  const shell = `block rounded-2xl border px-5 py-4 transition-all duration-200 ${TONES[tone]}`;

  if (!href) return <div className={shell}>{body}</div>;

  return (
    <Link
      to={href}
      className={`${shell} min-h-touch hover:-translate-y-0.5 hover:shadow-md active:translate-y-0`}
    >
      {body}
    </Link>
  );
}
