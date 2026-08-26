import type { Express } from 'express';
import { router as authRouter } from './auth/routes';
import { router as categoriesRouter } from './categories/routes';
import { router as customersRouter } from './customers/routes';
import { router as providersRouter, photoReportRouter, photoOpsRouter } from './providers/routes';
import {
  router as verificationRouter,
  opsRouter as verificationOpsRouter,
} from './verification/routes';
import { router as searchRouter } from './search/routes';
import { router as bookingsRouter, providerSlotRouter, publicSlotRouter } from './bookings/routes';
import { router as quotationsRouter } from './quotations/routes';
// `bookingPaymentRouter` is mounted by the bookings router, alongside quotations.
import {
  router as paymentsRouter,
  opsRouter as paymentsOpsRouter,
  walletRouter,
  webhookRouter,
} from './payments/routes';
import {
  router as reviewsRouter,
  opsRouter as reviewsOpsRouter,
  publicReviewRouter,
} from './reviews/routes';
import { router as complaintsRouter, opsRouter as complaintsOpsRouter } from './complaints/routes';
import { router as trustRouter, opsRouter as trustOpsRouter } from './trust/routes';
import { router as notificationsRouter } from './notifications/routes';
import { router as adminRouter } from './admin/routes';
// `bookingCouponRouter` is mounted by the bookings router, alongside payments.
import { opsRouter as couponsOpsRouter } from './coupons/routes';

export const API_PREFIX = '/api/v1';

/**
 * Webhooks live outside `/api/v1` versioning conventions in one respect: the
 * raw-body parser is mounted on this prefix in `app.ts`, ahead of the JSON
 * parser, so the exact bytes survive for signature verification.
 */
export const WEBHOOK_PREFIX = `${API_PREFIX}/webhooks`;

/**
 * Domain modules of the monolith. Live: auth (Phase 2), categories, customers and
 * providers (Phase 3). The rest are empty routers, mounted so the wiring is
 * proved and later phases only add handlers.
 */
export function registerModuleRoutes(app: Express): void {
  // Public and signature-authenticated. Registered first so nothing else can
  // claim the path.
  app.use(WEBHOOK_PREFIX, webhookRouter);

  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/categories`, categoriesRouter);
  app.use(`${API_PREFIX}/customers`, customersRouter);
  // Slots live in the bookings module but hang off the providers path, which is
  // where a client looks for them. Most specific prefix first.
  // Photo reports are keyed by photo id, not provider id, so they get their own
  // prefix rather than nesting under a provider that the reporter need not know.
  app.use(`${API_PREFIX}/provider-photos`, photoReportRouter);
  app.use(`${API_PREFIX}/providers/me/slots`, providerSlotRouter);
  app.use(`${API_PREFIX}/providers/me/wallet`, walletRouter);
  app.use(`${API_PREFIX}/providers/me/trust`, trustRouter);
  app.use(`${API_PREFIX}/providers`, publicSlotRouter);
  // Public and rate-limited, like search — reviews are read before signing in.
  app.use(`${API_PREFIX}/providers`, publicReviewRouter);
  app.use(`${API_PREFIX}/providers`, providersRouter);
  app.use(`${API_PREFIX}/verification`, verificationRouter);
  // Public and rate-limited — a customer chooses before they sign in.
  app.use(`${API_PREFIX}/search`, searchRouter);
  app.use(`${API_PREFIX}/bookings`, bookingsRouter);
  app.use(`${API_PREFIX}/quotations`, quotationsRouter);
  app.use(`${API_PREFIX}/payments`, paymentsRouter);
  app.use(`${API_PREFIX}/reviews`, reviewsRouter);
  app.use(`${API_PREFIX}/complaints`, complaintsRouter);
  app.use(`${API_PREFIX}/notifications`, notificationsRouter);
  // Ops verification lives at the admin path reviewers expect, but the code
  // stays in the verification module. The admin module itself is Phase 11.
  app.use(`${API_PREFIX}/admin/verification`, verificationOpsRouter);
  // Payout batches, dues settlement and the platform's position. Same reasoning
  // as verification's ops routes: the path is where ops look, the code stays
  // with its module.
  app.use(`${API_PREFIX}/admin/provider-photos`, photoOpsRouter);
  app.use(`${API_PREFIX}/admin/payments`, paymentsOpsRouter);
  app.use(`${API_PREFIX}/admin/complaints`, complaintsOpsRouter);
  app.use(`${API_PREFIX}/admin/reviews`, reviewsOpsRouter);
  app.use(`${API_PREFIX}/admin/trust`, trustOpsRouter);
  // Coupons: money config, so the mutations are admin-only inside the router.
  app.use(`${API_PREFIX}/admin/coupons`, couponsOpsRouter);
  app.use(`${API_PREFIX}/admin`, adminRouter);
}
