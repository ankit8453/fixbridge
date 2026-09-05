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
import { createNominatimGeoService } from './geo-nominatim';
import { createOutboxRegistry, type OutboxRegistry } from './outbox';
import { createS3StorageService, type StorageService } from './storage';
import { createDefaultAdapters, type VerificationAdapters } from '../modules/verification/adapters';
import { createPaymentGateway, type PaymentGatewayAdapter } from '../modules/payments/gateway';
import {
  createMessageTransports,
  type MessagingTransports,
} from '../modules/notifications/transports';

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
  /**
   * How a login OTP reaches a human.
   *
   * Still the development logger. Phase 10 built the message transports for
   * *notifications*; wiring the login OTP through them needs its own DLT
   * template and is Phase 15 work — see docs/notifications.md.
   */
  otpTransport: OtpTransport;
  /** Blocked users whose still-valid access tokens must stop working now. */
  userDenylist: UserDenylist;
  /** Address text to coordinates. Stubbed until a real provider is wired in. */
  geo: GeoService;
  /** Private object storage for KYC documents. The API never handles the bytes. */
  storage: StorageService;
  /** Third-party KYC vendors. Manual (ops-decided) until one is contracted. */
  adapters: VerificationAdapters;
  /** Where domain events are published. The trust engine and notifications subscribe here. */
  outbox: OutboxRegistry;
  /** The payment gateway. `fake` everywhere except production. */
  gateway: PaymentGatewayAdapter;
  /**
   * How a rendered message physically leaves the building, per external channel.
   * `console` outside production, so a fresh clone runs the whole pipeline.
   */
  messaging: MessagingTransports;
}

export const CONTEXT_KEY = 'appContext';

/**
 * Picks the geocoder from config.
 *
 * `stub` is the default so a fresh clone works with no network. It is safe as
 * a default in a way `fake` payments are not — it answers uselessly rather
 * than wrongly, which is exactly what it was rewritten to do.
 */
function createGeoService(config: AppConfig, redis: Redis, logger: AppLogger): GeoService {
  if (config.GEO_PROVIDER === 'nominatim') {
    return createNominatimGeoService({
      baseUrl: config.GEO_NOMINATIM_URL,
      // The schema guarantees this is present for this branch.
      userAgent: config.GEO_USER_AGENT as string,
      redis,
      logger,
      cacheTtlSeconds: config.GEO_CACHE_TTL_SECONDS,
      timeoutMs: config.GEO_TIMEOUT_MS,
    });
  }

  return createStubGeoService();
}

export function createContext(config: AppConfig = loadConfig()): AppContext {
  const logger = createLogger(config);
  const redis = createRedisClient(config, logger);

  return {
    config,
    logger,
    prisma: createPrismaClient(config, logger),
    redis,
    version: APP_VERSION,
    otpTransport: createOtpTransport(logger, config.NODE_ENV, config.AUTH_OTP_TRANSPORT, config),
    userDenylist: createUserDenylist(redis, config, logger),
    geo: createGeoService(config, redis, logger),
    storage: createS3StorageService(config, logger),
    adapters: createDefaultAdapters(),
    outbox: createOutboxRegistry(),
    gateway: createPaymentGateway(config, logger),
    messaging: createMessageTransports(config, logger),
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
