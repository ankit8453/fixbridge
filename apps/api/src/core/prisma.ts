import { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config';
import type { AppLogger } from './logger';

/**
 * One Prisma client per process. Query-level logging is intentionally off —
 * turn it on locally by adding `{ emit: 'event', level: 'query' }` below.
 */
export function createPrismaClient(config: AppConfig, logger: AppLogger): PrismaClient {
  const client = new PrismaClient({
    datasourceUrl: config.DATABASE_URL,
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  client.$on('warn', (event) => {
    logger.warn({ target: event.target }, event.message);
  });

  client.$on('error', (event) => {
    logger.error({ target: event.target }, event.message);
  });

  return client;
}
