import { Badge, StatusPill, type Tone } from '@/components/ui';
import type { TrustBadge } from '../lib/types';

/**
 * Status and badge colouring specific to the admin domain's enums — ported
 * from `legacy-next-src/components/admin/ui/Badge.tsx` onto the new kit's
 * `Tone` vocabulary (`neutral | success | warning | danger | info`, not the
 * legacy `neutral | good | bad | warn | info`). The shared `Badge`/
 * `StatusPill` deliberately have no such mapping (see their own comments): a
 * tone keyed on an untranslated English enum value belongs next to whichever
 * surface owns that enum, and this surface is the one that renders raw
 * `booking_status` / verification-case-status strings.
 */

/**
 * Booking and case statuses coloured by what they mean to ops, not
 * alphabetically.
 *
 * Anything red is somebody stuck or somebody unhappy. That mapping is the
 * whole value of colour on a queue screen — an unrecognised status stays
 * neutral rather than being guessed at, because a wrong colour here is worse
 * than none.
 */
function toneFor(status: string): Tone {
  if (/failed|cancelled|suspended|blocked|severe|open|expired|parked/i.test(status))
    return 'danger';
  if (/passed|paid|captured|resolved|completed|settled|active|published/i.test(status))
    return 'success';
  if (/pending|submitted|in_review|needs_info|queued|draft|held|processing/i.test(status))
    return 'warning';
  return 'neutral';
}

export function StatusBadge({ status }: { status: string }) {
  return <StatusPill tone={toneFor(status)}>{status}</StatusPill>;
}

export function BadgeLevel({ badge }: { badge: TrustBadge | string | null | undefined }) {
  if (!badge || badge === 'NONE') return <Badge tone="neutral">NONE</Badge>;
  if (badge === 'GOLD') return <Badge tone="warning">GOLD</Badge>;
  if (badge === 'SILVER') return <Badge tone="info">SILVER</Badge>;
  return <Badge tone="success">{badge}</Badge>;
}
