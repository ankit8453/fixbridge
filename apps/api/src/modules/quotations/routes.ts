import { Router, type Request, type RequestHandler } from 'express';
import { getContext } from '../../core/context';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { requireRoles } from '../../core/middleware/require-roles';
import { bookingIdParamSchema } from '../bookings/types';
import * as service from './service';
import { createQuotationSchema, quotationIdParamSchema, rejectQuotationSchema } from './types';

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const deps = (req: Request): service.QuotationDeps => ({ context: getContext(req) });

/**
 * `/api/v1/quotations/:id/*` — acting on one quotation.
 *
 * Sending and listing hang off the booking instead (see `bookingQuotationRouter`
 * below), because a quotation only exists in the context of a job.
 */
export const router = Router();

router.use(authenticate);

/**
 * The moment the price becomes binding.
 *
 * Customer only, and only on a quote still awaiting their decision — a
 * technician cannot approve their own number on the customer's behalf, which is
 * the single most important actor rule in this module.
 */
router.post(
  '/:quotationId/approve',
  requireRoles('customer'),
  handle(async (req, res) => {
    const { quotationId } = quotationIdParamSchema.parse(req.params);
    const quotation = await service.approveQuotation(deps(req), getAuthUser(req).id, quotationId);

    res.status(200).json({ quotation, message: req.t('quotations.approved') });
  }),
);

/**
 * "Not at that price."
 *
 * Does **not** end the booking: the technician may answer with a revision. The
 * customer ends it with `POST /bookings/:id/decline-work`.
 */
router.post(
  '/:quotationId/reject',
  requireRoles('customer'),
  handle(async (req, res) => {
    const { quotationId } = quotationIdParamSchema.parse(req.params);
    const input = rejectQuotationSchema.parse(req.body);
    const quotation = await service.rejectQuotation(
      deps(req),
      getAuthUser(req).id,
      quotationId,
      input,
    );

    res.status(200).json({ quotation, message: req.t('quotations.rejected') });
  }),
);

/** The technician's own correction, before the customer has decided. */
router.post(
  '/:quotationId/withdraw',
  requireRoles('technician'),
  handle(async (req, res) => {
    const { quotationId } = quotationIdParamSchema.parse(req.params);
    const quotation = await service.withdrawQuotation(deps(req), getAuthUser(req).id, quotationId);

    res.status(200).json({ quotation, message: req.t('quotations.withdrawn') });
  }),
);

/* -------------------------------------------------------------------------- */
/* Mounted under /bookings/:bookingId/quotations                              */
/* -------------------------------------------------------------------------- */

export const bookingQuotationRouter = Router({ mergeParams: true });

bookingQuotationRouter.use(authenticate);

/** Both parties, every version, fully itemised. */
bookingQuotationRouter.get(
  '/',
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    res.status(200).json(await service.listQuotations(deps(req), getAuthUser(req).id, bookingId));
  }),
);

/** A new version. Never an edit — see the immutability triggers in the migration. */
bookingQuotationRouter.post(
  '/',
  requireRoles('technician'),
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const input = createQuotationSchema.parse(req.body);
    const quotation = await service.sendQuotation(deps(req), getAuthUser(req).id, bookingId, input);

    res.status(201).json({ quotation, message: req.t('quotations.sent') });
  }),
);
