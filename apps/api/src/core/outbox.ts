import type { Prisma, PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import type { AppConfig } from './config';
import type { AppLogger } from './logger';

/**
 * The transactional outbox.
 *
 * The problem it solves: "change the state, then publish an event" is two
 * writes to two systems, and there is no ordering of them that is safe. Publish
 * first and a crash leaves an event for something that never happened; publish
 * second and a crash leaves a state change nobody hears about.
 *
 * So the event is written to a Postgres table **inside the same transaction as
 * the state change**. Either both exist or neither does. A separate dispatcher
 * then reads that table and delivers.
 *
 * The cost is that delivery is **at-least-once**, never exactly-once: the
 * dispatcher can crash between calling a handler and marking the row processed.
 * Every consumer must therefore be idempotent. That is not a caveat to work
 * around — it is the deal, and pretending otherwise is how these break.
 *
 * No Kafka, no BullMQ. One Postgres table and a `setInterval` is the right size
 * for pilot traffic, and it is the table the trust engine and notifications read.
 */

export interface OutboxMessage {
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
}

/**
 * Writes an event inside a caller's transaction.
 *
 * `tx` is deliberately required and deliberately not the top-level client: if
 * this could be called outside a transaction, the guarantee would be optional,
 * and an optional guarantee is not one.
 */
export async function enqueueOutbox(
  tx: Prisma.TransactionClient,
  message: OutboxMessage,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      topic: message.topic,
      aggregateType: message.aggregateType,
      aggregateId: message.aggregateId,
      payload: message.payload,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Handler registry                                                           */
/* -------------------------------------------------------------------------- */

export interface DeliveredEvent {
  id: string;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  attempts: number;
  createdAt: Date;
}

export type OutboxHandler = (event: DeliveredEvent) => Promise<void>;

export interface OutboxRegistry {
  subscribe(topic: string, handler: OutboxHandler): void;
  handlersFor(topic: string): OutboxHandler[];
  topics(): string[];
}

export function createOutboxRegistry(): OutboxRegistry {
  const handlers = new Map<string, OutboxHandler[]>();

  return {
    subscribe(topic, handler) {
      const existing = handlers.get(topic) ?? [];
      existing.push(handler);
      handlers.set(topic, existing);
    },

    handlersFor(topic) {
      return handlers.get(topic) ?? [];
    },

    topics() {
      return [...handlers.keys()];
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Dispatcher                                                                 */
/* -------------------------------------------------------------------------- */

/** Exponential, capped. Attempt 1 waits `base`, attempt 2 `2×base`, and so on. */
export function backoffSeconds(attempt: number, baseSeconds: number, maxSeconds: number): number {
  return Math.min(maxSeconds, baseSeconds * 2 ** Math.max(0, attempt - 1));
}

export interface DispatchResult {
  claimed: number;
  delivered: number;
  failed: number;
  parked: number;
}

export interface OutboxDispatcher {
  /** Runs one batch. Returns what happened, so tests need no timers. */
  runOnce(): Promise<DispatchResult>;
  start(): void;
  stop(): Promise<void>;
}

const DISPATCH_LOCK_KEY = 'outbox:dispatcher:lock';

export interface DispatcherDeps {
  prisma: PrismaClient;
  redis: Redis;
  config: AppConfig;
  logger: AppLogger;
  registry: OutboxRegistry;
  now?: () => Date;
}

export function createOutboxDispatcher(deps: DispatcherDeps): OutboxDispatcher {
  const { prisma, redis, config, logger, registry } = deps;
  const now = (): Date => (deps.now ? deps.now() : new Date());

  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let inFlight: Promise<DispatchResult> | undefined;

  /**
   * One dispatcher at a time across instances.
   *
   * A short TTL rather than a long one: if a dispatcher dies holding the lock,
   * the next poll picks up where it left off. At-least-once delivery means a
   * duplicate here is survivable, whereas a stuck lock would stall every event.
   */
  async function withLock<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    const ttlMs = Math.max(5_000, config.OUTBOX_POLL_INTERVAL_MS * 5);
    const token = `${process.pid}-${Date.now()}`;

    const acquired = await redis.set(DISPATCH_LOCK_KEY, token, 'PX', ttlMs, 'NX');
    if (acquired !== 'OK') return fallback;

    try {
      return await fn();
    } finally {
      // Only release a lock we still own, so a slow batch cannot delete the
      // lock a newer dispatcher has since taken.
      const current = await redis.get(DISPATCH_LOCK_KEY);
      if (current === token) await redis.del(DISPATCH_LOCK_KEY);
    }
  }

  async function deliver(row: DeliveredEvent): Promise<void> {
    const handlers = registry.handlersFor(row.topic);

    // A topic nobody listens to is normal, not an error — most of what this
    // system publishes drives projections rather than messages.
    if (handlers.length === 0) return;

    for (const handler of handlers) {
      await handler(row);
    }
  }

  async function runOnce(): Promise<DispatchResult> {
    return withLock(
      async () => {
        const at = now();

        const due = await prisma.outboxEvent.findMany({
          where: { processedAt: null, nextAttemptAt: { lte: at } },
          orderBy: { createdAt: 'asc' },
          take: config.OUTBOX_BATCH_SIZE,
        });

        const result: DispatchResult = {
          claimed: due.length,
          delivered: 0,
          failed: 0,
          parked: 0,
        };

        for (const row of due) {
          try {
            await deliver({
              id: row.id,
              topic: row.topic,
              aggregateType: row.aggregateType,
              aggregateId: row.aggregateId,
              payload: row.payload,
              attempts: row.attempts,
              createdAt: row.createdAt,
            });

            await prisma.outboxEvent.update({
              where: { id: row.id },
              data: { processedAt: now(), attempts: row.attempts + 1, lastError: null },
            });

            result.delivered += 1;
          } catch (error) {
            const attempts = row.attempts + 1;
            const message = error instanceof Error ? error.message : String(error);
            const parked = attempts >= config.OUTBOX_MAX_ATTEMPTS;

            await prisma.outboxEvent.update({
              where: { id: row.id },
              data: {
                attempts,
                lastError: message.slice(0, 2000),
                nextAttemptAt: new Date(
                  now().getTime() +
                    backoffSeconds(
                      attempts,
                      config.OUTBOX_BACKOFF_BASE_SECONDS,
                      config.OUTBOX_BACKOFF_MAX_SECONDS,
                    ) *
                      1000,
                ),
              },
            });

            if (parked) {
              result.parked += 1;
              // Parked, not dropped: the row stays for Phase 11's ops view.
              logger.error(
                { outboxId: row.id, topic: row.topic, attempts, err: error },
                'outbox: event parked after max attempts',
              );
            } else {
              result.failed += 1;
              logger.warn(
                { outboxId: row.id, topic: row.topic, attempts, err: error },
                'outbox: delivery failed, will retry',
              );
            }
          }
        }

        return result;
      },
      { claimed: 0, delivered: 0, failed: 0, parked: 0 },
    );
  }

  return {
    runOnce,

    start() {
      if (timer) return;

      timer = setInterval(() => {
        if (running) return;
        running = true;

        inFlight = runOnce();
        void inFlight
          .catch((error: unknown) => {
            logger.error({ err: error }, 'outbox: dispatch loop failed');
            return { claimed: 0, delivered: 0, failed: 0, parked: 0 };
          })
          .finally(() => {
            running = false;
          });
      }, config.OUTBOX_POLL_INTERVAL_MS);

      timer.unref();
      logger.info({ intervalMs: config.OUTBOX_POLL_INTERVAL_MS }, 'outbox dispatcher started');
    },

    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }

      // Let the batch in flight finish rather than abandoning half-delivered
      // events to a redelivery they did not need.
      if (inFlight) await inFlight.catch(() => undefined);
    },
  };
}
