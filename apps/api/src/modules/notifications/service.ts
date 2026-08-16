import type { Locale } from '@fixbridge/shared';
import type {
  Notification,
  NotificationChannel,
  NotificationDelivery,
  Prisma,
} from '@prisma/client';
import type { AppContext } from '../../core/context';
import { translate } from '../../core/i18n';
import type { DeliveredEvent, OutboxRegistry } from '../../core/outbox';
import type { MessageTransport } from './transports';
import { materialise, parseStoredParams, type NotificationParams } from './params';
import * as repo from './repository';
import { isQuietHour, nextWindowOpen, type QuietHoursConfig } from './quiet-hours';
import { canRender, positionalParams, renderDeepLink, renderMessage } from './render';
import {
  NOTIFICATION_ROUTES,
  registerRoute,
  routeFor,
  routedTopics,
  type AudienceRoute,
  type NotificationRoute,
} from './routing';
import { resolveSubject } from './subject';
import {
  TEMPLATES,
  bodyKeyOf,
  templateIdFromBodyKey,
  titleKeyOf,
  type TemplateId,
} from './templates';

/**
 * The one consumer that turns events into messages.
 *
 * It subscribes to every topic in the routing table and does the same four
 * things for each: work out who cares, work out what to tell them, write the
 * inbox row and the per-channel delivery rows in one transaction, then send.
 *
 * ## Idempotency
 *
 * The outbox is at-least-once, so this will be called twice for the same event.
 * A projection can shrug that off; a message cannot, because the human sees it
 * twice. Two things stop that:
 *
 *   1. The unique index on `(topic, aggregate_id, recipient_user_id, channel)`.
 *      A redelivery finds the rows already there and does not write new ones.
 *   2. Delivery status. A row that is already `sent` is never sent again, so a
 *      redelivery that *does* find work — because the vendor was down first time
 *      — resends only the channel that actually failed.
 *
 * Together they mean a replay is free and a partial failure is resumable, which
 * is the behaviour the outbox's contract actually requires.
 */

export interface NotificationDeps {
  context: AppContext;
  now?: () => Date;
}

const nowOf = (deps: NotificationDeps): Date => (deps.now ? deps.now() : new Date());

function quietHoursOf(context: AppContext): QuietHoursConfig {
  return {
    startHour: context.config.QUIET_HOURS_START_IST,
    endHour: context.config.QUIET_HOURS_END_IST,
  };
}

function transportFor(context: AppContext, channel: NotificationChannel): MessageTransport | null {
  if (channel === 'sms') return context.messaging.sms;
  if (channel === 'whatsapp') return context.messaging.whatsapp;

  // in_app has no transport, deliberately — the row is the delivery.
  return null;
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

interface PlannedDelivery {
  channel: NotificationChannel;
  transport: string;
  status: 'sent' | 'queued' | 'suppressed_quiet_hours';
  scheduledFor: Date | null;
}

/**
 * What happens to one channel, right now.
 *
 * In-app is delivered by existing: writing the row *is* putting it in front of
 * the person, and it does not buzz anything, so quiet hours never apply to it.
 * A critical message ignores quiet hours by definition — that is what the class
 * means. Everything else that lands in the window is held, with the exact
 * instant it will go out recorded on the row.
 */
export function planDelivery(
  channel: NotificationChannel,
  criticality: 'critical' | 'standard',
  at: Date,
  quiet: QuietHoursConfig,
  transportName: string,
): PlannedDelivery {
  if (channel === 'in_app') {
    return { channel, transport: 'in_app', status: 'sent', scheduledFor: null };
  }

  if (criticality === 'standard' && isQuietHour(at, quiet)) {
    return {
      channel,
      transport: transportName,
      status: 'suppressed_quiet_hours',
      scheduledFor: nextWindowOpen(at, quiet),
    };
  }

  return { channel, transport: transportName, status: 'queued', scheduledFor: null };
}

/**
 * Picks the template, degrading rather than failing when a parameter is absent.
 *
 * Only one route uses this today — an accepted booking whose start OTP has
 * already expired out of Redis — but it is declared on the route rather than
 * coded here, so the next one costs nothing.
 */
function chooseTemplate(audience: AudienceRoute, params: NotificationParams): TemplateId {
  const primary = audience.template;
  const rendered = materialise(params, 'hi');

  if (canRender(primary, rendered)) return primary;
  if (audience.fallbackTemplate) return audience.fallbackTemplate;

  return primary;
}

/* -------------------------------------------------------------------------- */
/* The handler                                                                */
/* -------------------------------------------------------------------------- */

export async function handleNotificationEvent(
  deps: NotificationDeps,
  event: DeliveredEvent,
): Promise<void> {
  const { context } = deps;
  const route = routeFor(event.topic);

  if (!route) {
    // Normal, not exceptional: most of what this system publishes is for
    // projections rather than for people.
    context.logger.debug({ topic: event.topic }, 'notifications: topic is not routed');
    return;
  }

  const subject = await resolveSubject(context, event);

  if (!subject) {
    context.logger.debug(
      { topic: event.topic, aggregateId: event.aggregateId },
      'notifications: could not resolve who this event is about',
    );
    return;
  }

  const failures: unknown[] = [];

  for (const audience of route.audiences) {
    try {
      await notifyAudience(deps, event, route, audience, subject.recipients, subject.params);
    } catch (error) {
      // One audience failing must not silence the other. Collected and rethrown
      // below so the outbox still backs off and retries the whole event.
      failures.push(error);
    }
  }

  if (failures.length > 0) throw failures[0];
}

async function notifyAudience(
  deps: NotificationDeps,
  event: DeliveredEvent,
  route: NotificationRoute,
  audience: AudienceRoute,
  recipients: Partial<Record<string, string>>,
  params: NotificationParams,
): Promise<void> {
  const { context } = deps;
  const userId = recipients[audience.role];

  if (!userId) {
    context.logger.debug(
      { topic: event.topic, role: audience.role },
      'notifications: no recipient for this role on this event',
    );
    return;
  }

  const recipient = await repo.findRecipient(context.prisma, userId);
  if (!recipient) return;

  const existing = await repo.existingDeliveries(
    context.prisma,
    event.topic,
    event.aggregateId,
    userId,
  );

  if (existing.length > 0) {
    // A redelivery. Everything was written the first time; the only question is
    // whether an external send is still outstanding.
    await resumeDeliveries(deps, existing, recipient);
    return;
  }

  const templateId = chooseTemplate(audience, params);
  const spec = TEMPLATES[templateId];
  const quiet = quietHoursOf(context);
  const at = nowOf(deps);

  const planned = audience.channels.map((channel) => {
    const transport = transportFor(context, channel as NotificationChannel);
    return planDelivery(
      channel as NotificationChannel,
      route.criticality,
      at,
      quiet,
      transport?.name ?? 'in_app',
    );
  });

  let created;

  try {
    created = await repo.createNotificationWithDeliveries(context.prisma, {
      userId,
      topic: event.topic,
      aggregateId: event.aggregateId,
      titleKey: titleKeyOf(spec),
      bodyKey: bodyKeyOf(spec),
      params: params as unknown as Prisma.InputJsonValue,
      deepLink: renderDeepLink(audience.deepLink, materialise(params, 'hi')),
      criticality: route.criticality,
      deliveries: planned,
    });
  } catch (error) {
    if (repo.isDuplicateDelivery(error)) {
      // Two dispatchers raced. The other one won; it will do the sending.
      context.logger.debug(
        { topic: event.topic, userId },
        'notifications: duplicate delivery refused by the database',
      );
      return;
    }

    throw error;
  }

  await resumeDeliveries(deps, created.deliveries, recipient);
}

interface Recipient {
  id: string;
  phone: string;
  preferredLanguage: Locale;
}

/**
 * Sends whatever has not been sent.
 *
 * Called both on the first pass and on every redelivery, which is what makes a
 * half-successful event resumable: the WhatsApp that went out stays `sent`, and
 * only the SMS the vendor rejected is tried again.
 */
async function resumeDeliveries(
  deps: NotificationDeps,
  deliveries: NotificationDelivery[],
  recipient: Recipient,
): Promise<void> {
  const { context } = deps;
  const maxAttempts = context.config.NOTIFY_MAX_ATTEMPTS;
  let firstError: unknown;

  for (const delivery of deliveries) {
    if (delivery.status === 'sent' || delivery.status === 'suppressed_quiet_hours') continue;
    if (delivery.attempts >= maxAttempts) continue;

    try {
      await sendDelivery(deps, delivery, recipient);
    } catch (error) {
      firstError ??= error;
    }
  }

  if (firstError) throw firstError;
}

/**
 * One external send.
 *
 * Throws while the delivery is still worth retrying, so the outbox's existing
 * backoff does the waiting — there is no second retry machine here. Once the
 * attempt budget is spent it stops throwing and the row is left `failed` for
 * Phase 11's parked-deliveries view: a message nobody can send is a fact for
 * ops, not a reason to keep the whole event circling forever.
 */
export async function sendDelivery(
  deps: NotificationDeps,
  delivery: NotificationDelivery,
  recipient: Recipient,
): Promise<void> {
  const { context } = deps;
  const transport = transportFor(context, delivery.channel);

  if (!transport) {
    // in_app somehow left unsent. Existing is delivered; make the row say so.
    await repo.markDeliverySent(context.prisma, delivery.id, 'in_app', nowOf(deps));
    return;
  }

  const notification =
    (await context.prisma.notification.findUnique({ where: { id: delivery.notificationId } })) ??
    null;

  if (!notification) return;

  try {
    const { message, params, templateId } = renderFor(notification, recipient.preferredLanguage);

    const result = await transport.send(recipient.phone, message, {
      channel: delivery.channel,
      criticality: notification.criticality,
      topic: delivery.topic,
      notificationId: notification.id,
      deliveryId: delivery.id,
      templateStem: message.templateStem,
      params: templateId ? positionalParams(templateId, params) : [],
    });

    await repo.markDeliverySent(context.prisma, delivery.id, result.transportRef, nowOf(deps));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await repo.markDeliveryFailed(context.prisma, delivery.id, message);

    if (updated.attempts >= context.config.NOTIFY_MAX_ATTEMPTS) {
      context.logger.error(
        {
          deliveryId: delivery.id,
          channel: delivery.channel,
          attempts: updated.attempts,
          err: error,
        },
        'notification parked after max attempts',
      );
      return;
    }

    context.logger.warn(
      { deliveryId: delivery.id, channel: delivery.channel, attempts: updated.attempts },
      'notification send failed, will retry',
    );

    throw error;
  }
}

/** Stored keys + stored parameters + a language → the sentence. */
export function renderFor(notification: Notification, language: Locale) {
  const stored = parseStoredParams(notification.params);
  const params = materialise(stored, language);
  const templateId = templateIdFromBodyKey(notification.bodyKey);

  const vars = params as Record<string, string | number>;

  const message = templateId
    ? renderMessage(templateId, params, language)
    : {
        /**
         * A template that no longer exists in code — a rename, or a route
         * withdrawn. The inbox still renders straight from the stored keys,
         * because a person's history should not develop holes when we tidy up.
         */
        title: translate(language, notification.titleKey, vars),
        body: translate(language, notification.bodyKey, vars),
        templateStem: notification.bodyKey,
        language,
      };

  return { message, params, templateId };
}

/* -------------------------------------------------------------------------- */
/* Quiet-hours release                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Sends everything whose window has opened.
 *
 * Run on a timer, Redis-locked like every other job. Deliberately batched and
 * ordered oldest-first: waking up to eleven held messages in reverse order tells
 * the story backwards.
 */
export async function releaseHeldDeliveries(deps: NotificationDeps): Promise<number> {
  const { context } = deps;
  const at = nowOf(deps);

  const due = await repo.dueHeldDeliveries(context.prisma, at, context.config.OUTBOX_BATCH_SIZE);
  let released = 0;

  for (const delivery of due) {
    const recipient = await repo.findRecipient(context.prisma, delivery.recipientUserId);
    if (!recipient) continue;

    try {
      // Cleared out of the held state first, so a send that throws lands in the
      // normal retry path rather than being picked up by this job forever.
      const promoted = await context.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: 'queued' },
      });

      await sendDelivery(deps, promoted, recipient);
      released += 1;
    } catch (error) {
      context.logger.warn(
        { deliveryId: delivery.id, err: error },
        'notifications: held delivery failed on release',
      );
    }
  }

  if (released > 0) {
    context.logger.info({ released }, 'quiet-hours: held notifications released');
  }

  return released;
}

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

export function registerNotificationConsumer(registry: OutboxRegistry, context: AppContext): void {
  const handler = (event: DeliveredEvent): Promise<void> =>
    handleNotificationEvent({ context }, event);

  for (const topic of routedTopics()) {
    registry.subscribe(topic, handler);
  }

  context.logger.info(
    { topics: Object.keys(NOTIFICATION_ROUTES).length },
    'notification routes wired',
  );
}

/**
 * Adds a route and subscribes it, in one call.
 *
 * This is the whole "adding a notification takes no code" claim in one function:
 * a table row and two locale strings. The test that proves it registers a topic
 * this codebase has never heard of and asserts the message arrives — which is
 * the only honest way to check, because every route already in the table was
 * written by somebody who could also have edited the consumer.
 */
export function registerNotificationRoute(
  registry: OutboxRegistry,
  context: AppContext,
  topic: string,
  route: NotificationRoute,
): void {
  registerRoute(topic, route);
  registry.subscribe(topic, (event) => handleNotificationEvent({ context }, event));
}

/* -------------------------------------------------------------------------- */
/* The inbox                                                                  */
/* -------------------------------------------------------------------------- */

export interface NotificationView {
  id: string;
  topic: string;
  title: string;
  body: string;
  deepLink: string | null;
  criticality: 'critical' | 'standard';
  read: boolean;
  createdAt: string;
}

export function toNotificationView(notification: Notification, language: Locale): NotificationView {
  const { message } = renderFor(notification, language);

  return {
    id: notification.id,
    topic: notification.topic,
    title: message.title,
    body: message.body,
    deepLink: notification.deepLink,
    criticality: notification.criticality,
    read: notification.readAt !== null,
    createdAt: notification.createdAt.toISOString(),
  };
}

/**
 * The inbox, rendered in the reader's **preferred language** rather than in the
 * request's `Accept-Language`.
 *
 * Deliberate: this is the same setting that governs the WhatsApp copy of the
 * same message, and an inbox that disagreed with the message somebody already
 * received on their phone would read as two different notifications.
 */
export async function listNotifications(
  deps: NotificationDeps,
  userId: string,
  query: { page: number; pageSize: number; unreadOnly: boolean },
): Promise<{
  notifications: NotificationView[];
  page: number;
  pageSize: number;
  total: number;
  unread: number;
}> {
  const { context } = deps;

  const recipient = await repo.findRecipient(context.prisma, userId);
  const language = (recipient?.preferredLanguage ?? 'hi') as Locale;

  const [{ rows, total }, unread] = await Promise.all([
    repo.listInbox(context.prisma, userId, query.page, query.pageSize, query.unreadOnly),
    repo.unreadCount(context.prisma, userId),
  ]);

  return {
    notifications: rows.map((row) => toNotificationView(row, language)),
    page: query.page,
    pageSize: query.pageSize,
    total,
    unread,
  };
}

export function unreadCount(deps: NotificationDeps, userId: string): Promise<number> {
  return repo.unreadCount(deps.context.prisma, userId);
}

export function markRead(
  deps: NotificationDeps,
  userId: string,
  notificationId: string,
): Promise<boolean> {
  return repo.markRead(deps.context.prisma, userId, notificationId, nowOf(deps));
}

export function markAllRead(deps: NotificationDeps, userId: string): Promise<number> {
  return repo.markAllRead(deps.context.prisma, userId, nowOf(deps));
}
