import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  ListAuditQuery,
  ListBookingsQuery,
  ListJournalsQuery,
  ListProvidersQuery,
  ListUsersQuery,
} from './types';

/**
 * Every read the ops console needs.
 *
 * Deliberately query-heavy and projection-free: this module owns no state of its
 * own and caches nothing. An ops screen showing a number that was true five
 * minutes ago is worse than a slightly slower one showing the truth — the whole
 * point of the console is to answer "what is happening right now".
 */

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

export async function listUsers(prisma: PrismaClient, query: ListUsersQuery) {
  const where: Prisma.UserWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.role ? { roles: { some: { role: query.role } } } : {}),
    ...(query.q
      ? {
          OR: [
            { phone: { contains: query.q } },
            { name: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      select: {
        id: true,
        phone: true,
        name: true,
        status: true,
        preferredLanguage: true,
        createdAt: true,
        defaultCityId: true,
        roles: { select: { role: true } },
        _count: { select: { bookings: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { rows, total };
}

export function findUserDetail(prisma: PrismaClient, userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      phone: true,
      name: true,
      status: true,
      preferredLanguage: true,
      defaultCityId: true,
      createdAt: true,
      roles: { select: { role: true, grantedAt: true } },
      customerProfile: { select: { userId: true } },
      providerProfile: { select: { userId: true, displayName: true, isListed: true } },
      _count: { select: { bookings: true, addresses: true, notifications: true } },
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                  */
/* -------------------------------------------------------------------------- */

export async function listProviders(prisma: PrismaClient, query: ListProvidersQuery, now: Date) {
  const suspendedFilter =
    query.suspended === 'true'
      ? { suspendedUntil: { gt: now } }
      : query.suspended === 'false'
        ? { OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: now } }] }
        : {};

  const where: Prisma.ProviderProfileWhereInput = {
    ...(query.city_id === undefined ? {} : { cityId: query.city_id }),
    ...(query.listed === undefined ? {} : { isListed: query.listed === 'true' }),
    ...suspendedFilter,
    ...(query.badge ? { verification: { badge: query.badge } } : {}),
    /**
     * The entry-approval queue.
     *
     * Empty unless the city flag is on, which is exactly the intended behaviour:
     * the feature exists, costs nothing when off, and needs no separate "is it
     * enabled" branch in the console.
     */
    ...(query.pending_approval === 'true'
      ? { entryApprovedAt: null, city: { requireEntryApproval: true } }
      : {}),
    ...(query.q
      ? {
          OR: [
            { displayName: { contains: query.q, mode: 'insensitive' } },
            { user: { phone: { contains: query.q } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.providerProfile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      select: {
        userId: true,
        displayName: true,
        cityId: true,
        isListed: true,
        completenessScore: true,
        suspendedUntil: true,
        suspensionReason: true,
        user: { select: { phone: true, status: true } },
        verification: { select: { badge: true } },
        stats: { select: { trustScore: true, settledJobsCount: true, avgStars: true } },
      },
    }),
    prisma.providerProfile.count({ where }),
  ]);

  return { rows, total };
}

/**
 * Everything the provider page shows, in one round trip.
 *
 * One endpoint rather than six because this is the screen where most ops phone
 * calls get answered — a technician is on the line asking why they cannot get
 * work, and six sequential spinners is not an answer.
 */
export function findProviderAggregate(prisma: PrismaClient, providerId: string) {
  return prisma.providerProfile.findUnique({
    where: { userId: providerId },
    select: {
      userId: true,
      displayName: true,
      bio: true,
      yearsExperience: true,
      cityId: true,
      serviceRadiusKm: true,
      isListed: true,
      completenessScore: true,
      entryApprovedAt: true,
      suspendedUntil: true,
      suspendedAt: true,
      suspensionReason: true,
      createdAt: true,
      user: {
        select: { id: true, phone: true, name: true, status: true, preferredLanguage: true },
      },
      city: { select: { id: true, name: true, requireEntryApproval: true } },
      verification: {
        select: { badge: true, levelsPassed: true, badgeSince: true, updatedAt: true },
      },
      stats: true,
      skills: { select: { categoryId: true, category: { select: { nameKey: true } } } },
      priceCards: {
        where: { isActive: true },
        select: { id: true, title: true, priceType: true, amountPaise: true, categoryId: true },
      },
      verificationCases: {
        orderBy: { openedAt: 'desc' },
        take: 10,
        select: { id: true, level: true, status: true, openedAt: true, closedAt: true },
      },
    },
  });
}

export function recentBookingsForProvider(prisma: PrismaClient, providerId: string, take: number) {
  return prisma.booking.findMany({
    where: { providerId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      status: true,
      startsAt: true,
      payablePaise: true,
      createdAt: true,
      category: { select: { nameKey: true } },
    },
  });
}

/** Both sides of the wallet, straight from the view — no cached balance exists. */
export async function providerBalance(
  prisma: PrismaClient,
  providerId: string,
): Promise<{ payablePaise: number; duesPaise: number; netPaise: number }> {
  const rows = await prisma.$queryRaw<
    { payable_paise: bigint; dues_paise: bigint; net_paise: bigint }[]
  >`
    SELECT payable_paise, dues_paise, net_paise
    FROM provider_balances
    WHERE provider_id = ${providerId}::uuid
  `;

  const row = rows[0];

  return {
    payablePaise: Number(row?.payable_paise ?? 0),
    duesPaise: Number(row?.dues_paise ?? 0),
    netPaise: Number(row?.net_paise ?? 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Bookings                                                                   */
/* -------------------------------------------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listBookings(prisma: PrismaClient, query: ListBookingsQuery) {
  /**
   * One search box, three kinds of input.
   *
   * Ops paste whatever they were given: a booking id from a support ticket, or
   * the phone number the person on the line just read out. Making them choose a
   * field first is a step that exists only for the database's benefit.
   */
  const search: Prisma.BookingWhereInput | undefined = query.q
    ? UUID_RE.test(query.q)
      ? { id: query.q }
      : {
          OR: [
            { customer: { phone: { contains: query.q } } },
            { provider: { user: { phone: { contains: query.q } } } },
          ],
        }
    : undefined;

  const where: Prisma.BookingWhereInput = {
    ...(search ?? {}),
    ...(query.status ? { status: query.status as Prisma.EnumBookingStatusFilter } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      select: {
        id: true,
        status: true,
        startsAt: true,
        payablePaise: true,
        createdAt: true,
        customer: { select: { id: true, name: true, phone: true } },
        provider: { select: { userId: true, displayName: true } },
        category: { select: { nameKey: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  return { rows, total };
}

/**
 * Everything that ever happened to one booking.
 *
 * The dispute screen. When a customer says they were overcharged and a
 * technician says they were not, this is the only page that settles it — the
 * event log, the quotes, the money, and what each side was actually told.
 */
export function findBookingTimeline(prisma: PrismaClient, bookingId: string) {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      problemNote: true,
      addressSnapshot: true,
      visitFeePaise: true,
      payablePaise: true,
      payableBreakdown: true,
      priceCardAmountPaise: true,
      createdAt: true,
      customer: { select: { id: true, name: true, phone: true } },
      provider: { select: { userId: true, displayName: true, user: { select: { phone: true } } } },
      category: { select: { nameKey: true } },
      events: { orderBy: { createdAt: 'asc' } },
      quotations: { orderBy: { version: 'asc' }, include: { items: true } },
      payments: {
        orderBy: { createdAt: 'asc' },
        include: { refunds: { orderBy: { createdAt: 'asc' } } },
      },
      reviews: { orderBy: { createdAt: 'asc' } },
      complaints: { orderBy: { createdAt: 'asc' } },
    },
  });
}

/** What each side was told, so "nobody informed me" is answerable. */
export function notificationsForBooking(prisma: PrismaClient, bookingId: string) {
  return prisma.notification.findMany({
    where: { aggregateId: bookingId },
    orderBy: { createdAt: 'asc' },
    include: { deliveries: true, user: { select: { id: true, name: true } } },
  });
}

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

export async function listJournals(prisma: PrismaClient, query: ListJournalsQuery) {
  const where: Prisma.LedgerJournalWhereInput = {
    ...(query.journal_type ? { journalType: query.journal_type } : {}),
    ...(query.booking_id ? { bookingId: query.booking_id } : {}),
    ...(query.provider_id
      ? { entries: { some: { account: { ownerId: query.provider_id, ownerType: 'provider' } } } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.ledgerJournal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      select: {
        id: true,
        journalType: true,
        memo: true,
        bookingId: true,
        paymentId: true,
        createdAt: true,
        _count: { select: { entries: true } },
      },
    }),
    prisma.ledgerJournal.count({ where }),
  ]);

  return { rows, total };
}

export function findJournal(prisma: PrismaClient, journalId: string) {
  return prisma.ledgerJournal.findUnique({
    where: { id: journalId },
    include: {
      entries: {
        orderBy: { direction: 'asc' },
        include: { account: { select: { accountType: true, ownerType: true, ownerId: true } } },
      },
    },
  });
}

export async function listPayoutBatches(prisma: PrismaClient, page: number, pageSize: number) {
  const [rows, total] = await Promise.all([
    prisma.payoutBatch.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        windowEnd: true,
        totalPaise: true,
        payoutCount: true,
        createdAt: true,
        completedAt: true,
      },
    }),
    prisma.payoutBatch.count(),
  ]);

  return { rows, total };
}

/* -------------------------------------------------------------------------- */
/* Parked queues                                                              */
/* -------------------------------------------------------------------------- */

/**
 * "Parked" means the retry budget is spent, not that the row was dropped.
 *
 * Every one of these three tables keeps its failures. That was a deliberate
 * choice in Phases 6, 8 and 10 — a message nobody could send is a fact for a
 * human, not something to delete — and this is the human finally getting to see
 * them.
 */
export async function listParkedOutbox(
  prisma: PrismaClient,
  maxAttempts: number,
  page: number,
  pageSize: number,
) {
  const where: Prisma.OutboxEventWhereInput = {
    processedAt: null,
    attempts: { gte: maxAttempts },
  };

  const [rows, total] = await Promise.all([
    prisma.outboxEvent.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.outboxEvent.count({ where }),
  ]);

  return { rows, total };
}

export async function listFailedWebhooks(prisma: PrismaClient, page: number, pageSize: number) {
  const where: Prisma.WebhookEventWhereInput = {
    OR: [{ processingError: { not: null } }, { processedAt: null }],
  };

  const [rows, total] = await Promise.all([
    prisma.webhookEvent.findMany({
      where,
      orderBy: { receivedAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.webhookEvent.count({ where }),
  ]);

  return { rows, total };
}

export async function listParkedDeliveries(
  prisma: PrismaClient,
  maxAttempts: number,
  page: number,
  pageSize: number,
) {
  const where: Prisma.NotificationDeliveryWhereInput = {
    status: 'failed',
    attempts: { gte: maxAttempts },
  };

  const [rows, total] = await Promise.all([
    prisma.notificationDelivery.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        notification: { select: { topic: true, titleKey: true, criticality: true } },
        recipient: { select: { id: true, name: true } },
      },
    }),
    prisma.notificationDelivery.count({ where }),
  ]);

  return { rows, total };
}

/* -------------------------------------------------------------------------- */
/* Audit log                                                                  */
/* -------------------------------------------------------------------------- */

export async function listAuditLogs(prisma: PrismaClient, query: ListAuditQuery) {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.actor_user_id ? { actorUserId: query.actor_user_id } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.target_type ? { targetType: query.target_type } : {}),
    ...(query.target_id ? { targetId: query.target_id } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      include: { actor: { select: { id: true, name: true, phone: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { rows, total };
}
