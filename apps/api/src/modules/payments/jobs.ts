import type { AppContext } from '../../core/context';
import type { JobDefinition } from '../../core/jobs';
import type { DeliveredEvent, OutboxRegistry } from '../../core/outbox';
import { BOOKING_TOPICS } from '../bookings/state-machine';
import { buildPayoutBatch } from './payouts';
import { autoRefundUpfrontFee } from './refunds';

/**
 * Background money work.
 *
 * Both pieces here are the same shape as everything else in `core/jobs.ts` and
 * `core/outbox.ts`: Redis-locked, idempotent, and driveable directly with an
 * injected clock so tests never wait on a timer.
 */

/**
 * Drafts the daily payout batch.
 *
 * "T+1" in the sense that matters: a technician's money is available to pay out
 * the day after it is collected, and a run happens every day. It only ever
 * creates a **draft** — somebody still has to make the transfers and type the
 * references back in — so an automatic run can never move money on its own.
 *
 * Idempotent in the way that counts: the batch snapshots current balances, and a
 * balance only drops when a payout is marked paid. A second run on the same day
 * drafts whatever is still outstanding rather than paying anybody twice.
 */
export function createPayoutJobs(context: AppContext): JobDefinition[] {
  return [
    {
      name: 'payout-batch',
      intervalMs: 24 * 60 * 60 * 1000,
      // Minutes: this walks every technician with a balance.
      lockTtlMs: 15 * 60 * 1000,
      run: async () => {
        const result = await buildPayoutBatch({ context }, null);

        if (result.batchId) {
          context.logger.info(
            { batchId: result.batchId, totalPaise: result.totalPaise },
            'payout batch drafted by the daily job; awaiting ops',
          );
        }
      },
    },
  ];
}

/**
 * Returns an upfront visit fee when the booking ends without a visit.
 *
 * Only does anything when `COLLECT_FEE_AT_BOOKING` is on, which it is not for
 * the pilot. It is wired and tested anyway because a fee taken for a visit that
 * never happened must come back **without the customer having to ask** — and if
 * that only gets built at the same time as the flag gets flipped, it gets built
 * in a hurry.
 *
 * Subscribed to the endings where nobody turned up. `CLOSED_QUOTE_DECLINED` is
 * deliberately absent: the technician did turn up, so the visit fee was earned.
 */
export function registerUpfrontFeeRefunder(registry: OutboxRegistry, context: AppContext): void {
  const handler = async (event: DeliveredEvent): Promise<void> => {
    const outcome = await autoRefundUpfrontFee(context, event.aggregateId);

    if (outcome === 'refunded') {
      context.logger.info(
        { bookingId: event.aggregateId, topic: event.topic },
        'upfront visit fee returned: the booking ended before anybody visited',
      );
    }
  };

  for (const topic of [
    BOOKING_TOPICS.cancelled_by_customer,
    BOOKING_TOPICS.cancelled_by_provider,
    BOOKING_TOPICS.expired,
    BOOKING_TOPICS.rejected,
  ]) {
    registry.subscribe(topic, handler);
  }
}
