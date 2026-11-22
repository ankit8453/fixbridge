import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { AUDIT_ACTIONS, auditActor, writeAuditLog } from '../../core/audit';
import { getContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { requireRoles } from '../../core/middleware/require-roles';
import { maskPhone } from './phone';
import { createRelayStore, whatsappUrl, type RelayRequest } from './relay';

/**
 * The console's "Sign-in requests" page — see `relay.ts` for why sign-in
 * codes are sent by hand during the pilot.
 *
 * Mounted at `/api/v1/admin/otp-relay`. Every staff role may use it: a
 * customer waiting for a code should not depend on which of the team is free.
 */
export const router = Router();

router.use(authenticate, requireRoles('ops', 'admin'));

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const idParamSchema = z.object({ id: z.string().uuid() });

function storeFor(req: Request) {
  const context = getContext(req);
  return createRelayStore(context.redis, context.config.OTP_TTL_SECONDS);
}

function view(request: RelayRequest, now: Date) {
  return { ...request, whatsappUrl: whatsappUrl(request, now) };
}

/** What the console shows next to "Sent by". */
async function staffName(req: Request): Promise<string> {
  const context = getContext(req);
  const user = getAuthUser(req);

  const named = user.staff
    ? await context.prisma.adminUser.findUnique({ where: { id: user.id }, select: { name: true } })
    : await context.prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });

  return named?.name ?? 'Staff';
}

/** `GET /admin/otp-relay` — every code still waiting, newest first. */
router.get(
  '/',
  handle(async (req, res) => {
    const now = new Date();
    const requests = await storeFor(req).list(now);

    res.status(200).json({ requests: requests.map((request) => view(request, now)) });
  }),
);

/**
 * `POST /admin/otp-relay/:id/sent` — "I have sent this one".
 *
 * Recorded in the audit log, so if anyone ever says they got a code they did
 * not ask for, there is a record of who sent which number a code and when.
 * The code itself is never written there.
 */
router.post(
  '/:id/sent',
  handle(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const context = getContext(req);
    const now = new Date();

    const request = await storeFor(req).markSent(id, await staffName(req), now);
    if (!request) {
      throw AppError.notFound('That sign-in request has expired or been used', {
        messageKey: 'errors.notFound',
      });
    }

    await writeAuditLog(context.prisma, auditActor(req), {
      action: AUDIT_ACTIONS.otpRelaySent,
      targetType: 'otp_relay',
      targetId: request.id,
      payload: { phone: maskPhone(request.phone), sentBy: request.sentBy },
    });

    res.status(200).json({ request: view(request, now) });
  }),
);
