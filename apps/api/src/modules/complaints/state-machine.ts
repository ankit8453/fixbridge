/**
 * The complaint lifecycle — a transition table, like every other machine here.
 *
 * Short, and the shape says something: **only ops can move a complaint.** The
 * person who raised it cannot mark it resolved, and the person it is against
 * certainly cannot dismiss it. A dispute nobody neutral looks at is not a
 * dispute process, it is a suggestion box.
 */

export const COMPLAINT_STATUSES = ['open', 'in_review', 'resolved', 'dismissed'] as const;
export type ComplaintStatusName = (typeof COMPLAINT_STATUSES)[number];

export const COMPLAINT_EVENTS = ['take_up', 'resolve', 'dismiss'] as const;
export type ComplaintEvent = (typeof COMPLAINT_EVENTS)[number];

/** Nothing follows these. A decided complaint stays decided. */
export const TERMINAL_COMPLAINT_STATUSES: readonly ComplaintStatusName[] = [
  'resolved',
  'dismissed',
];

export interface ComplaintTransition {
  from: ComplaintStatusName;
  event: ComplaintEvent;
  to: ComplaintStatusName;
}

export const COMPLAINT_TRANSITIONS: readonly ComplaintTransition[] = [
  { from: 'open', event: 'take_up', to: 'in_review' },
  // Ops may decide straight from `open` — a complaint that needs no
  // investigation should not require a bookkeeping step first.
  { from: 'open', event: 'resolve', to: 'resolved' },
  { from: 'open', event: 'dismiss', to: 'dismissed' },
  { from: 'in_review', event: 'resolve', to: 'resolved' },
  { from: 'in_review', event: 'dismiss', to: 'dismissed' },
];

export type ComplaintOutcome =
  { ok: true; status: ComplaintStatusName } | { ok: false; reason: 'terminal' | 'not_allowed' };

export function applyComplaintEvent(
  from: ComplaintStatusName,
  event: ComplaintEvent,
): ComplaintOutcome {
  if (TERMINAL_COMPLAINT_STATUSES.includes(from)) return { ok: false, reason: 'terminal' };

  const rule = COMPLAINT_TRANSITIONS.find((entry) => entry.from === from && entry.event === event);

  return rule ? { ok: true, status: rule.to } : { ok: false, reason: 'not_allowed' };
}

/** The booking-timeline event each status change appends. */
export const COMPLAINT_BOOKING_EVENT = {
  open: 'complaint_opened',
  in_review: 'complaint_in_review',
  resolved: 'complaint_resolved',
  dismissed: 'complaint_dismissed',
} as const satisfies Record<ComplaintStatusName, string>;

/**
 * Statuses in which a booking may have a complaint raised against it.
 *
 * **From ARRIVED onwards, and no earlier.** Before the technician is at the
 * door, a grievance is a cancellation — the customer changed their mind, or
 * nobody set off. Complaints are about what happened during a visit, and letting
 * them start earlier would turn the dispute queue into a second cancellation
 * flow with worse consequences for the technician.
 */
export const COMPLAINABLE_BOOKING_STATUSES: readonly string[] = [
  'ARRIVED',
  'IN_PROGRESS',
  'WORK_DONE',
  'CLOSED_QUOTE_DECLINED',
];
