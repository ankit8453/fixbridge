import type { PrismaClient } from '@prisma/client';
import { P, type NotificationParams } from '../../src/modules/notifications/params';
import { TEMPLATES, bodyKeyOf, titleKeyOf } from '../../src/modules/notifications/templates';
import type { TemplateId } from '../../src/modules/notifications/templates';
import { deterministicUuid } from './deterministic-id';

/**
 * Inboxes with something in them.
 *
 * A demo account whose bell shows zero teaches nobody anything, and the Phase 11
 * ops screens and the Phase 13/14 apps both need a realistic inbox to be built
 * against. Every row here corresponds to something that actually happened in the
 * seeded history — the booking that was accepted, the cash that was recorded,
 * the technician who was suspended — so the inbox and the booking timeline tell
 * the same story.
 *
 * The notifications are written directly rather than by replaying events through
 * the consumer: the seed holds a bare Prisma client with no app context, and
 * faking one up would make the seed depend on the whole runtime. The template
 * ids and parameter shapes are imported from the real registry, so a renamed
 * template breaks the seed at compile time rather than silently seeding rubbish.
 */

type ChannelName = 'in_app' | 'whatsapp' | 'sms';

interface NotificationSeed {
  /** Stable key for the deterministic id. */
  key: string;
  topic: string;
  template: TemplateId;
  criticality: 'critical' | 'standard';
  channels: ChannelName[];
  deepLink: string | null;
  /** Days before "now", so the inbox is not one flat timestamp. */
  daysAgo: number;
  /** Whether it has been read. A believable inbox has both. */
  read: boolean;
}

/** First name only, exactly as the live consumer does it. */
const firstName = (name: string | null) => {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return first.length > 0 ? P.text(first) : P.key('notif.fallback.provider');
};

export interface NotificationSeedSummary {
  notifications: number;
  deliveries: number;
}

export async function seedNotifications(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<NotificationSeedSummary> {
  let notifications = 0;
  let deliveries = 0;

  const add = async (
    userId: string,
    aggregateId: string,
    seed: NotificationSeed,
    params: NotificationParams,
  ): Promise<void> => {
    const id = deterministicUuid(`notification:${seed.key}`);

    if (await prisma.notification.findUnique({ where: { id }, select: { id: true } })) return;

    const spec = TEMPLATES[seed.template];
    const createdAt = new Date(now.getTime() - seed.daysAgo * 24 * 60 * 60 * 1000);

    await prisma.notification.create({
      data: {
        id,
        userId,
        topic: seed.topic,
        aggregateId,
        titleKey: titleKeyOf(spec),
        bodyKey: bodyKeyOf(spec),
        params: params as never,
        deepLink: seed.deepLink,
        criticality: seed.criticality,
        readAt: seed.read ? new Date(createdAt.getTime() + 60 * 60 * 1000) : null,
        createdAt,
      },
    });

    notifications += 1;

    for (const channel of seed.channels) {
      await prisma.notificationDelivery.create({
        data: {
          id: deterministicUuid(`delivery:${seed.key}:${channel}`),
          notificationId: id,
          topic: seed.topic,
          aggregateId,
          recipientUserId: userId,
          channel,
          transport: channel === 'in_app' ? 'in_app' : 'console',
          status: 'sent',
          transportRef: `seed-${seed.key}-${channel}`,
          attempts: 1,
          sentAt: createdAt,
          createdAt,
        },
      });

      deliveries += 1;
    }
  };

  const bookingOf = async (key: string) =>
    prisma.booking.findUnique({
      where: { id: deterministicUuid(`booking:${key}`) },
      select: {
        id: true,
        startsAt: true,
        customerId: true,
        providerId: true,
        category: { select: { nameKey: true } },
        provider: { select: { displayName: true } },
      },
    });

  /* ---- the customer's inbox ---- */

  const accepted = await bookingOf('accepted-upcoming');

  if (accepted) {
    await add(
      accepted.customerId,
      accepted.id,
      {
        key: 'accepted-upcoming',
        topic: 'booking.accepted',
        // No OTP: the code lives in Redis with a TTL and the seed does not mint
        // one, which is exactly the case the fallback template exists for.
        template: 'bookingAcceptedNoOtp',
        criticality: 'critical',
        channels: ['in_app', 'whatsapp'],
        deepLink: `booking/${accepted.id}`,
        daysAgo: 0,
        read: false,
      },
      {
        providerName: firstName(accepted.provider.displayName),
        time: P.time(accepted.startsAt),
      },
    );
  }

  const cashJob = await bookingOf('completed-after-otp-retry');

  if (cashJob) {
    const payment = await prisma.payment.findFirst({
      where: { bookingId: cashJob.id, method: 'cash' },
      select: { amountPaise: true },
    });

    /**
     * The anti-fraud one, on all three channels — the seeded history has exactly
     * one cash job, and this is what the customer would have been sent about it.
     */
    await add(
      cashJob.customerId,
      cashJob.id,
      {
        key: 'cash-recorded',
        topic: 'payment.cash_recorded',
        template: 'paymentCashRecorded',
        criticality: 'critical',
        channels: ['in_app', 'whatsapp', 'sms'],
        deepLink: `booking/${cashJob.id}`,
        daysAgo: 3,
        read: true,
      },
      { amount: P.money(payment?.amountPaise ?? 0) },
    );
  }

  const online = await bookingOf('completed');

  if (online) {
    const payment = await prisma.payment.findFirst({
      where: { bookingId: online.id, status: 'captured' },
      select: { amountPaise: true },
    });

    const gross = payment?.amountPaise ?? 0;

    await add(
      online.customerId,
      online.id,
      {
        key: 'captured-customer',
        topic: 'payment.captured',
        template: 'paymentCapturedCustomer',
        criticality: 'standard',
        channels: ['in_app'],
        deepLink: `booking/${online.id}`,
        daysAgo: 4,
        read: true,
      },
      { amount: P.money(gross) },
    );

    /* ---- and the technician's ---- */

    await add(
      online.providerId,
      online.id,
      {
        key: 'captured-provider',
        topic: 'payment.captured',
        template: 'paymentCapturedProvider',
        criticality: 'standard',
        channels: ['in_app'],
        deepLink: 'wallet',
        daysAgo: 4,
        read: false,
      },
      // 12% is the seeded default commission; the exact split lives in the
      // ledger, and this message only ever showed a rounded net.
      { netAmount: P.money(Math.round(gross * 0.88)) },
    );
  }

  const openRequest = await bookingOf('requested-open');

  if (openRequest) {
    await add(
      openRequest.providerId,
      openRequest.id,
      {
        key: 'requested-open',
        topic: 'booking.requested',
        template: 'bookingRequested',
        criticality: 'critical',
        channels: ['in_app', 'whatsapp'],
        deepLink: `booking/${openRequest.id}`,
        daysAgo: 0,
        read: false,
      },
      {
        categoryName: P.key(openRequest.category.nameKey),
        time: P.time(openRequest.startsAt),
        expiryMinutes: P.num(15),
      },
    );
  }

  /* ---- the suspended technician ---- */

  /**
   * The message this phase would be a failure without.
   *
   * Phase 9 suspended Shabana Bano for repeat cancellations and told her
   * nothing, which in a real market means losing her. Her inbox now carries the
   * reason and, because it is critical, it went out on every channel.
   */
  const suspended = await prisma.user.findUnique({
    where: { phone: '+919000000012' },
    select: { id: true, providerProfile: { select: { suspendedUntil: true } } },
  });

  if (suspended?.providerProfile?.suspendedUntil) {
    await add(
      suspended.id,
      suspended.id,
      {
        key: 'suspension',
        topic: 'provider.suspended',
        template: 'providerSuspended',
        criticality: 'critical',
        channels: ['in_app', 'whatsapp', 'sms'],
        deepLink: 'trust',
        daysAgo: 1,
        read: false,
      },
      {
        reason: P.key('trust.suspension.repeatCancellation'),
        until: P.time(suspended.providerProfile.suspendedUntil),
      },
    );
  }

  console.log(`notifications ready: ${notifications} in inboxes, ${deliveries} deliveries`);

  return { notifications, deliveries };
}
