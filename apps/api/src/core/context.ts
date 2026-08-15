import type { Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { loadConfig, type AppConfig } from './config';
import { createLogger, type AppLogger } from './logger';
import { createPrismaClient } from './prisma';
import { createRedisClient } from './redis';
import { APP_VERSION } from './version';
import { AppError } from './errors';
import { createOtpTransport } from '../modules/auth/transport';
import type { OtpTransport } from '../modules/auth/transport';
import { createUserDenylist, type UserDenylist } from '../modules/auth/denylist';
import { createStubGeoService, type GeoService } from './geo';
import { createS3StorageService, type StorageService } from './storage';
import { createDefaultAdapters, type VerificationAdapters } from '../modules/verification/adapters';

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
  /** How OTPs reach a human. Real WhatsApp delivery arrives in Phase 10. */
  otpTransport: OtpTransport;
  /** Blocked users whose still-valid access tokens must stop working now. */
  userDenylist: UserDenylist;
  /** Address text to coordinates. Stubbed until a real provider is wired in. */
  geo: GeoService;
  /** Private object storage for KYC documents. The API never handles the bytes. */
  storage: StorageService;
  /** Third-party KYC vendors. Manual (ops-decided) until one is contracted. */
  adapters: VerificationAdapters;
}

export const CONTEXT_KEY = 'appContext';

export function createContext(config: AppConfig = loadConfig()): AppContext {
  const logger = createLogger(config);
  const redis = createRedisClient(config, logger);

  return {
    config,
    logger,
    prisma: createPrismaClient(config, logger),
    redis,
    version: APP_VERSION,
    otpTransport: createOtpTransport(logger, config.NODE_ENV),
    userDenylist: createUserDenylist(redis, config, logger),
    geo: createStubGeoService(),
    storage: createS3StorageService(config, logger),
    adapters: createDefaultAdapters(),
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
