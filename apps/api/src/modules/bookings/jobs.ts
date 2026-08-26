import type { AppContext } from '../../core/context';
import type { JobDefinition } from '../../core/jobs';
import * as repo from './repository';
import { expireBooking, type BookingDeps } from './service';
import { generateSlotsForAllProviders } from './slots-service';

/**
 * The two pieces of background work Phase 6 needs.
 *
 * Both take an injected clock rather than reading `new Date()` internally. That
 * is what lets a test fast-forward fifteen minutes without waiting fifteen
 * minutes, and it is the reason neither of these functions is a closure over
 * wall time.
 */

export interface JobDeps {
  context: AppContext;
  now?: () => Date;
}

const nowOf = (deps: JobDeps): Date => (deps.now ? deps.now() : new Date());

/** How many stale requests one sweep will expire. Keeps a backlog from stalling a run. */
export const EXPIRY_BATCH_SIZE = 100;

export interface ExpirySweepResult {
  found: number;
  expired: number;
}

/**
 * Expires requests nobody answered.
 *
 * Each booking is expired independently and a failure on one does not abandon
 * the rest: an unexpirable booking is a bug to investigate, not a reason to hold
 * a hundred slots hostage. The slot is released back to `open` by the transition
 * itself, inside the same transaction as the event.
 */
export async function sweepExpiredRequests(deps: JobDeps): Promise<ExpirySweepResult> {
  const { context } = deps;
  const at = nowOf(deps);
  const cutoff = new Date(at.getTime() - context.config.BOOKING_REQUEST_TTL_MINUTES * 60 * 1000);

  const stale = await repo.findExpiredRequests(context.prisma, cutoff, at, EXPIRY_BATCH_SIZE);
  const bookingDeps: BookingDeps = deps.now ? { context, now: deps.now } : { context };

  let expired = 0;

  for (const booking of stale) {
    try {
      await expireBooking(bookingDeps, booking.id);
      expired += 1;
    } catch (error) {
      // A booking answered between the query and the transition is the common
      // case here, and it is not a failure — the log simply moved on.
      context.logger.warn({ err: error, bookingId: booking.id }, 'expiry: booking not expired');
    }
  }

  if (stale.length > 0) {
    context.logger.info({ found: stale.length, expired, cutoff }, 'expiry sweep complete');
  }

  return { found: stale.length, expired };
}

export function createBookingJobs(context: AppContext): JobDefinition[] {
  return [
    {
      name: 'booking-expiry',
      intervalMs: context.config.BOOKING_EXPIRY_JOB_INTERVAL_MS,
      // Comfortably longer than a sweep of EXPIRY_BATCH_SIZE, so the lock does
      // not expire under a backlog and let a second instance double-sweep.
      lockTtlMs: Math.max(30_000, context.config.BOOKING_EXPIRY_JOB_INTERVAL_MS * 3),
      run: async () => {
        await sweepExpiredRequests({ context });
      },
    },
    {
      name: 'slot-horizon',
      intervalMs: context.config.SLOT_HORIZON_JOB_INTERVAL_MS,
      // Minutes, not seconds: this walks every listed provider.
      lockTtlMs: 10 * 60 * 1000,
      run: async () => {
        await generateSlotsForAllProviders(context);
      },
    },
  ];
}
