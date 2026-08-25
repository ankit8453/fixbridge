import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import type { Role } from '@prisma/client';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from './tokens';
import type { AdminIdentity } from './admin-login';

/**
 * Sessions for staff.
 *
 * ## Why this is not `service.issueSessionForUser`
 *
 * That function looks the account up with `findUserById` and stores the refresh
 * token in `refresh_tokens`, whose `user_id` carries a foreign key to `users`.
 * Staff are `admin_users` rows. Passing an admin id to it fails twice over: the
 * lookup finds nothing and answers "that account no longer exists", and even if
 * it did, the token insert would violate the foreign key.
 *
 * That is not hypothetical — it is exactly what `/auth/admin/login` did after
 * staff moved out of `users`. It typechecked, because both ids are strings, and
 * returned 401 on every single sign-in.
 *
 * ## What staff sessions share with everybody else's
 *
 * The token *shape* is identical: same signing key, same TTL, same opaque
 * refresh token of which only a hash is stored, same rotation rules. Downstream
 * middleware does not need to know which door a request came through.
 *
 * ## How roles work now
 *
 * `AdminUser.role` is `admin` or `subadmin`, but the guards
 * (`requireRoles`, `ADMIN_ONLY_ROUTES`) are written against the `Role` enum's
 * `ops`/`admin`. Rather than rewrite every guard, an admin maps to
 * `['admin','ops']` and a sub-admin to `['ops']` — which preserves the Phase 12
 * split exactly: sub-admins do the judgment work, only a full admin can refund,
 * mark a payout paid, settle dues or change city config.
 */

/** The `Role`s a staff account presents to the existing guards. */
export function rolesForAdmin(role: 'admin' | 'subadmin'): Role[] {
  return role === 'admin' ? (['admin', 'ops'] as Role[]) : (['ops'] as Role[]);
}

export interface AdminSession {
  tokenType: 'Bearer';
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: string;
  /** The staff-specific view: email and the admin/subadmin role. */
  admin: {
    id: string;
    email: string;
    name: string;
    role: 'admin' | 'subadmin';
    roles: Role[];
  };
  /**
   * The same identity again under the key every other sign-in uses.
   *
   * The web client's `adopt()` reads `session.user` for all four surfaces. If
   * this endpoint returned only `admin`, the console would store the tokens and
   * then render with no identity and no roles — signed in, but unable to show
   * who or gate anything. Returning both keeps one client code path.
   *
   * `phone` is null rather than a placeholder: staff genuinely have none, and a
   * fake number would eventually be displayed to somebody.
   */
  user: {
    id: string;
    phone: null;
    name: string;
    roles: Role[];
    status: 'active';
    defaultCityId: null;
    preferredLanguage: 'en';
  };
}

/** Both shapes of the same identity — see `AdminSession.user`. */
function identityFor(
  admin: { id: string; email: string; name: string; role: 'admin' | 'subadmin' },
  roles: Role[],
): Pick<AdminSession, 'admin' | 'user'> {
  return {
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role, roles },
    user: {
      id: admin.id,
      phone: null,
      name: admin.name,
      roles,
      status: 'active',
      defaultCityId: null,
      preferredLanguage: 'en',
    },
  };
}

export async function issueAdminSession(
  context: AppContext,
  admin: AdminIdentity,
  deviceId: string,
  info: { userAgent?: string | null },
): Promise<AdminSession> {
  const now = new Date();
  const refreshToken = generateRefreshToken();
  const expiresAt = refreshTokenExpiry(context.config, now);
  const roles = rolesForAdmin(admin.role);

  await context.prisma.adminRefreshToken.create({
    data: {
      adminId: admin.id,
      tokenHash: hashRefreshToken(refreshToken),
      deviceId,
      deviceInfo: info.userAgent ? info.userAgent.slice(0, 512) : null,
      expiresAt,
    },
  });

  return {
    tokenType: 'Bearer',
    accessToken: signAccessToken(context.config, { sub: admin.id, roles, deviceId }),
    expiresIn: context.config.JWT_ACCESS_TTL_SECONDS,
    refreshToken,
    refreshExpiresAt: expiresAt.toISOString(),
    ...identityFor(admin, roles),
  };
}

/**
 * Exchanges a staff refresh token for a new session, rotating the old one.
 *
 * Rotation is single-use: the presented token is revoked and linked to its
 * replacement. A token offered twice is therefore already revoked the second
 * time, which is the signal that it was stolen — and the reason the whole
 * device's tokens are dropped rather than just refusing this one request.
 */
export async function refreshAdminSession(
  context: AppContext,
  presentedToken: string,
  deviceId: string,
  info: { userAgent?: string | null },
): Promise<AdminSession> {
  const tokenHash = hashRefreshToken(presentedToken);

  const existing = await context.prisma.adminRefreshToken.findUnique({
    where: { tokenHash },
    include: { admin: true },
  });

  const invalid = (): AppError =>
    AppError.unauthorized('That session is no longer valid', {
      messageKey: 'errors.auth.tokenInvalid',
    });

  if (!existing) throw invalid();

  if (existing.revokedAt) {
    /**
     * Reuse of an already-rotated token. Either it was stolen, or a client
     * retried after the rotation succeeded. Both are handled the same way:
     * revoke every live token for that device, so a thief and the real owner
     * both have to sign in again rather than the thief keeping a foothold.
     */
    await context.prisma.adminRefreshToken.updateMany({
      where: { adminId: existing.adminId, deviceId: existing.deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    context.logger.warn(
      { adminId: existing.adminId, deviceId: existing.deviceId },
      'admin refresh token reused after rotation — device sessions revoked',
    );

    throw invalid();
  }

  if (existing.expiresAt <= new Date()) throw invalid();
  if (existing.admin.status !== 'active') throw invalid();

  const next = generateRefreshToken();
  const expiresAt = refreshTokenExpiry(context.config, new Date());
  const roles = rolesForAdmin(existing.admin.role);

  const created = await context.prisma.adminRefreshToken.create({
    data: {
      adminId: existing.adminId,
      tokenHash: hashRefreshToken(next),
      deviceId,
      deviceInfo: info.userAgent ? info.userAgent.slice(0, 512) : null,
      expiresAt,
    },
  });

  await context.prisma.adminRefreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), replacedByTokenId: created.id },
  });

  return {
    tokenType: 'Bearer',
    accessToken: signAccessToken(context.config, {
      sub: existing.adminId,
      roles,
      deviceId,
    }),
    expiresIn: context.config.JWT_ACCESS_TTL_SECONDS,
    refreshToken: next,
    refreshExpiresAt: expiresAt.toISOString(),
    ...identityFor(existing.admin, roles),
  };
}

/** Revokes every live token for a staff account on one device. */
export async function revokeAdminSession(
  context: AppContext,
  presentedToken: string,
): Promise<void> {
  const existing = await context.prisma.adminRefreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(presentedToken) },
    select: { adminId: true, deviceId: true },
  });

  // Idempotent, like the customer logout: an unknown token still answers 200,
  // so logout cannot be used to probe which tokens exist.
  if (!existing) return;

  await context.prisma.adminRefreshToken.updateMany({
    where: { adminId: existing.adminId, deviceId: existing.deviceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
