import { Router, type Request, type RequestHandler } from 'express';
import { getContext } from '../../core/context';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { requireRoles } from '../../core/middleware/require-roles';
import { bookingIdParamSchema } from '../bookings/types';
import { enforceSearchRateLimit } from '../search/service';
import * as service from './service';
import {
  createReviewSchema,
  listReviewsQuerySchema,
  providerIdParamSchema,
  reportReviewSchema,
  reviewIdParamSchema,
} from './types';

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const deps = (req: Request): service.ReviewDeps => ({ context: getContext(req) });

/* -------------------------------------------------------------------------- */
/* /api/v1/reviews                                                            */
/* -------------------------------------------------------------------------- */

export const router = Router();

router.use(authenticate);

/**
 * Flags a review for ops.
 *
 * Only a public (customer→provider) review can be reported, because only those
 * are visible to anybody who might object to one.
 */
router.post(
  '/:reviewId/report',
  handle(async (req, res) => {
    const { reviewId } = reviewIdParamSchema.parse(req.params);
    const input = reportReviewSchema.parse(req.body);

    const result = await service.reportReview(
      deps(req),
      getAuthUser(req).id,
      reviewId,
      input.reason,
    );

    res.status(202).json({ ...result, message: req.t('reviews.reported') });
  }),
);

/* -------------------------------------------------------------------------- */
/* Ops moderation                                                             */
/* -------------------------------------------------------------------------- */

export const opsRouter = Router();

opsRouter.use(authenticate, requireRoles('ops', 'admin'));

/**
 * Hides or restores a review.
 *
 * Hiding excludes it from every aggregate on the next recompute — which the
 * outbox triggers automatically — without deleting the row.
 */
opsRouter.post(
  '/:reviewId/hide',
  handle(async (req, res) => {
    const { reviewId } = reviewIdParamSchema.parse(req.params);
    const review = await service.setReviewHidden(deps(req), reviewId, true);

    res.status(200).json({ review, message: req.t('reviews.hidden') });
  }),
);

opsRouter.post(
  '/:reviewId/unhide',
  handle(async (req, res) => {
    const { reviewId } = reviewIdParamSchema.parse(req.params);
    const review = await service.setReviewHidden(deps(req), reviewId, false);

    res.status(200).json({ review });
  }),
);

/* -------------------------------------------------------------------------- */
/* Mounted under /api/v1/bookings/:bookingId/reviews                          */
/* -------------------------------------------------------------------------- */

export const bookingReviewRouter = Router({ mergeParams: true });

bookingReviewRouter.use(authenticate);

/** Both of a booking's reviews, to its own two parties. */
bookingReviewRouter.get(
  '/',
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const reviews = await service.listBookingReviews(deps(req), getAuthUser(req).id, bookingId);

    res.status(200).json({ bookingId, reviews });
  }),
);

/**
 * Rates the other side.
 *
 * Which direction it is, and therefore which tags are legal, is derived from
 * who the caller is — never from the request body. A customer cannot post a
 * provider→customer review by asking nicely.
 */
bookingReviewRouter.post(
  '/',
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const input = createReviewSchema.parse(req.body);
    const review = await service.createReview(deps(req), getAuthUser(req).id, bookingId, input);

    res.status(201).json({ review, message: req.t('reviews.thanks') });
  }),
);

/* -------------------------------------------------------------------------- */
/* Public — mounted under /api/v1/providers/:providerId/reviews               */
/* -------------------------------------------------------------------------- */

export const publicReviewRouter = Router();

/**
 * A technician's public reviews.
 *
 * Unauthenticated, like search, and rate limited on the same per-IP budget: a
 * customer reads reviews before they sign in, and a scraper walking every
 * technician's page is the traffic that limit exists to stop.
 *
 * **Only published customer→provider reviews.** The query filters on both, so
 * there is no path by which an internal provider→customer review reaches this
 * response — and a test asserts it.
 */
publicReviewRouter.get(
  '/:providerId/reviews',
  (req, _res, next) => {
    enforceSearchRateLimit(getContext(req), req.ip ?? 'unknown').then(() => next(), next);
  },
  handle(async (req, res) => {
    const { providerId } = providerIdParamSchema.parse(req.params);
    const query = listReviewsQuerySchema.parse(req.query);

    res.status(200).json(await service.listPublicReviews(deps(req), providerId, query));
  }),
);
