/**
 * What this phase publishes.
 *
 * Kept in their own file because both the reviews and complaints modules emit
 * them and the trust engine subscribes to them — putting them in any one of the
 * three would make the other two import it for no other reason.
 *
 * Topic names are public API between modules. Renaming one silently breaks a
 * consumer, and Phase 10 will subscribe to most of these to tell somebody.
 */
export const TRUST_TOPICS = {
  reviewCreated: 'review.created',
  /** Moderation. The engine recomputes so a hidden review stops counting. */
  reviewHidden: 'review.hidden',
  reviewReported: 'review.reported',

  complaintOpened: 'complaint.opened',
  complaintInReview: 'complaint.in_review',
  complaintResolved: 'complaint.resolved',
  complaintDismissed: 'complaint.dismissed',

  providerSuspended: 'provider.suspended',
  providerReinstated: 'provider.reinstated',
} as const;

export type TrustTopic = (typeof TRUST_TOPICS)[keyof typeof TRUST_TOPICS];
