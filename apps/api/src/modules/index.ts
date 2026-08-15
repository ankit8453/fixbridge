import type { Express } from 'express';
import { router as authRouter } from './auth/routes';
import { router as customersRouter } from './customers/routes';
import { router as providersRouter } from './providers/routes';
import { router as verificationRouter } from './verification/routes';
import { router as searchRouter } from './search/routes';
import { router as bookingsRouter } from './bookings/routes';
import { router as quotationsRouter } from './quotations/routes';
import { router as paymentsRouter } from './payments/routes';
import { router as reviewsRouter } from './reviews/routes';
import { router as notificationsRouter } from './notifications/routes';
import { router as adminRouter } from './admin/routes';

export const API_PREFIX = '/api/v1';

/**
 * Domain modules of the monolith. Every router here is an empty stub in Phase 1 —
 * they are mounted now so the wiring is proved and later phases only add handlers.
 *
 * The phase number in each stub's header comment is firm for auth (2), admin (11)
 * and mobile (12–13); 3–10 are a provisional split — see docs/summaries/phase01-summary.md.
 */
export function registerModuleRoutes(app: Express): void {
  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/customers`, customersRouter);
  app.use(`${API_PREFIX}/providers`, providersRouter);
  app.use(`${API_PREFIX}/verification`, verificationRouter);
  app.use(`${API_PREFIX}/search`, searchRouter);
  app.use(`${API_PREFIX}/bookings`, bookingsRouter);
  app.use(`${API_PREFIX}/quotations`, quotationsRouter);
  app.use(`${API_PREFIX}/payments`, paymentsRouter);
  app.use(`${API_PREFIX}/reviews`, reviewsRouter);
  app.use(`${API_PREFIX}/notifications`, notificationsRouter);
  app.use(`${API_PREFIX}/admin`, adminRouter);
}
