import type { Request, RequestHandler } from 'express';
import type { AuthenticatedUser } from '@fixbridge/shared';
import { AppError } from '../errors';
import { getContext } from '../context';
import { extractBearerToken, verifyAccessToken } from '../../modules/auth/tokens';

function unauthorized(code: string, messageKey: string, detail: string): AppError {
  return new AppError(401, code, detail, {
    messageKey,
    headers: { 'WWW-Authenticate': 'Bearer' },
  });
}

/**
 * Verifies the Bearer access token and attaches `req.user`.
 *
 * Deliberately stateless — no database round trip per request. That is the point
 * of a 15-minute access token: revocation happens at refresh time, and anything
 * needing live user state (`/me`, and every future write path) loads the user
 * itself. `assertActive` in the auth service is where a blocked account is caught.
 *
 * Expired and invalid are separate codes so a client knows whether to refresh
 * silently or force a new sign-in.
 */
async function resolveUser(req: Request): Promise<void> {
  const token = extractBearerToken(req.header('authorization'));

  if (token === null) {
    throw unauthorized(
      'AUTH_TOKEN_MISSING',
      'errors.auth.tokenMissing',
      'Missing or malformed Authorization header',
    );
  }

  const context = getContext(req);
  const result = verifyAccessToken(context.config, token);

  if (result.status === 'expired') {
    throw unauthorized(
      'AUTH_TOKEN_EXPIRED',
      'errors.auth.tokenExpired',
      'Access token has expired',
    );
  }

  if (result.status === 'invalid') {
    throw unauthorized(
      'AUTH_TOKEN_INVALID',
      'errors.auth.tokenInvalid',
      'Access token is not valid',
    );
  }

  // Signature is good — but the account may have been blocked since it was
  // signed. One Redis EXISTS is the price of not honouring a 15-minute-stale
  // token; see denylist.ts for the fail-open reasoning.
  if (await context.userDenylist.has(result.claims.sub)) {
    throw unauthorized(
      'AUTH_SESSION_REVOKED',
      'errors.auth.sessionRevoked',
      `Access revoked for user ${result.claims.sub}`,
    );
  }

  req.user = {
    id: result.claims.sub,
    roles: result.claims.roles,
    deviceId: result.claims.deviceId,
  };
}

export const authenticate: RequestHandler = (req, _res, next) => {
  resolveUser(req).then(() => next(), next);
};

/**
 * Reads `req.user` for a route that sits behind `authenticate`. Throws rather
 * than returning undefined so a mis-wired route fails loudly instead of silently
 * serving an unauthenticated request.
 */
export function getAuthUser(req: Request): AuthenticatedUser {
  if (!req.user) {
    throw AppError.internal('Route requires authenticate middleware but req.user is not set');
  }

  return req.user;
}
