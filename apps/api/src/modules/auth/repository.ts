// All Prisma access for the auth domain. Nothing else in this module touches the DB.
import type { Prisma, PrismaClient, RefreshToken, Role, User, UserStatus } from '@prisma/client';
import type { Role as SharedRole } from '@fixbridge/shared';

export type UserWithRoles = User & { roles: { role: Role }[] };

const withRoles = { roles: { select: { role: true } } } satisfies Prisma.UserInclude;

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

export function findUserByPhone(
  prisma: PrismaClient,
  phone: string,
): Promise<UserWithRoles | null> {
  return prisma.user.findUnique({ where: { phone }, include: withRoles });
}

export function findUserById(prisma: PrismaClient, id: string): Promise<UserWithRoles | null> {
  return prisma.user.findUnique({ where: { id }, include: withRoles });
}

/**
 * First sign-in creates the account. `upsert` rather than create-if-absent so two
 * OTP verifications racing on the same phone cannot both insert.
 */
export function createUserWithRoles(
  prisma: PrismaClient,
  phone: string,
  roles: SharedRole[],
): Promise<UserWithRoles> {
  return prisma.user.upsert({
    where: { phone },
    update: {},
    create: {
      phone,
      roles: { create: roles.map((role) => ({ role: role as Role })) },
    },
    include: withRoles,
  });
}

export function extractRoles(user: UserWithRoles): SharedRole[] {
  return user.roles.map((entry) => entry.role as SharedRole);
}

export function setUserStatus(
  prisma: PrismaClient,
  userId: string,
  status: UserStatus,
): Promise<UserWithRoles> {
  return prisma.user.update({
    where: { id: userId },
    data: { status },
    include: withRoles,
  });
}

/** Kills every live refresh token for a user, across all their devices. */
export async function revokeAllForUser(
  prisma: PrismaClient,
  userId: string,
  now: Date,
): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });

  return result.count;
}

/* -------------------------------------------------------------------------- */
/* Refresh tokens                                                             */
/* -------------------------------------------------------------------------- */

export interface CreateRefreshTokenInput {
  userId: string;
  tokenHash: string;
  deviceId: string;
  deviceInfo: string | null;
  expiresAt: Date;
}

export function createRefreshToken(
  prisma: PrismaClient,
  input: CreateRefreshTokenInput,
): Promise<RefreshToken> {
  return prisma.refreshToken.create({ data: input });
}

export function findRefreshTokenByHash(
  prisma: PrismaClient,
  tokenHash: string,
): Promise<RefreshToken | null> {
  return prisma.refreshToken.findUnique({ where: { tokenHash } });
}

/**
 * Rotation, in one transaction: mint the successor and retire the predecessor
 * pointing at it. If either half fails, neither happens — a half-rotated pair
 * would either lock the user out or leave two live tokens.
 */
export async function rotateRefreshToken(
  prisma: PrismaClient,
  previousTokenId: string,
  next: CreateRefreshTokenInput,
  now: Date,
): Promise<RefreshToken> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.refreshToken.create({ data: next });

    await tx.refreshToken.update({
      where: { id: previousTokenId },
      data: { revokedAt: now, replacedByTokenId: created.id },
    });

    return created;
  });
}

export async function revokeRefreshToken(
  prisma: PrismaClient,
  tokenId: string,
  now: Date,
): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { id: tokenId, revokedAt: null },
    data: { revokedAt: now },
  });
}

/**
 * Theft response: kill every live token for this device. The user is signed out
 * on that device and must re-authenticate with an OTP.
 */
export async function revokeAllForDevice(
  prisma: PrismaClient,
  userId: string,
  deviceId: string,
  now: Date,
): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, deviceId, revokedAt: null },
    data: { revokedAt: now },
  });

  return result.count;
}
