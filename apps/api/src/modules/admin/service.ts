import type { Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, audited, type AuditActor } from '../../core/audit';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { bookingOtpKeys, createBookingOtpStore } from '../bookings/otp';
import { acceptOnBehalf, cancelBooking } from '../bookings/service';
import { platformPosition } from '../payments/ledger';
import { sendDelivery } from '../notifications/service';
import * as repo from './repository';

/**
 * The ops cockpit's business logic.
 *
 * Two things run through all of it. Every screen answers **"what needs my
 * attention?"** rather than "here is a table", and every action leaves a trace —
 * which is why the mutations below all go through `audited()` rather than
 * touching Prisma directly.
 */

export interface AdminDeps {
  context: AppContext;
  now?: () => Date;
}

const nowOf = (deps: AdminDeps): Date => (deps.now ? deps.now() : new Date());

/* -------------------------------------------------------------------------- */
/* The overview                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The "what needs my attention" wall, as numbers.
 *
 * Every queue depth here is a clickable card in the console, and every one of
 * them is somebody waiting: a technician whose verification has not been looked
 * at, a customer whose complaint is open, a booking stuck behind a locked
 * handshake. A dashboard that opened on a chart of last month's GMV would be a
 * dashboard nobody uses.
 */
export async function getSummary(deps: AdminDeps) {
  const { context } = deps;
  const { prisma, config } = context;
  const at = nowOf(deps);

  const startOfDay = new Date(at.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(at.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(at.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    verificationPending,
    complaintsOpen,
    reviewReports,
    parkedOutbox,
    parkedWebhooks,
    parkedDeliveries,
    heldDeliveries,
    pendingBatches,
    suspendedProviders,
    pendingEntryApproval,
    bookingsByStatus,
    position,
  ] = await Promise.all([
    prisma.verificationCase.count({ where: { status: { in: ['submitted', 'in_review'] } } }),
    prisma.complaint.count({ where: { status: { in: ['open', 'in_review'] } } }),
    prisma.reviewReport.count({ where: { review: { status: 'published' } } }),
    prisma.outboxEvent.count({
      where: { processedAt: null, attempts: { gte: config.OUTBOX_MAX_ATTEMPTS } },
    }),
    prisma.webhookEvent.count({ where: { processingError: { not: null } } }),
    prisma.notificationDelivery.count({
      where: { status: 'failed', attempts: { gte: config.NOTIFY_MAX_ATTEMPTS } },
    }),
    prisma.notificationDelivery.count({ where: { status: 'suppressed_quiet_hours' } }),
    prisma.payoutBatch.count({ where: { status: { in: ['draft', 'processing'] } } }),
    prisma.providerProfile.count({ where: { suspendedUntil: { gt: at } } }),
    prisma.providerProfile.count({
      where: { entryApprovedAt: null, city: { requireEntryApproval: true } },
    }),
    prisma.booking.groupBy({
      by: ['status'],
      where: { createdAt: { gte: startOfDay } },
      _count: { _all: true },
    }),
    platformPosition(prisma),
  ]);

  /**
   * Locked handshakes, counted from Redis rather than Postgres.
   *
   * The lock lives with the OTP, in Redis with a TTL — Phase 6 deliberately kept
   * handshake codes out of the database. So the honest count is a key scan, and
   * at pilot volume that is a handful of keys.
   */
  const lockedKeys = await context.redis.keys('booking:otp:locked:*');

  const [gmvToday, gmv7d, gmv30d] = await Promise.all([
    grossFor(prisma, startOfDay),
    grossFor(prisma, weekAgo),
    grossFor(prisma, monthAgo),
  ]);

  return {
    queues: {
      verificationPending,
      complaintsOpen,
      reviewReports,
      parkedOutbox,
      parkedWebhooks,
      parkedDeliveries,
      heldDeliveries,
      pendingBatches,
      otpLockedBookings: lockedKeys.length,
      suspendedProviders,
      pendingEntryApproval,
    },
    bookings: {
      today: Object.fromEntries(bookingsByStatus.map((row) => [row.status, row._count._all])),
      todayTotal: bookingsByStatus.reduce((sum, row) => sum + row._count._all, 0),
    },
    money: {
      gmvTodayPaise: gmvToday,
      gmv7dPaise: gmv7d,
      gmv30dPaise: gmv30d,
      // Straight from the views. There is no cached revenue number anywhere in
      // this system and there never will be — see docs/money.md.
      revenuePaise: position.revenuePaise,
      gatewayCashPaise: position.gatewayCashPaise,
      owedToProvidersPaise: position.owedToProvidersPaise,
      owedByProvidersPaise: position.owedByProvidersPaise,
    },
    generatedAt: at.toISOString(),
  };
}

/** Gross captured + cash collected since an instant. GMV, not revenue. */
async function grossFor(prisma: AppContext['prisma'], since: Date): Promise<number> {
  const result = await prisma.payment.aggregate({
    where: {
      createdAt: { gte: since },
      status: { in: ['captured', 'partially_refunded', 'refunded'] },
    },
    _sum: { amountPaise: true },
  });

  return result._sum.amountPaise ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The provider page, assembled.
 *
 * This is where most ops phone calls get answered — somebody is on the line
 * asking why they are not getting work — so it carries every reason that could
 * be true at once: completeness, verification, trust, suspension, and money.
 */
export async function getProviderAggregate(deps: AdminDeps, providerId: string) {
  const { context } = deps;

  const profile = await repo.findProviderAggregate(context.prisma, providerId);

  if (!profile) {
    throw new AppError(404, 'PROVIDER_NOT_FOUND', `No technician ${providerId}`, {
      messageKey: 'errors.providers.profileNotFound',
    });
  }

  const [balance, recentBookings] = await Promise.all([
    repo.providerBalance(context.prisma, providerId),
    repo.recentBookingsForProvider(context.prisma, providerId, 10),
  ]);

  const at = nowOf(deps);

  return {
    provider: {
      ...profile,
      /**
       * The four independent reasons somebody might be invisible, answered
       * separately. "Not in search" is the question; which gate is failing is
       * the answer, and conflating them is how ops end up guessing.
       */
      visibility: {
        listed: profile.isListed,
        accountActive: profile.user.status === 'active',
        verified: ['VERIFIED', 'SILVER', 'GOLD'].includes(profile.verification?.badge ?? 'NONE'),
        notSuspended: profile.suspendedUntil === null || profile.suspendedUntil <= at,
        entryApproved: !profile.city.requireEntryApproval || profile.entryApprovedAt !== null,
      },
      balance,
      recentBookings,
    },
  };
}

/** Ops waving a technician onto the platform, where the city asks for it. */
export async function approveEntry(
  deps: AdminDeps,
  actor: AuditActor,
  providerId: string,
  note: string,
) {
  const { context } = deps;
  const at = nowOf(deps);

  return audited(
    context.prisma,
    actor,
    {
      action: AUDIT_ACTIONS.providerApproveEntry,
      targetType: 'provider',
      targetId: providerId,
      payload: { note },
    },
    async (tx) => {
      const updated = await tx.providerProfile.updateMany({
        where: { userId: providerId, entryApprovedAt: null },
        data: { entryApprovedAt: at, entryApprovedById: actor.userId },
      });

      if (updated.count === 0) {
        throw new AppError(409, 'ALREADY_APPROVED', 'That technician is already approved', {
          messageKey: 'errors.admin.alreadyApproved',
        });
      }

      return { providerId, entryApprovedAt: at.toISOString() };
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Bookings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One booking's whole history, merged.
 *
 * The dispute screen. Events, quotes, money and **what each side was actually
 * told** in one chronological list, because "nobody informed me" is the second
 * thing every dispute turns on and the notification rows are the only place that
 * is answerable from.
 */
export async function getBookingTimeline(deps: AdminDeps, bookingId: string) {
  const { context } = deps;

  const booking = await repo.findBookingTimeline(context.prisma, bookingId);

  if (!booking) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', `Booking ${bookingId} not found`, {
      messageKey: 'errors.bookings.notFound',
    });
  }

  const [notifications, otpLocked] = await Promise.all([
    repo.notificationsForBooking(context.prisma, bookingId),
    context.redis.exists(bookingOtpKeys.locked(bookingId)),
  ]);

  return { booking, notifications, otpLocked: otpLocked === 1 };
}

/**
 * Unlocking a handshake after five wrong codes at somebody's door.
 *
 * Phase 6 locked it deliberately and refused to quietly reissue: the whole point
 * of the handshake is that a specific person is at a specific door, so an
 * automatic retry would defeat it. The resolution was always meant to be a human
 * who checks who they are talking to — this is that human, and the mandatory note
 * is the only evidence they did.
 */
export async function unlockBookingOtp(
  deps: AdminDeps,
  actor: AuditActor,
  bookingId: string,
  input: { note: string; kind: 'start' | 'end' | 'both' },
) {
  const { context } = deps;

  const booking = await context.prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true },
  });

  if (!booking) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', `Booking ${bookingId} not found`, {
      messageKey: 'errors.bookings.notFound',
    });
  }

  const locked = await context.redis.exists(bookingOtpKeys.locked(bookingId));

  if (locked !== 1) {
    throw new AppError(409, 'BOOKING_NOT_LOCKED', 'That booking is not locked', {
      messageKey: 'errors.admin.bookingNotLocked',
    });
  }

  const result = await audited(
    context.prisma,
    actor,
    {
      action: AUDIT_ACTIONS.bookingOtpUnlock,
      targetType: 'booking',
      targetId: bookingId,
      payload: { note: input.note, kind: input.kind, status: booking.status },
    },
    async () => ({ bookingId, unlocked: true }),
  );

  /**
   * Redis after the commit, deliberately.
   *
   * If the audit row fails to write, nothing is unlocked — an unlock nobody is
   * accountable for is precisely what the note exists to prevent.
   */
  const store = createBookingOtpStore(context.redis, context.config);
  await context.redis.del(bookingOtpKeys.locked(bookingId));

  for (const kind of input.kind === 'both' ? (['start', 'end'] as const) : [input.kind]) {
    await context.redis.del(bookingOtpKeys.attempts(bookingId, kind));
  }

  context.logger.warn(
    { bookingId, actor: actor.userId, kind: input.kind },
    'ops unlocked a booking handshake',
  );

  return { ...result, codes: await peekCodes(store, bookingId) };
}

async function peekCodes(
  store: ReturnType<typeof createBookingOtpStore>,
  bookingId: string,
): Promise<{ start: string | null; end: string | null }> {
  // Read back rather than reissued: the codes themselves were never the problem,
  // the attempt counter was. Reissuing would invalidate the slip the customer is
  // holding.
  return {
    start: await store.peek(bookingId, 'start'),
    end: await store.peek(bookingId, 'end'),
  };
}

/**
 * Ops cancelling on somebody's behalf.
 *
 * Rare, and deliberately **not** a bypass. It obeys the same state machine a
 * customer's cancel does — the transition is refused once the technician has
 * arrived, because at that point work has begun and money may be owed. An ops
 * button that could quietly cancel a job in progress would be a way to make a
 * bill disappear.
 *
 * Recorded as a customer-side cancellation because that is what it is: ops
 * acting for somebody who phoned in. The audit row is what says a human did it.
 */
export async function opsCancelBooking(
  deps: AdminDeps,
  actor: AuditActor,
  bookingId: string,
  reason: string,
) {
  const { context } = deps;

  const booking = await context.prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true, customerId: true },
  });

  if (!booking) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', `Booking ${bookingId} not found`, {
      messageKey: 'errors.bookings.notFound',
    });
  }

  if (!OPS_CANCELLABLE.includes(booking.status)) {
    throw new AppError(
      409,
      'BOOKING_NOT_CANCELLABLE',
      `A booking in ${booking.status} cannot be cancelled by ops`,
      { messageKey: 'errors.admin.notCancellable', details: { status: booking.status } },
    );
  }

  await audited(
    context.prisma,
    actor,
    {
      action: AUDIT_ACTIONS.bookingOpsCancel,
      targetType: 'booking',
      targetId: bookingId,
      payload: { reason, statusBefore: booking.status },
    },
    async () => undefined,
  );

  // The cancellation itself runs through the ordinary booking service, so the
  // slot is released, the OTPs are cleared and the outbox event fires exactly as
  // they would for a customer — there is no second cancellation path to drift.
  const result = await cancelBooking({ context }, booking.customerId, bookingId, {
    reason: 'other',
    note: `ops: ${reason}`,
  });

  context.logger.warn({ bookingId, actor: actor.userId, reason }, 'ops cancelled a booking');

  return { booking: result };
}

/** Before anybody has turned up. After that, the job has started. */
const OPS_CANCELLABLE: readonly string[] = ['REQUESTED', 'ACCEPTED', 'EN_ROUTE'];

/* -------------------------------------------------------------------------- */
/* Parked queues                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Puts a parked outbox event back in the dispatcher's path.
 *
 * Resets the attempt counter rather than nudging the schedule: the row parked
 * because something was broken, and a human is now asserting it is fixed. The
 * consumers are all idempotent, which is what makes a retry safe to offer as a
 * button at all.
 */
export async function retryOutbox(deps: AdminDeps, actor: AuditActor, outboxId: string) {
  const { context } = deps;

  return audited(
    context.prisma,
    actor,
    {
      action: AUDIT_ACTIONS.outboxRetry,
      targetType: 'outbox_event',
      targetId: outboxId,
      payload: {},
    },
    async (tx) => {
      const row = await tx.outboxEvent.findUnique({ where: { id: outboxId } });

      if (!row) throw notFound('outbox event', outboxId);

      await tx.outboxEvent.update({
        where: { id: outboxId },
        data: { attempts: 0, nextAttemptAt: nowOf(deps), lastError: null },
      });

      return { id: outboxId, topic: row.topic, retried: true };
    },
  );
}

/**
 * Gives up on an event, on the record.
 *
 * Marked processed rather than deleted. The row is the evidence that something
 * was published and never delivered, and the reason is a human saying why that
 * was acceptable — deleting it would erase both.
 */
export async function discardOutbox(
  deps: AdminDeps,
  actor: AuditActor,
  outboxId: string,
  reason: string,
) {
  const { context } = deps;

  return audited(
    context.prisma,
    actor,
    {
      action: AUDIT_ACTIONS.outboxDiscard,
      targetType: 'outbox_event',
      targetId: outboxId,
      payload: { reason },
    },
    async (tx) => {
      const row = await tx.outboxEvent.findUnique({ where: { id: outboxId } });
      if (!row) throw notFound('outbox event', outboxId);

      await tx.outboxEvent.update({
        where: { id: outboxId },
        data: { processedAt: nowOf(deps), lastError: `discarded by ops: ${reason}`.slice(0, 2000) },
      });

      return { id: outboxId, discarded: true };
    },
  );
}

/** Re-queues a webhook for the processor. The handler is idempotent by design. */
export async function reprocessWebhook(deps: AdminDeps, actor: AuditActor, webhookId: string) {
  const { context } = deps;

  return audited(
    context.prisma,
    actor,
    {
      action: AUDIT_ACTIONS.webhookReprocess,
      targetType: 'webhook_event',
      targetId: webhookId,
      payload: {},
    },
    async (tx) => {
      const row = await tx.webhookEvent.findUnique({ where: { id: webhookId } });
      if (!row) throw notFound('webhook event', webhookId);

      await tx.webhookEvent.update({
        where: { id: webhookId },
        data: { processedAt: null, processingError: null },
      });

      // Re-published rather than applied inline: the gateway's budget is seconds
      // and ledger work does not belong inside it — Phase 8's reasoning, unchanged.
      await tx.outboxEvent.create({
        data: {
          topic: 'webhook.received',
          aggregateType: 'webhook_event',
          aggregateId: webhookId,
          payload: { gatewayEventId: row.gatewayEventId, eventType: row.eventType },
        },
      });

      return { id: webhookId, requeued: true };
    },
  );
}

export async function discardWebhook(
  deps: AdminDeps,
  actor: AuditActor,
  webhookId: string,
  reason: string,
) {
  const { context } = deps;

  return audited(
    context.prisma,
    actor,
    {
      action: AUDIT_ACTIONS.webhookDiscard,
      targetType: 'webhook_event',
      targetId: webhookId,
      payload: { reason },
    },
    async (tx) => {
      const row = await tx.webhookEvent.findUnique({ where: { id: webhookId } });
      if (!row) throw notFound('webhook event', webhookId);

      await tx.webhookEvent.update({
        where: { id: webhookId },
        data: {
          processedAt: nowOf(deps),
          processingError: `discarded by ops: ${reason}`.slice(0, 1000),
        },
      });

      return { id: webhookId, discarded: true };
    },
  );
}

/** Sends a parked notification again, now that whatever broke has been fixed. */
export async function retryDelivery(deps: AdminDeps, actor: AuditActor, deliveryId: string) {
  const { context } = deps;

  const delivery = await context.prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
  });

  if (!delivery) throw notFound('notification delivery', deliveryId);

  await audited(
    context.prisma,
    actor,
    {
      action: AUDIT_ACTIONS.deliveryRetry,
      targetType: 'notification_delivery',
      targetId: deliveryId,
      payload: { channel: delivery.channel, topic: delivery.topic },
    },
    async (tx) => {
      // The attempt budget is what parked it; a human saying "try again" is the
      // only thing that should reset it.
      await tx.notificationDelivery.update({
        where: { id: deliveryId },
        data: { attempts: 0, status: 'queued', lastError: null },
      });
    },
  );

  const recipient = await context.prisma.user.findUnique({
    where: { id: delivery.recipientUserId },
    select: { id: true, phone: true, preferredLanguage: true },
  });

  if (!recipient) return { id: deliveryId, sent: false };

  const fresh = await context.prisma.notificationDelivery.findUnique({ where: { id: deliveryId } });

  try {
    // Outside the transaction on purpose: a vendor call is somebody else's
    // system and must never be inside one of our transactions.
    await sendDelivery({ context }, fresh as NonNullable<typeof fresh>, recipient);
    return { id: deliveryId, sent: true };
  } catch {
    // The delivery row already records the failure; the retry itself is audited
    // either way, which is the fact ops need.
    return { id: deliveryId, sent: false };
  }
}

export async function discardDelivery(
  deps: AdminDeps,
  actor: AuditActor,
  deliveryId: string,
  reason: string,
) {
  const { context } = deps;

  return audited(
    context.prisma,
    actor,
    {
      action: AUDIT_ACTIONS.deliveryDiscard,
      targetType: 'notification_delivery',
      targetId: deliveryId,
      payload: { reason },
    },
    async (tx) => {
      const row = await tx.notificationDelivery.findUnique({ where: { id: deliveryId } });
      if (!row) throw notFound('notification delivery', deliveryId);

      await tx.notificationDelivery.update({
        where: { id: deliveryId },
        data: { lastError: `discarded by ops: ${reason}`.slice(0, 1000) },
      });

      return { id: deliveryId, discarded: true };
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Cities                                                                     */
/* -------------------------------------------------------------------------- */

export async function updateCitySettings(
  deps: AdminDeps,
  actor: AuditActor,
  cityId: number,
  input: { requireEntryApproval?: boolean; isActive?: boolean },
) {
  const { context } = deps;

  return audited(
    context.prisma,
    actor,
    {
      action: AUDIT_ACTIONS.cityUpdateSettings,
      targetType: 'city',
      targetId: String(cityId),
      payload: input as Prisma.InputJsonValue,
    },
    async (tx) => {
      const before = await tx.city.findUnique({ where: { id: cityId } });
      if (!before) throw notFound('city', String(cityId));

      return tx.city.update({
        where: { id: cityId },
        data: {
          ...(input.requireEntryApproval === undefined
            ? {}
            : { requireEntryApproval: input.requireEntryApproval }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
      });
    },
  );
}

const notFound = (what: string, id: string): AppError =>
  new AppError(404, 'NOT_FOUND', `No ${what} ${id}`, { messageKey: 'errors.common.notFound' });

/**
 * Ops accepts a booking on the technician's behalf.
 *
 * **Pilot scaffolding**, gated on `BOOKING_OPS_ACCEPT_ENABLED`.
 *
 * The first technicians on the platform take work over the phone: they have
 * not yet learned to watch the app, and will not until it has earned them a
 * job or two. Without this the sequence is absurd — the technician verbally
 * agrees, and the booking expires anyway because nobody tapped a button.
 *
 * It is accept-on-behalf, never reassignment. The booking stays with the
 * technician the customer chose; handing it to somebody else would break the
 * promise the product is built on (the customer picked *this* person, at
 * *this* person's price) and would strand the agreed rate snapshotted at
 * booking. If the technician truly cannot come, the honest move is telling the
 * customer so they can choose again.
 */
export async function opsAcceptBooking(deps: AdminDeps, actor: AuditActor, bookingId: string) {
  const { context } = deps;

  const booking = await context.prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true, providerId: true },
  });

  if (!booking) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', `Booking ${bookingId} not found`, {
      messageKey: 'errors.bookings.notFound',
    });
  }

  if (booking.status !== 'REQUESTED') {
    throw new AppError(
      409,
      'BOOKING_NOT_ACCEPTABLE',
      `A booking in ${booking.status} is not awaiting acceptance`,
      { messageKey: 'errors.admin.notAcceptable', details: { status: booking.status } },
    );
  }

  await audited(
    context.prisma,
    actor,
    {
      action: AUDIT_ACTIONS.bookingOpsAccept,
      targetType: 'booking',
      targetId: bookingId,
      /** Who it was accepted for — the question anyone reading this row will ask. */
      payload: { providerId: booking.providerId, statusBefore: booking.status },
    },
    async () => undefined,
  );

  // Straight through the ordinary acceptance, so the slot is booked, the
  // handshake codes are issued and the outbox fires exactly as they would for
  // the technician's own tap. No second acceptance path to drift.
  const result = await acceptOnBehalf(
    { context },
    actor.adminId ?? actor.userId ?? 'unknown',
    bookingId,
  );

  context.logger.info(
    { bookingId, providerId: booking.providerId, actor: actor.adminId ?? actor.userId },
    'ops accepted a booking for the technician',
  );

  return { booking: result };
}
