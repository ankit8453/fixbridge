import type { Express } from 'express';
import { router as authRouter } from './auth/routes';
import { router as categoriesRouter } from './categories/routes';
import { router as customersRouter } from './customers/routes';
import { router as providersRouter } from './providers/routes';
import {
  router as verificationRouter,
  opsRouter as verificationOpsRouter,
} from './verification/routes';
import { router as searchRouter } from './search/routes';
import { router as bookingsRouter, providerSlotRouter, publicSlotRouter } from './bookings/routes';
import { router as quotationsRouter } from './quotations/routes';
import { router as paymentsRouter } from './payments/routes';
import { router as reviewsRouter } from './reviews/routes';
import { router as notificationsRouter } from './notifications/routes';
import { router as adminRouter } from './admin/routes';

export const API_PREFIX = '/api/v1';

/**
 * Domain modules of the monolith. Live: auth (Phase 2), categories, customers and
 * providers (Phase 3). The rest are empty routers, mounted so the wiring is
 * proved and later phases only add handlers.
 */
export function registerModuleRoutes(app: Express): void {
  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/categories`, categoriesRouter);
  app.use(`${API_PREFIX}/customers`, customersRouter);
  // Slots live in the bookings module but hang off the providers path, which is
  // where a client looks for them. Most specific prefix first.
  app.use(`${API_PREFIX}/providers/me/slots`, providerSlotRouter);
  app.use(`${API_PREFIX}/providers`, publicSlotRouter);
  app.use(`${API_PREFIX}/providers`, providersRouter);
  app.use(`${API_PREFIX}/verification`, verificationRouter);
  // Public and rate-limited — a customer chooses before they sign in.
  app.use(`${API_PREFIX}/search`, searchRouter);
  app.use(`${API_PREFIX}/bookings`, bookingsRouter);
  app.use(`${API_PREFIX}/quotations`, quotationsRouter);
  app.use(`${API_PREFIX}/payments`, paymentsRouter);
  app.use(`${API_PREFIX}/reviews`, reviewsRouter);
  app.use(`${API_PREFIX}/notifications`, notificationsRouter);
  // Ops verification lives at the admin path reviewers expect, but the code
  // stays in the verification module. The admin module itself is Phase 11.
  app.use(`${API_PREFIX}/admin/verification`, verificationOpsRouter);
  app.use(`${API_PREFIX}/admin`, adminRouter);
}
