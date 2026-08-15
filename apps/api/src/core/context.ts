import type { Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { loadConfig, type AppConfig } from './config';
import { createLogger, type AppLogger } from './logger';
import { createPrismaClient } from './prisma';
import { createRedisClient } from './redis';
import { APP_VERSION } from './version';
import { AppError } from './errors';

/**
 * Everything long-lived the app needs, built once at boot and hung off the
 * Express instance. Routers read it via `getContext(req)` so they stay plain
 * exported routers with no import-time dependencies.
 */
export interface AppContext {
  config: AppConfig;
  logger: AppLogger;
  prisma: PrismaClient;
  redis: Redis;
  version: string;
}

export const CONTEXT_KEY = 'appContext';

export function createContext(config: AppConfig = loadConfig()): AppContext {
  const logger = createLogger(config);

  return {
    config,
    logger,
    prisma: createPrismaClient(config, logger),
    redis: createRedisClient(config, logger),
    version: APP_VERSION,
  };
}

export function getContext(req: Request): AppContext {
  const context = req.app.get(CONTEXT_KEY) as AppContext | undefined;

  if (!context) {
    throw AppError.internal('Application context is not attached to the Express app');
  }

  return context;
}

/** Close every long-lived connection. Safe to call more than once. */
export async function disposeContext(context: AppContext): Promise<void> {
  await Promise.allSettled([context.prisma.$disconnect(), context.redis.quit()]);
}
