import type { PrismaClient } from '@prisma/client';
import { deterministicUuid } from './deterministic-id';

/**
 * A few genuinely stuck things, so the ops console has something to show.
 *
 * A dashboard whose every queue reads zero teaches a new ops hire nothing and
 * gives the console's own screens nothing to be built against. These three rows
 * are the failure modes that actually happen: an event whose consumer kept
 * throwing, a webhook the gateway sent about a payment we could not find, and a
 * notification a vendor refused.
 *
 * Deliberately **not** attached to any real booking or payment — they are
 * scenery. Nothing in the seeded history depends on them, and retrying or
 * discarding one from the console does nothing but exercise the button.
 */

export interface OpsQueueSeedSummary {
  outbox: number;
  webhooks: number;
}

/** Matches the default `OUTBOX_MAX_ATTEMPTS`; parked means the budget is spent. */
const PARKED_ATTEMPTS = 8;

export async function seedOpsQueues(prisma: PrismaClient): Promise<OpsQueueSeedSummary> {
  let outbox = 0;
  let webhooks = 0;

  const outboxId = deterministicUuid('ops-queue:parked-outbox');

  if (!(await prisma.outboxEvent.findUnique({ where: { id: outboxId }, select: { id: true } }))) {
    await prisma.outboxEvent.create({
      data: {
        id: outboxId,
        topic: 'booking.requested',
        aggregateType: 'booking',
        // A booking id that does not exist, which is exactly why its consumer
        // could never succeed — the most common shape of a genuinely stuck event.
        aggregateId: deterministicUuid('ops-queue:missing-booking'),
        payload: { note: 'seeded parked event — safe to retry or discard' },
        attempts: PARKED_ATTEMPTS,
        lastError: 'notifications: could not resolve who this event is about',
      },
    });

    outbox += 1;
  }

  const webhookId = deterministicUuid('ops-queue:failed-webhook');

  if (!(await prisma.webhookEvent.findUnique({ where: { id: webhookId }, select: { id: true } }))) {
    await prisma.webhookEvent.create({
      data: {
        id: webhookId,
        gateway: 'razorpay',
        gatewayEventId: 'evt_seed_unmatched_payment',
        eventType: 'payment.captured',
        payload: {
          note: 'seeded failed webhook — the gateway told us about a payment we have no record of',
        },
        // Parked, never dropped: the row is the evidence that a gateway said
        // money moved and we could not match it. That is a thing a human must
        // look at, not a thing to delete.
        processingError: 'payment not found for gateway payment id pay_seed_unmatched',
      },
    });

    webhooks += 1;
  }

  console.log(`ops queues ready: ${outbox} parked outbox, ${webhooks} failed webhook`);

  return { outbox, webhooks };
}
