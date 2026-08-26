import type { TrustBadge } from '../lib/types';
import { Pill, type Tone } from './ui';

/**
 * Status and badge colouring specific to the admin domain's enums — ported
 * from `legacy-next-src/components/admin/ui/Badge.tsx`, now rendered with
 * this surface's own `Pill` rather than the shared kit's `StatusPill`. The
 * shared kit is indigo-flavoured and deliberately has no such mapping (see
 * its own comments): a tone keyed on an untranslated English enum value
 * belongs next to whichever surface owns that enum, and this surface is the
 * one that renders raw `booking_status` / verification-case-status strings.
 *
 * `Pill`'s `Tone` is a superset of the shared kit's — it adds `admin` — so
 * every tone this file returns is still valid; nothing needed remapping.
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
  return <Pill tone={toneFor(status)}>{status}</Pill>;
}

export function BadgeLevel({ badge }: { badge: TrustBadge | string | null | undefined }) {
  if (!badge || badge === 'NONE') return <Pill tone="neutral">NONE</Pill>;
  if (badge === 'GOLD') return <Pill tone="warning">GOLD</Pill>;
  if (badge === 'SILVER') return <Pill tone="info">SILVER</Pill>;
  return <Pill tone="success">{badge}</Pill>;
}
