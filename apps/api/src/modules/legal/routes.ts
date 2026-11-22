import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { getContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { acceptLegalDocument, getLegalStatus } from './service';

export const router = Router();

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const acceptSchema = z.object({
  document: z.enum(['customer_terms', 'partner_terms']),
  version: z.string().min(1).max(32),
});

/**
 * Staff sign in from `admin_users`, not `users`, so they have no row to hang
 * an acceptance on. They are not customers or technicians either.
 */
function customerOrTechnicianId(req: Request): string {
  const user = getAuthUser(req);
  if (user.staff) {
    throw AppError.forbidden('Staff accounts do not accept customer or partner terms', {
      messageKey: 'errors.auth.forbidden',
    });
  }
  return user.id;
}

/** `GET /api/v1/legal/me` — what this person has accepted, and what is current. */
router.get(
  '/me',
  authenticate,
  handle(async (req, res) => {
    res.status(200).json(await getLegalStatus(getContext(req), customerOrTechnicianId(req)));
  }),
);

/**
 * `POST /api/v1/legal/accept` — `{ document, version }`.
 *
 * Called when the person ticks the box and taps Accept on the screen every
 * app shows after sign-in. Answers with the same shape as `GET /legal/me`.
 */
router.post(
  '/accept',
  authenticate,
  handle(async (req, res) => {
    const userId = customerOrTechnicianId(req);
    const input = acceptSchema.parse(req.body);

    const status = await acceptLegalDocument(getContext(req), userId, input, {
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    res.status(200).json(status);
  }),
);
