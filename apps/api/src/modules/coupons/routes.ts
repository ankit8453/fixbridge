import { Router, type Request, type RequestHandler } from 'express';
import { auditActor } from '../../core/audit';
import { getContext } from '../../core/context';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { requireRoles } from '../../core/middleware/require-roles';
import { bookingIdParamSchema } from '../bookings/types';
import * as service from './service';
import {
  applyCouponSchema,
  couponIdParamSchema,
  createCouponSchema,
  listCouponsQuerySchema,
  updateCouponSchema,
} from './types';

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const deps = (req: Request): service.CouponDeps => ({ context: getContext(req) });

/* -------------------------------------------------------------------------- */
/* /api/v1/admin/coupons                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The console's coupon CRUD.
 *
 * **This router guards itself.** It is mounted at `/api/v1/admin/coupons`,
 * which is a *sibling* of the `/api/v1/admin` mount rather than nested inside
 * it — Express matches the more specific path first, so `adminRouter`'s
 * `authenticate` never runs for these routes. This comment previously claimed
 * the opposite, and the result was that every coupon endpoint was reachable
 * with no token at all: `GET /api/v1/admin/coupons` returned every live
 * discount code to anonymous callers, and the mutations threw 500s because
 * `requireRoles` ran with `req.user` undefined.
 *
 * Every **mutation** additionally carries `requireRoles('admin')`, because a
 * coupon is money config: it commits the platform to spending its own
 * commission, which is the same class of decision as a commission rate or a
 * refund. The list is left readable by ops — seeing which campaigns are live
 * is part of answering a customer's "why didn't my code work".
 *
 * See `ADMIN_ONLY_ROUTES` in `core/audit.ts`, which enumerates exactly these
 * four routes and is checked against this router by a test.
 */
export const opsRouter = Router();

/**
 * The guard the sibling mount does not supply. Matches every other ops router
 * (`verification`, `payments`, `complaints`, `reviews`, `trust`,
 * `provider-photos`), each of which authenticates itself for the same reason.
 */
opsRouter.use(authenticate, requireRoles('ops', 'admin'));

opsRouter.get(
  '/',
  handle(async (req, res) => {
    const query = listCouponsQuerySchema.parse(req.query);
    res.status(200).json(await service.listCoupons(deps(req), query));
  }),
);

/**
 * Before `/:couponId`, which would otherwise match the literal string "stats"
 * as an id and answer 404.
 */
opsRouter.get(
  '/stats',
  handle(async (_req, res) => {
    res.status(200).json(await service.getCouponStats(deps(_req)));
  }),
);

opsRouter.get(
  '/:couponId',
  handle(async (req, res) => {
    const { couponId } = couponIdParamSchema.parse(req.params);
    res.status(200).json({ coupon: await service.getCoupon(deps(req), couponId) });
  }),
);

opsRouter.post(
  '/',
  requireRoles('admin'),
  handle(async (req, res) => {
    const input = createCouponSchema.parse(req.body);

    const coupon = await service.createCoupon(
      deps(req),
      auditActor(req),
      // The staff account's own id: a coupon's owner outlives the audit log's
      // retention, so it is stored on the row as well as recorded in the log.
      getAuthUser(req).id,
      input,
    );

    res.status(201).json({ coupon });
  }),
);

opsRouter.patch(
  '/:couponId',
  requireRoles('admin'),
  handle(async (req, res) => {
    const { couponId } = couponIdParamSchema.parse(req.params);
    const input = updateCouponSchema.parse(req.body);

    const coupon = await service.updateCoupon(deps(req), auditActor(req), couponId, input);

    res.status(200).json({ coupon });
  }),
);

/**
 * Pause and resume are two routes rather than one `PATCH ... {status}`.
 *
 * They are separate audit actions — "show me every campaign somebody switched
 * off" has to be a filter on `action`, not a scan of payloads — and the registry
 * requires a distinct action per route.
 */
opsRouter.post(
  '/:couponId/pause',
  requireRoles('admin'),
  handle(async (req, res) => {
    const { couponId } = couponIdParamSchema.parse(req.params);
    const coupon = await service.setCouponStatus(deps(req), auditActor(req), couponId, 'paused');

    res.status(200).json({ coupon });
  }),
);

opsRouter.post(
  '/:couponId/resume',
  requireRoles('admin'),
  handle(async (req, res) => {
    const { couponId } = couponIdParamSchema.parse(req.params);
    const coupon = await service.setCouponStatus(deps(req), auditActor(req), couponId, 'active');

    res.status(200).json({ coupon });
  }),
);

/* -------------------------------------------------------------------------- */
/* Mounted under /api/v1/bookings/:bookingId/coupon                           */
/* -------------------------------------------------------------------------- */

/**
 * The customer's own apply/remove.
 *
 * `mergeParams` so `:bookingId` from the mount point is readable here, matching
 * how quotations and payments hang off a booking.
 */
export const bookingCouponRouter = Router({ mergeParams: true });

bookingCouponRouter.use(authenticate);

bookingCouponRouter.post(
  '/',
  requireRoles('customer'),
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const input = applyCouponSchema.parse(req.body);

    const applied = await service.applyCoupon(deps(req), getAuthUser(req).id, bookingId, input);

    res.status(200).json({ coupon: applied, message: req.t('coupons.applied') });
  }),
);

bookingCouponRouter.delete(
  '/',
  requireRoles('customer'),
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);

    await service.removeCoupon(deps(req), getAuthUser(req).id, bookingId);

    res.status(200).json({ removed: true, message: req.t('coupons.removed') });
  }),
);
