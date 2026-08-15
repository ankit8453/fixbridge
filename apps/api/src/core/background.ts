import type { AppContext } from './context';
import { createJobRunner, type JobRunner } from './jobs';
import { createOutboxDispatcher, type OutboxDispatcher } from './outbox';
import { createBookingJobs } from '../modules/bookings/jobs';
import { registerAcceptanceRateProjector } from '../modules/bookings/stats';

/**
 * Everything that runs on a timer rather than in response to a request.
 *
 * Kept out of `index.ts` so a test can start the same set against a test context
 * — and, more importantly, so the shutdown path has one object to stop rather
 * than a growing list of handles scattered across boot.
 */

export interface BackgroundWorkers {
  jobs: JobRunner;
  dispatcher: OutboxDispatcher;
  start(): void;
  stop(): Promise<void>;
}

/**
 * Subscribers are registered whether or not the jobs are enabled.
 *
 * Registration is just a map insert; running is the expensive part. Splitting
 * them means a test can enqueue an event, call `dispatcher.runOnce()` directly,
 * and see the projector fire — without a timer anywhere in the test.
 */
export function registerOutboxSubscribers(context: AppContext): void {
  registerAcceptanceRateProjector(context.outbox, context);
}

export function createBackgroundWorkers(context: AppContext): BackgroundWorkers {
  const jobs = createJobRunner(context.redis, context.logger);

  const dispatcher = createOutboxDispatcher({
    prisma: context.prisma,
    redis: context.redis,
    config: context.config,
    logger: context.logger,
    registry: context.outbox,
  });

  const definitions = createBookingJobs(context);

  return {
    jobs,
    dispatcher,

    start() {
      dispatcher.start();
      jobs.start(definitions);

      /**
       * Extend the slot horizon once at boot, ahead of the first interval.
       *
       * Without this, a service that restarts more often than the job interval
       * would never materialise a slot — and "nobody can be booked" is a silent
       * failure, not a loud one. It is fire-and-forget because a slow horizon
       * extension must not delay the port binding.
       */
      const horizon = definitions.find((job) => job.name === 'slot-horizon');

      if (horizon) {
        void jobs.runOnce(horizon).catch((error: unknown) => {
          context.logger.error({ err: error }, 'slot horizon: initial run failed');
        });
      }
    },

    async stop() {
      // Jobs first: stopping the dispatcher while a job is still writing events
      // would leave them undelivered until the next process starts.
      await jobs.stop();
      await dispatcher.stop();
    },
  };
}
