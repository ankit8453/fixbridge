import { type ReactNode } from 'react';

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  good: 'bg-green-50 text-green-800 ring-green-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  bad: 'bg-red-50 text-red-800 ring-red-200',
  info: 'bg-blue-50 text-blue-800 ring-blue-200',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Booking and case statuses coloured by what they mean to ops, not alphabetically.
 *
 * Anything red is somebody stuck or somebody unhappy. That mapping is the whole
 * value of colour on a queue screen — an unrecognised status stays grey rather
 * than being guessed at, because a wrong colour here is worse than none.
 */
export function StatusBadge({ status }: { status: string }) {
  const tone: Tone = /failed|cancelled|suspended|blocked|severe|open|expired|parked/i.test(status)
    ? 'bad'
    : /passed|paid|captured|resolved|completed|settled|active|published/i.test(status)
      ? 'good'
      : /pending|submitted|in_review|needs_info|queued|draft|held|processing/i.test(status)
        ? 'warn'
        : 'neutral';

  return <Badge tone={tone}>{status}</Badge>;
}

export function BadgeLevel({ badge }: { badge: string | null | undefined }) {
  if (!badge || badge === 'NONE') return <Badge tone="neutral">NONE</Badge>;
  if (badge === 'GOLD') return <Badge tone="warn">GOLD</Badge>;
  if (badge === 'SILVER') return <Badge tone="info">SILVER</Badge>;
  return <Badge tone="good">{badge}</Badge>;
}
