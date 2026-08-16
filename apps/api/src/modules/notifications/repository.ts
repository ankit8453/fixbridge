import { Prisma } from '@prisma/client';
import type {
  Notification,
  NotificationChannel,
  NotificationCriticality,
  NotificationDelivery,
  NotificationDeliveryStatus,
  PrismaClient,
} from '@prisma/client';

/**
 * All database access for notifications. Nothing else touches these two tables.
 */

export interface DeliveryPlan {
  channel: NotificationChannel;
  transport: string;
  status: NotificationDeliveryStatus;
  scheduledFor: Date | null;
}

export interface CreateNotificationInput {
  userId: string;
  topic: string;
  aggregateId: string;
  titleKey: string;
  bodyKey: string;
  params: Prisma.InputJsonValue;
  deepLink: string | null;
  criticality: NotificationCriticality;
  deliveries: DeliveryPlan[];
}

export type DeliveryWithNotification = NotificationDelivery & { notification: Notification };

/**
 * Whether an insert lost the idempotency race.
 *
 * Matched on the **columns**, not the index name: Prisma reports a P2002 as the
 * field list and never names the index, a lesson this codebase learned the
 * expensive way in Phase 7 when a lost quotation race returned 500 instead of
 * 409.
 */
export function isDuplicateDelivery(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  const target = error.meta?.target;
  const columns = Array.isArray(target) ? target.map(String) : [String(target ?? '')];

  return columns.some(
    (column) => column.includes('aggregate_id') || column.includes('aggregateId'),
  );
}

/**
 * Has this person already been told about this event?
 *
 * One query answers it for every channel at once, because a notification and all
 * its deliveries are written in one transaction — so if any row exists, the
 * whole thing was already done and the only question left is whether the
 * external sends finished.
 */
export function existingDeliveries(
  prisma: PrismaClient,
  topic: string,
  aggregateId: string,
  recipientUserId: string,
): Promise<NotificationDelivery[]> {
  return prisma.notificationDelivery.findMany({
    where: { topic, aggregateId, recipientUserId },
    orderBy: { channel: 'asc' },
  });
}

export async function createNotificationWithDeliveries(
  prisma: PrismaClient,
  input: CreateNotificationInput,
): Promise<{ notification: Notification; deliveries: NotificationDelivery[] }> {
  return prisma.$transaction(async (tx) => {
    const notification = await tx.notification.create({
      data: {
        userId: input.userId,
        topic: input.topic,
        aggregateId: input.aggregateId,
        titleKey: input.titleKey,
        bodyKey: input.bodyKey,
        params: input.params,
        deepLink: input.deepLink,
        criticality: input.criticality,
      },
    });

    const deliveries: NotificationDelivery[] = [];

    for (const plan of input.deliveries) {
      deliveries.push(
        await tx.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            topic: input.topic,
            aggregateId: input.aggregateId,
            recipientUserId: input.userId,
            channel: plan.channel,
            transport: plan.transport,
            status: plan.status,
            scheduledFor: plan.scheduledFor,
            // An in-app row is delivered by existing. Nothing has to happen next.
            sentAt: plan.status === 'sent' ? new Date() : null,
          },
        }),
      );
    }

    return { notification, deliveries };
  });
}

export function markDeliverySent(
  prisma: PrismaClient,
  deliveryId: string,
  transportRef: string,
  at: Date,
): Promise<NotificationDelivery> {
  return prisma.notificationDelivery.update({
    where: { id: deliveryId },
    data: {
      status: 'sent',
      transportRef,
      sentAt: at,
      attempts: { increment: 1 },
      lastError: null,
      scheduledFor: null,
    },
  });
}

export function markDeliveryFailed(
  prisma: PrismaClient,
  deliveryId: string,
  error: string,
): Promise<NotificationDelivery> {
  return prisma.notificationDelivery.update({
    where: { id: deliveryId },
    data: { status: 'failed', attempts: { increment: 1 }, lastError: error.slice(0, 1000) },
  });
}

/**
 * Held messages whose window has opened.
 *
 * Ordered oldest first so a backlog drains in the order it accumulated — waking
 * up to eleven messages in reverse chronological order tells the story backwards.
 */
export function dueHeldDeliveries(
  prisma: PrismaClient,
  at: Date,
  limit: number,
): Promise<DeliveryWithNotification[]> {
  return prisma.notificationDelivery.findMany({
    where: { status: 'suppressed_quiet_hours', scheduledFor: { lte: at } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { notification: true },
  });
}

export function findDelivery(
  prisma: PrismaClient,
  deliveryId: string,
): Promise<DeliveryWithNotification | null> {
  return prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { notification: true },
  });
}

/* -------------------------------------------------------------------------- */
/* The inbox                                                                  */
/* -------------------------------------------------------------------------- */

export async function listInbox(
  prisma: PrismaClient,
  userId: string,
  page: number,
  pageSize: number,
  unreadOnly: boolean,
): Promise<{ rows: Notification[]; total: number }> {
  const where = { userId, ...(unreadOnly ? { readAt: null } : {}) };

  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notification.count({ where }),
  ]);

  return { rows, total };
}

export function unreadCount(prisma: PrismaClient, userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/**
 * Marks one as read, scoped to the owner.
 *
 * `updateMany` rather than `update` so somebody else's id is a no-op rather than
 * a 500 — and the count tells the caller which it was.
 */
export async function markRead(
  prisma: PrismaClient,
  userId: string,
  notificationId: string,
  at: Date,
): Promise<boolean> {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: at },
  });

  return result.count > 0;
}

export async function markAllRead(prisma: PrismaClient, userId: string, at: Date): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: at },
  });

  return result.count;
}

/** The recipient's language and phone — everything a send needs about a person. */
export function findRecipient(prisma: PrismaClient, userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, phone: true, preferredLanguage: true, status: true },
  });
}

export function setPreferredLanguage(prisma: PrismaClient, userId: string, language: 'hi' | 'en') {
  return prisma.user.update({
    where: { id: userId },
    data: { preferredLanguage: language },
  });
}
