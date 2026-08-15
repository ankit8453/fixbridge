import Redis from 'ioredis';
import type { AppConfig } from './config';
import type { AppLogger } from './logger';

/** Give up reconnecting after this many attempts so a dead Redis cannot pin the process open. */
const MAX_RECONNECT_ATTEMPTS = 10;

export function createRedisClient(config: AppConfig, logger: AppLogger): Redis {
  const client = new Redis(config.REDIS_URL, {
    connectTimeout: 5_000,
    maxRetriesPerRequest: 2,
    retryStrategy: (attempt) => {
      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        logger.error({ attempt }, 'redis: giving up on reconnect');
        return null;
      }
      const delayMs = Math.min(attempt * 200, 3_000);
      logger.warn({ attempt, delayMs }, 'redis: reconnecting');
      return delayMs;
    },
  });

  client.on('connect', () => logger.info('redis: connected'));
  client.on('ready', () => logger.info('redis: ready'));
  client.on('end', () => logger.info('redis: connection closed'));
  // ioredis crashes the process on an unhandled `error` event — always listen.
  client.on('error', (error: Error) => logger.warn({ err: error }, 'redis: connection error'));

  return client;
}
