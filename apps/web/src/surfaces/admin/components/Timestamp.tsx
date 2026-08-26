import { absoluteTime, relativeTime } from '../lib/time';

/**
 * Relative on the surface, exact on hover. Ported from
 * `legacy-next-src/components/admin/Timestamp.tsx`.
 *
 * The queue question is "how long has this been waiting"; the dispute
 * question is "at what precise moment". Both are always one mouse-over
 * apart, and the exact value is rendered in IST because that is the
 * timezone every one of these events actually happened in.
 *
 * The dotted underline is the affordance for that second question — without
 * it a reader has no way to know the exact instant is a hover away, and
 * "3h ago" is the only thing they ever see.
 */
export function Timestamp({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-400">—</span>;

  return (
    <time
      dateTime={value}
      title={absoluteTime(value)}
      className="whitespace-nowrap tabular-nums text-slate-600 underline decoration-slate-300 decoration-dotted underline-offset-2"
    >
      {relativeTime(value)}
    </time>
  );
}
