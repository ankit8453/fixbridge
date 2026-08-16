import type { AppContext } from '../../core/context';
import type { JobDefinition } from '../../core/jobs';
import { releaseHeldDeliveries } from './service';

/**
 * The quiet-hours release job.
 *
 * Redis-locked like every other job, and idempotent: it moves a held delivery to
 * `queued` before sending, so a lock that expires mid-run cannot make two
 * instances send the same message twice.
 *
 * Five minutes rather than one. Nothing held here is urgent by definition — if
 * it were, it would be `critical` and would never have been held — and a message
 * arriving at 07:03 instead of 07:00 costs nobody anything.
 */
export function createNotificationJobs(context: AppContext): JobDefinition[] {
  return [
    {
      name: 'notification-release',
      intervalMs: context.config.NOTIFY_RELEASE_JOB_INTERVAL_MS,
      lockTtlMs: Math.max(30_000, context.config.NOTIFY_RELEASE_JOB_INTERVAL_MS * 2),
      async run() {
        await releaseHeldDeliveries({ context });
      },
    },
  ];
}
