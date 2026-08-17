import { Router, type Request, type RequestHandler } from 'express';
import { getContext } from '../../core/context';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { requireRoles } from '../../core/middleware/require-roles';
import * as adminLogin from './admin-login';
import * as service from './service';
import { updatePreferencesSchema } from '../notifications/types';
import {
  adminPasswordSchema,
  adminVerifySchema,
  logoutSchema,
  refreshSchema,
  requestOtpSchema,
  verifyOtpSchema,
} from './types';
import type { RequestContextInfo } from './types';

export const router = Router();

/** Wraps an async handler so a rejected promise reaches the error middleware. */
const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

function deps(req: Request): service.AuthDeps {
  const context = getContext(req);
  return { context, transport: context.otpTransport };
}

/** Caller metadata the service needs for rate limiting and device binding. */
function requestInfo(req: Request): RequestContextInfo {
  return {
    ip: req.ip ?? 'unknown',
    userAgent: req.header('user-agent') ?? null,
  };
}

/**
 * POST /api/v1/auth/otp/request
 * Rate limited per phone and per IP. The response never contains the OTP.
 */
router.post(
  '/otp/request',
  handle(async (req, res) => {
    const input = requestOtpSchema.parse(req.body);
    const result = await service.requestOtp(deps(req), input, requestInfo(req));

    res.status(200).json({
      ...result,
      message: req.t('auth.otpSent', { minutes: Math.round(result.expiresInSeconds / 60) }),
    });
  }),
);

/**
 * POST /api/v1/auth/otp/verify
 * Creates the account on first successful verification.
 */
router.post(
  '/otp/verify',
  handle(async (req, res) => {
    const input = verifyOtpSchema.parse(req.body);
    const session = await service.verifyOtp(deps(req), input, requestInfo(req));

    res.status(200).json({ ...session, message: req.t('auth.loggedIn') });
  }),
);

/**
 * POST /api/v1/auth/refresh
 * Rotates the refresh token. Replaying a rotated token revokes the whole device.
 */
router.post(
  '/refresh',
  handle(async (req, res) => {
    const input = refreshSchema.parse(req.body);
    const session = await service.refreshSession(deps(req), input, requestInfo(req));

    res.status(200).json(session);
  }),
);

/** POST /api/v1/auth/logout — idempotent. */
router.post(
  '/logout',
  handle(async (req, res) => {
    const input = logoutSchema.parse(req.body);
    await service.logout(deps(req), input);

    res.status(200).json({ message: req.t('auth.loggedOut') });
  }),
);

/** GET /api/v1/auth/me — the demo protected route. */
router.get(
  '/me',
  authenticate,
  handle(async (req, res) => {
    const user = await service.getCurrentUser(deps(req), getAuthUser(req).id);

    res.status(200).json({ user, deviceId: getAuthUser(req).deviceId });
  }),
);

/* -------------------------------------------------------------------------- */
/* The ops console: password, then OTP                                        */
/* -------------------------------------------------------------------------- */

/**
 * `POST /api/v1/auth/admin/password`
 *
 * Step one of two. Returns a **challenge**, never a session — see
 * `admin-login.ts` for why the split is what makes the password a real first
 * factor rather than decoration.
 */
router.post(
  '/admin/password',
  handle(async (req, res) => {
    const input = adminPasswordSchema.parse(req.body);
    const context = getContext(req);

    const challenge = await adminLogin.startAdminLogin(
      {
        context,
        // The same transport the customer flow uses — one delivery path to wire
        // to a real provider in Phase 15, not two.
        sendOtp: (phone, otp, expiresInSeconds) =>
          context.otpTransport.send({ phone, otp, expiresInSeconds }),
      },
      input,
      { ip: req.ip ?? 'unknown' },
    );

    res.status(200).json({ ...challenge, message: req.t('auth.adminCodeSent') });
  }),
);

/**
 * `POST /api/v1/auth/admin/verify`
 *
 * Step two. Consumes the challenge and issues the session — the same session
 * shape every other sign-in returns, so nothing downstream has to know an ops
 * user arrived by a different door.
 */
router.post(
  '/admin/verify',
  handle(async (req, res) => {
    const input = adminVerifySchema.parse(req.body);
    const context = getContext(req);

    const userId = await adminLogin.completeAdminLogin(context, input);
    const session = await service.issueSessionForUser(
      deps(req),
      userId,
      input.deviceId,
      requestInfo(req),
    );

    res.status(200).json({ ...session, message: req.t('auth.loggedIn') });
  }),
);

/**
 * PATCH /api/v1/auth/me — the one notification preference v1 ships.
 *
 * Language lives on the user rather than on the customer or technician profile
 * because most people here are both, and nobody expects to set their language
 * twice. There are deliberately no per-topic opt-outs: everything routed is
 * transactional, and switching off "booking accepted" would break the product
 * silently for whoever did it.
 */
router.patch(
  '/me',
  authenticate,
  handle(async (req, res) => {
    const input = updatePreferencesSchema.parse(req.body);

    const user = await service.setPreferredLanguage(
      deps(req),
      getAuthUser(req).id,
      input.preferredLanguage,
    );

    res.status(200).json({ user, message: req.t('auth.preferencesSaved') });
  }),
);

/**
 * GET /api/v1/auth/admin-only
 *
 * Demo route proving `requireRoles`. It lives here rather than in the admin
 * module because that module belongs to Phase 11; delete it when real admin
 * endpoints land.
 */
router.get('/admin-only', authenticate, requireRoles('admin'), (req, res) => {
  res.status(200).json({ ok: true, roles: getAuthUser(req).roles });
});
