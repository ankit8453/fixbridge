import { Badge } from '@/components/ui';
import type { TrustBadge } from '../lib/types';

/**
 * Status and badge colouring specific to the admin domain's enums — ported
 * from apps/admin/src/components/ui/Badge.tsx. The shared `Badge` component
 * (`@/components/ui`) deliberately has no such mapping (see its own
 * comment): a tone keyed on an untranslated English enum value belongs next
 * to whichever surface owns that enum, and this surface is the one that
 * renders raw `booking_status` / verification-case-status strings.
 */

/**
 * Booking and case statuses coloured by what they mean to ops, not
 * alphabetically.
 *
 * Anything red is somebody stuck or somebody unhappy. That mapping is the
 * whole value of colour on a queue screen — an unrecognised status stays
 * grey rather than being guessed at, because a wrong colour here is worse
 * than none.
 */
export function StatusBadge({ status }: { status: string }) {
  const tone = /failed|cancelled|suspended|blocked|severe|open|expired|parked/i.test(status)
    ? ('bad' as const)
    : /passed|paid|captured|resolved|completed|settled|active|published/i.test(status)
      ? ('good' as const)
      : /pending|submitted|in_review|needs_info|queued|draft|held|processing/i.test(status)
        ? ('warn' as const)
        : ('neutral' as const);

  return <Badge tone={tone}>{status}</Badge>;
}

export function BadgeLevel({ badge }: { badge: TrustBadge | string | null | undefined }) {
  if (!badge || badge === 'NONE') return <Badge tone="neutral">NONE</Badge>;
  if (badge === 'GOLD') return <Badge tone="warn">GOLD</Badge>;
  if (badge === 'SILVER') return <Badge tone="info">SILVER</Badge>;
  return <Badge tone="good">{badge}</Badge>;
}
