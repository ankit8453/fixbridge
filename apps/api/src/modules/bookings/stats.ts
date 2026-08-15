import type { AppContext } from '../../core/context';
import type { DeliveredEvent, OutboxRegistry } from '../../core/outbox';
import * as repo from './repository';
import { BOOKING_TOPICS } from './state-machine';

/**
 * Acceptance rate — the first real consumer of the outbox, and the thing that
 * closes Phase 5's neutral default.
 */

/**
 * Below this many decided requests, the rate is `null` rather than a number.
 *
 * One rejection out of two requests is 50%, which would bury a technician who
 * joined last week under everyone with a longer record. Small samples say
 * nothing, and pretending they do would make the ranking actively unfair to new
 * supply — the exact people a young marketplace needs.
 */
export const MIN_DECIDED_REQUESTS = 5;

export const ACCEPTANCE_WINDOW_DAYS = 30;

export interface DecidedCounts {
  acceptedCount: number;
  rejectedCount: number;
  expiredCount: number;
}

/**
 * `accepted / (accepted + rejected + expired)`.
 *
 * Ignoring a request counts against a technician exactly as much as declining
 * it: from the customer's side, silence and "no" are the same wasted wait. If
 * anything, silence is worse.
 *
 * Provider cancellations are counted separately and deliberately excluded here —
 * abandoning an accepted job is a different, more serious failure, and Phase 9
 * will weigh it on its own rather than diluting it into this ratio.
 */
export function computeAcceptanceRate(counts: DecidedCounts): number | null {
  const decided = counts.acceptedCount + counts.rejectedCount + counts.expiredCount;

  if (decided < MIN_DECIDED_REQUESTS) return null;

  return counts.acceptedCount / decided;
}

/** Recomputes one provider's stats from the event log. */
export async function recomputeProviderStats(
  context: AppContext,
  providerId: string,
  now: Date = new Date(),
): Promise<number | null> {
  const since = new Date(now.getTime() - ACCEPTANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const counts = await repo.countDecidedRequests(context.prisma, providerId, since);
  const acceptanceRate = computeAcceptanceRate(counts);

  await repo.saveProviderStats(
    context.prisma,
    providerId,
    counts,
    acceptanceRate,
    ACCEPTANCE_WINDOW_DAYS,
  );

  return acceptanceRate;
}

/** Topics that could change a provider's acceptance rate. */
export const ACCEPTANCE_TOPICS: readonly string[] = [
  BOOKING_TOPICS.accepted,
  BOOKING_TOPICS.rejected,
  BOOKING_TOPICS.expired,
  BOOKING_TOPICS.cancelled_by_provider,
];

/**
 * Registers the projector.
 *
 * **Idempotent by construction**: it recomputes from the log rather than
 * incrementing a counter, so delivering the same event twice — which
 * at-least-once delivery guarantees will happen eventually — produces exactly
 * the same numbers. That property is not a nice-to-have; it is what makes the
 * outbox usable at all.
 */
export function registerAcceptanceRateProjector(
  registry: OutboxRegistry,
  context: AppContext,
): void {
  const handler = async (event: DeliveredEvent): Promise<void> => {
    const booking = await context.prisma.booking.findUnique({
      where: { id: event.aggregateId },
      select: { providerId: true },
    });

    // A booking erased between emission and delivery is not an error.
    if (!booking) return;

    const rate = await recomputeProviderStats(context, booking.providerId);

    context.logger.debug(
      { providerId: booking.providerId, topic: event.topic, acceptanceRate: rate },
      'provider stats recomputed',
    );
  };

  for (const topic of ACCEPTANCE_TOPICS) {
    registry.subscribe(topic, handler);
  }
}
