import { Router, type Request, type RequestHandler } from 'express';
import { getContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { requireRoles } from '../../core/middleware/require-roles';
import { enforceSearchRateLimit } from '../search/service';
import { bookingQuotationRouter } from '../quotations/routes';
import { declineWorkSchema } from '../quotations/types';
import { bookingPaymentRouter } from '../payments/routes';
import { bookingReviewRouter } from '../reviews/routes';
import { bookingComplaintRouter } from '../complaints/routes';
import * as service from './service';
import * as slots from './slots-service';
import {
  bookingIdParamSchema,
  cancelBookingSchema,
  createBookingSchema,
  isValidCancelReason,
  providerIdParamSchema,
  providerSlotsQuerySchema,
  rejectBookingSchema,
  slotIdParamSchema,
  submitOtpSchema,
} from './types';

export const router = Router();

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const deps = (req: Request): service.BookingDeps => ({ context: getContext(req) });

router.use(authenticate);

// A quotation only exists inside a job, and so does a payment. Both hang off the
// booking, mounted before the `/:bookingId` routes so the more specific path wins.
router.use('/:bookingId/quotations', bookingQuotationRouter);
router.use('/:bookingId/payments', bookingPaymentRouter);
router.use('/:bookingId/reviews', bookingReviewRouter);
router.use('/:bookingId/complaints', bookingComplaintRouter);

/* ---- customer ---- */

router.post(
  '/',
  requireRoles('customer'),
  handle(async (req, res) => {
    const input = createBookingSchema.parse(req.body);
    const booking = await service.createBooking(deps(req), getAuthUser(req).id, input);

    res.status(201).json({ booking, message: req.t('bookings.requested') });
  }),
);

/**
 * Both sides list "my bookings" from the same path — a technician who is also a
 * customer gets whichever side they ask for.
 */
router.get(
  '/',
  handle(async (req, res) => {
    const side = req.query.side === 'provider' ? 'provider' : 'customer';
    const bookings = await service.listMyBookings(deps(req), getAuthUser(req).id, side);

    res.status(200).json({ bookings, side });
  }),
);

router.get(
  '/:bookingId',
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const booking = await service.getBooking(deps(req), getAuthUser(req).id, bookingId);

    res.status(200).json({ booking });
  }),
);

/** Either side may cancel; the reason list they may draw from differs. */
router.post(
  '/:bookingId/cancel',
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const input = cancelBookingSchema.parse(req.body);

    const context = getContext(req);
    const userId = getAuthUser(req).id;

    const existing = await context.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { customerId: true, providerId: true },
    });

    if (!existing || (existing.customerId !== userId && existing.providerId !== userId)) {
      throw new AppError(404, 'BOOKING_NOT_FOUND', `Booking ${bookingId} not found`, {
        messageKey: 'errors.bookings.notFound',
      });
    }

    const side = existing.customerId === userId ? 'customer' : 'provider';

    if (!isValidCancelReason(side, input.reason)) {
      throw AppError.badRequest(`"${input.reason}" is not a reason a ${side} can give`, {
        messageKey: 'errors.bookings.invalidReason',
      });
    }

    const booking = await service.cancelBooking(deps(req), userId, bookingId, input);
    res.status(200).json({ booking, message: req.t('bookings.cancelled') });
  }),
);

/**
 * "I heard the price and I don't want the work."
 *
 * Separate from rejecting a quotation on purpose: a rejection invites a
 * revision, this ends the job. The visit fee is payable because the technician
 * genuinely came.
 */
router.post(
  '/:bookingId/decline-work',
  requireRoles('customer'),
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const input = declineWorkSchema.parse(req.body);
    const booking = await service.declineWork(deps(req), getAuthUser(req).id, bookingId, input);

    res.status(200).json({ booking, message: req.t('bookings.workDeclined') });
  }),
);

/* ---- provider ---- */

router.post(
  '/:bookingId/accept',
  requireRoles('technician'),
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const booking = await service.acceptBooking(deps(req), getAuthUser(req).id, bookingId);

    res.status(200).json({ booking, message: req.t('bookings.accepted') });
  }),
);

router.post(
  '/:bookingId/reject',
  requireRoles('technician'),
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const input = rejectBookingSchema.parse(req.body);
    const booking = await service.rejectBooking(deps(req), getAuthUser(req).id, bookingId, input);

    res.status(200).json({ booking, message: req.t('bookings.rejected') });
  }),
);

router.post(
  '/:bookingId/en-route',
  requireRoles('technician'),
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const booking = await service.markEnRoute(deps(req), getAuthUser(req).id, bookingId);

    res.status(200).json({ booking, message: req.t('bookings.enRoute') });
  }),
);

/** The start handshake — proves the technician is actually at the door. */
router.post(
  '/:bookingId/start',
  requireRoles('technician'),
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const input = submitOtpSchema.parse(req.body);
    const booking = await service.submitStartOtp(deps(req), getAuthUser(req).id, bookingId, input);

    res.status(200).json({ booking, message: req.t('bookings.started') });
  }),
);

/** The end handshake — the customer's sign-off that the work is done. */
router.post(
  '/:bookingId/complete',
  requireRoles('technician'),
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const input = submitOtpSchema.parse(req.body);
    const booking = await service.submitEndOtp(deps(req), getAuthUser(req).id, bookingId, input);

    res.status(200).json({ booking, message: req.t('bookings.completed') });
  }),
);

/* -------------------------------------------------------------------------- */
/* Public availability — mounted under /providers                             */
/* -------------------------------------------------------------------------- */

/**
 * `GET /api/v1/providers/:providerId/slots?from=&to=`
 *
 * Public, because a customer picks a time before they sign in. It reuses the
 * search rate limit rather than inventing a second budget: this endpoint is the
 * step immediately after a search, and a scraper walking every provider's
 * calendar is exactly the traffic that limit exists to stop.
 *
 * Only `open` slots are returned. Which hours are booked, and when a technician
 * took the afternoon off, is nobody else's business.
 */
export const publicSlotRouter = Router();

publicSlotRouter.get(
  '/:providerId/slots',
  (req, _res, next) => {
    enforceSearchRateLimit(getContext(req), req.ip ?? 'unknown').then(() => next(), next);
  },
  handle(async (req, res) => {
    const { providerId } = providerIdParamSchema.parse(req.params);
    const query = providerSlotsQuerySchema.parse(req.query);
    const open = await slots.listPublicSlots(getContext(req), providerId, query);

    res.status(200).json({ providerId, slots: open });
  }),
);

/* -------------------------------------------------------------------------- */
/* Provider slot management — mounted under /providers/me/slots               */
/* -------------------------------------------------------------------------- */

export const providerSlotRouter = Router();

providerSlotRouter.use(authenticate, requireRoles('technician'));

providerSlotRouter.post(
  '/:slotId/block',
  handle(async (req, res) => {
    const { slotId } = slotIdParamSchema.parse(req.params);
    const slot = await slots.setSlotBlocked(getContext(req), getAuthUser(req).id, slotId, true);

    res.status(200).json({ slot, message: req.t('bookings.slotBlocked') });
  }),
);

providerSlotRouter.post(
  '/:slotId/unblock',
  handle(async (req, res) => {
    const { slotId } = slotIdParamSchema.parse(req.params);
    const slot = await slots.setSlotBlocked(getContext(req), getAuthUser(req).id, slotId, false);

    res.status(200).json({ slot, message: req.t('bookings.slotUnblocked') });
  }),
);
