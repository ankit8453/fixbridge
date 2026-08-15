import type { RequestHandler } from 'express';
import type { Role } from '@fixbridge/shared';
import { AppError } from '../errors';

/**
 * Allows the request through when the user holds **at least one** of the listed
 * roles. Must be mounted after `authenticate`.
 *
 * The 403 details name the required roles but never the user's own — telling a
 * caller what they are missing is fine; enumerating what they have is not.
 */
export function requireRoles(...roles: [Role, ...Role[]]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(
        AppError.internal('requireRoles used without authenticate — req.user is not set', {
          details: { requiredRoles: roles },
        }),
      );
      return;
    }

    const held = new Set(req.user.roles);

    if (!roles.some((role) => held.has(role))) {
      next(
        new AppError(403, 'FORBIDDEN', `Requires one of: ${roles.join(', ')}`, {
          messageKey: 'errors.auth.forbidden',
          details: { requiredRoles: roles },
        }),
      );
      return;
    }

    next();
  };
}
