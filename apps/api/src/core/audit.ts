import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { getAuthUser } from './middleware/authenticate';

/**
 * The audit backbone.
 *
 * This product routes verification, complaints, suspensions, refunds and payouts
 * through **human judgment** — a frozen decision, and the right one for a market
 * that runs on trust. The cost is that every one of those decisions is a person's
 * opinion about somebody else's livelihood. An opinion nobody wrote down is one
 * nobody can be answerable for, and "ops said so" is not an answer you can give a
 * technician whose account you closed.
 *
 * Three rules, and the tests enforce all three:
 *
 *   1. **Every admin mutation is audited.** `AUDITED_ADMIN_ROUTES` below is
 *      compared against the real Express router stack, in both directions, so a
 *      new admin mutation without an entry fails CI and a stale entry does too.
 *   2. **The audit row is written in the same transaction as the mutation.** If
 *      the decision rolls back, so does the record of it — a log full of things
 *      that did not happen is worse than no log.
 *   3. **The payload carries the substance.** Before/after, the note, the
 *      amount. A row that says only "somebody clicked fail" is not evidence.
 */

/* -------------------------------------------------------------------------- */
/* The action vocabulary                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every action this system can record, as a closed set.
 *
 * Deliberately TypeScript rather than a Postgres enum: a new ops capability
 * would otherwise need a migration simply to name itself, and that is the wrong
 * amount of friction — the pressure becomes to reuse a near-enough existing
 * action, which is exactly how an audit log stops being readable.
 */
export const AUDIT_ACTIONS = {
  verificationReview: 'verification.review',
  verificationDecide: 'verification.decide',

  userBlock: 'user.block',
  userUnblock: 'user.unblock',

  providerSuspend: 'provider.suspend',
  providerReinstate: 'provider.reinstate',
  providerRecompute: 'provider.recompute',
  providerApproveEntry: 'provider.approve_entry',

  bookingOtpUnlock: 'booking.otp_unlock',
  bookingOpsCancel: 'booking.ops_cancel',

  complaintTakeUp: 'complaint.take_up',
  complaintResolve: 'complaint.resolve',
  complaintDismiss: 'complaint.dismiss',

  reviewHide: 'review.hide',
  reviewUnhide: 'review.unhide',

  paymentRefund: 'payment.refund',
  duesSettle: 'dues.settle',
  payoutBatchCreate: 'payout_batch.create',
  payoutBatchClose: 'payout_batch.close',
  payoutMarkPaid: 'payout.mark_paid',
  payoutMarkFailed: 'payout.mark_failed',

  outboxRetry: 'outbox.retry',
  outboxDiscard: 'outbox.discard',
  webhookReprocess: 'webhook.reprocess',
  webhookDiscard: 'webhook.discard',
  deliveryRetry: 'delivery.retry',
  deliveryDiscard: 'delivery.discard',

  cityUpdateSettings: 'city.update_settings',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/**
 * The coverage registry: every mutating admin route and the action it records.
 *
 * Paths are exactly as Express reports them, mount prefix included. The test in
 * `audit.integration.test.ts` walks the real router stack and compares — so this
 * is not documentation that can drift, it is a list CI holds you to.
 */
export const AUDITED_ADMIN_ROUTES: Record<string, AuditAction> = {
  'POST /api/v1/admin/verification/cases/:caseId/review': AUDIT_ACTIONS.verificationReview,
  'POST /api/v1/admin/verification/cases/:caseId/decide': AUDIT_ACTIONS.verificationDecide,

  'POST /api/v1/admin/users/:userId/block': AUDIT_ACTIONS.userBlock,
  'POST /api/v1/admin/users/:userId/unblock': AUDIT_ACTIONS.userUnblock,

  'POST /api/v1/admin/trust/suspend': AUDIT_ACTIONS.providerSuspend,
  'POST /api/v1/admin/trust/:providerId/reinstate': AUDIT_ACTIONS.providerReinstate,
  'POST /api/v1/admin/trust/:providerId/recompute': AUDIT_ACTIONS.providerRecompute,
  'POST /api/v1/admin/providers/:providerId/approve-entry': AUDIT_ACTIONS.providerApproveEntry,

  'POST /api/v1/admin/bookings/:bookingId/otp-unlock': AUDIT_ACTIONS.bookingOtpUnlock,
  'POST /api/v1/admin/bookings/:bookingId/cancel': AUDIT_ACTIONS.bookingOpsCancel,

  'POST /api/v1/admin/complaints/:complaintId/take-up': AUDIT_ACTIONS.complaintTakeUp,
  'POST /api/v1/admin/complaints/:complaintId/resolve': AUDIT_ACTIONS.complaintResolve,
  'POST /api/v1/admin/complaints/:complaintId/dismiss': AUDIT_ACTIONS.complaintDismiss,

  'POST /api/v1/admin/reviews/:reviewId/hide': AUDIT_ACTIONS.reviewHide,
  'POST /api/v1/admin/reviews/:reviewId/unhide': AUDIT_ACTIONS.reviewUnhide,

  'POST /api/v1/admin/payments/payout-batches': AUDIT_ACTIONS.payoutBatchCreate,
  'POST /api/v1/admin/payments/payout-batches/:batchId/close': AUDIT_ACTIONS.payoutBatchClose,
  'POST /api/v1/admin/payments/payouts/:payoutId/paid': AUDIT_ACTIONS.payoutMarkPaid,
  'POST /api/v1/admin/payments/payouts/:payoutId/failed': AUDIT_ACTIONS.payoutMarkFailed,
  'POST /api/v1/admin/payments/dues/settle': AUDIT_ACTIONS.duesSettle,
  'POST /api/v1/admin/payments/:paymentId/refund': AUDIT_ACTIONS.paymentRefund,

  'POST /api/v1/admin/queues/outbox/:outboxId/retry': AUDIT_ACTIONS.outboxRetry,
  'POST /api/v1/admin/queues/outbox/:outboxId/discard': AUDIT_ACTIONS.outboxDiscard,
  'POST /api/v1/admin/queues/webhooks/:webhookId/reprocess': AUDIT_ACTIONS.webhookReprocess,
  'POST /api/v1/admin/queues/webhooks/:webhookId/discard': AUDIT_ACTIONS.webhookDiscard,
  'POST /api/v1/admin/queues/deliveries/:deliveryId/retry': AUDIT_ACTIONS.deliveryRetry,
  'POST /api/v1/admin/queues/deliveries/:deliveryId/discard': AUDIT_ACTIONS.deliveryDiscard,

  'PATCH /api/v1/admin/cities/:cityId': AUDIT_ACTIONS.cityUpdateSettings,
};

/* -------------------------------------------------------------------------- */
/* The ops / admin split                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The routes `ops` may **not** touch — `admin` only.
 *
 * Phase 11 treated the two roles as near-equivalent, which was wrong. The line
 * is not seniority, it is **reversibility**:
 *
 *   `ops` does the judgment work. Verification decisions, complaints, review
 *   moderation, OTP unlock, suspension, block/unblock, queue retries. All of it
 *   consequential, all of it reversible by another human, and all of it needed
 *   dozens of times a day by whoever is actually running the marketplace.
 *
 *   `admin` holds the money and the config. A refund, a payout marked paid, a
 *   dues settlement and the entry-approval flag are either irreversible or they
 *   change the rules everybody else operates under. These happen a handful of
 *   times a week and are worth a second person.
 *
 * A hired ops assistant should be able to do their whole job without ever
 * holding a credential that can move money out of the platform. That is the
 * whole point of the split, and it is why it is enumerated here rather than
 * sprinkled across route files: a test walks the real router stack and asserts
 * an `ops` token is refused on exactly this set and allowed everywhere else.
 */
export const ADMIN_ONLY_ROUTES: readonly string[] = [
  // Money that leaves the platform, or that says money already did.
  'POST /api/v1/admin/payments/:paymentId/refund',
  'POST /api/v1/admin/payments/payouts/:payoutId/paid',
  'POST /api/v1/admin/payments/payouts/:payoutId/failed',
  'POST /api/v1/admin/payments/dues/settle',
  // Config: the rules everybody else operates inside.
  'PATCH /api/v1/admin/cities/:cityId',
];

const ADMIN_ONLY = new Set(ADMIN_ONLY_ROUTES);

/** Whether a given method+path is admin-only. Used by the route guard and tests. */
export function isAdminOnlyRoute(method: string, path: string): boolean {
  return ADMIN_ONLY.has(`${method.toUpperCase()} ${path}`);
}

/* -------------------------------------------------------------------------- */
/* Writing a row                                                              */
/* -------------------------------------------------------------------------- */

/** Who is acting, and from where. Assembled once per request at the route. */
export interface AuditActor {
  userId: string;
  ip: string | null;
  requestId: string | null;
}

export interface AuditEntry {
  action: AuditAction;
  targetType: string;
  targetId: string | null;
  /** The substance. Before/after, the note, the amount — not just "clicked". */
  payload: Prisma.InputJsonValue;
}

/** Pulls the actor out of an authenticated request. */
export function auditActor(req: Request): AuditActor {
  return {
    userId: getAuthUser(req).id,
    ip: req.ip ?? null,
    // Set by the request-id middleware, so a decision can be traced back to the
    // whole HTTP exchange around it.
    requestId: (req.res?.getHeader('X-Request-Id') as string | undefined) ?? null,
  };
}

/**
 * Writes the row inside a transaction the caller already has open.
 *
 * `tx` is deliberately required and deliberately not the top-level client. If
 * this could be called outside a transaction the "same transaction as the
 * mutation" guarantee would be optional, and an optional guarantee is not one —
 * the same argument as `enqueueOutbox`.
 */
export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  actor: AuditActor,
  entry: AuditEntry,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: actor.userId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      payload: entry.payload,
      ip: actor.ip,
      requestId: actor.requestId,
    },
  });
}

/**
 * The hook a pre-existing service exposes so its own transaction can carry an
 * audit row.
 *
 * Phases 4 and 8–10 wrote services that already open exactly the right
 * transaction — the one the mutation happens in. Wrapping those in a *second*
 * outer transaction is not possible with Prisma's interactive API and would be
 * the wrong shape anyway. So instead of moving the transaction, the audit row
 * moves into it: a service that accepts `audit` writes the row alongside its own
 * changes, and one that is called without it behaves exactly as before.
 *
 * Optional on purpose. These services are also called by jobs, by the outbox and
 * by tests, where there is no human actor and an audit row would be a lie.
 */
export interface AuditableDeps {
  audit?: { actor: AuditActor; entry: AuditEntry };
}

/** Writes the caller's audit row, if this call has one. Safe to call always. */
export async function writeDepsAudit(
  tx: Prisma.TransactionClient,
  deps: AuditableDeps,
): Promise<void> {
  if (!deps.audit) return;
  await writeAuditLog(tx, deps.audit.actor, deps.audit.entry);
}

/**
 * Runs a mutation and records it, atomically.
 *
 * The shape every new admin endpoint uses. If `work` throws, the transaction
 * rolls back and no audit row survives — an audit log full of decisions that did
 * not happen is worse than no audit log, because somebody will act on it.
 */
export async function audited<T>(
  prisma: PrismaClient,
  actor: AuditActor,
  entry: AuditEntry | ((result: T) => AuditEntry),
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const result = await work(tx);

    // The entry may depend on the result — "what did it change?" is often only
    // knowable after the change.
    await writeAuditLog(tx, actor, typeof entry === 'function' ? entry(result) : entry);

    return result;
  });
}
