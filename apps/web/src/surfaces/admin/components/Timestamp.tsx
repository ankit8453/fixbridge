import { absoluteTime, relativeTime } from '../lib/time';

/**
 * Relative on the surface, exact on hover. Ported verbatim from
 * `legacy-next-src/components/admin/Timestamp.tsx`.
 *
 * The queue question is "how long has this been waiting"; the dispute
 * question is "at what precise moment". Both are always one mouse-over
 * apart, and the exact value is rendered in IST because that is the
 * timezone every one of these events actually happened in.
 */
export function Timestamp({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted">—</span>;

  return (
    <time dateTime={value} title={absoluteTime(value)} className="whitespace-nowrap">
      {relativeTime(value)}
    </time>
  );
}
