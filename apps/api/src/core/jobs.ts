import type Redis from 'ioredis';
import type { AppLogger } from './logger';

/**
 * In-process scheduled work.
 *
 * No external scheduler, no queue: at pilot scale a `setInterval` with a Redis
 * lock is the whole requirement, and every additional moving part is something
 * that can be down at 2am.
 *
 * The lock means several API instances can run the same job definition and only
 * one will actually do the work. Every job here must also be **idempotent** —
 * the lock can expire mid-run under load, and a job that only behaves when it
 * runs exactly once is a job that will misbehave.
 */

export interface JobDefinition {
  name: string;
  intervalMs: number;
  /** Lock lifetime. Must exceed a normal run, or two instances will overlap. */
  lockTtlMs: number;
  run(): Promise<void>;
}

export interface JobRunner {
  /** Runs one iteration, honouring the lock. Returns whether it did the work. */
  runOnce(job: JobDefinition): Promise<boolean>;
  start(jobs: JobDefinition[]): void;
  stop(): Promise<void>;
}

export function createJobRunner(redis: Redis, logger: AppLogger): JobRunner {
  const timers: NodeJS.Timeout[] = [];
  const inFlight = new Set<Promise<unknown>>();

  async function runOnce(job: JobDefinition): Promise<boolean> {
    const key = `jobs:lock:${job.name}`;
    const token = `${process.pid}-${Date.now()}-${Math.trunc(performance.now())}`;

    const acquired = await redis.set(key, token, 'PX', job.lockTtlMs, 'NX');
    if (acquired !== 'OK') return false;

    try {
      await job.run();
      return true;
    } finally {
      // Release only if still ours: a run that overran its TTL must not delete
      // the lock another instance has since taken.
      const holder = await redis.get(key);
      if (holder === token) await redis.del(key);
    }
  }

  return {
    runOnce,

    start(jobs) {
      for (const job of jobs) {
        const timer = setInterval(() => {
          const promise = runOnce(job)
            .catch((error: unknown) => {
              logger.error({ err: error, job: job.name }, 'job failed');
              return false;
            })
            .finally(() => inFlight.delete(promise));

          inFlight.add(promise);
        }, job.intervalMs);

        // Never hold the process open for a timer.
        timer.unref();
        timers.push(timer);

        logger.info({ job: job.name, intervalMs: job.intervalMs }, 'job scheduled');
      }
    },

    async stop() {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;

      await Promise.allSettled([...inFlight]);
    },
  };
}
