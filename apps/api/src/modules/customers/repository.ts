// All database access for the customers domain. Nothing above this file
// contains a query.
import type { AddressLabel, CustomerProfile, PrismaClient } from '@prisma/client';
import type { GeoPoint } from '../../core/geo';

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

export function findProfile(prisma: PrismaClient, userId: string): Promise<CustomerProfile | null> {
  return prisma.customerProfile.findUnique({ where: { userId } });
}

/** Created lazily — auth made the user row, the first profile write makes this one. */
export function upsertProfile(
  prisma: PrismaClient,
  userId: string,
  data: { displayName?: string | null; email?: string | null },
): Promise<CustomerProfile> {
  return prisma.customerProfile.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}

/* -------------------------------------------------------------------------- */
/* Addresses                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The shape returned by every address query.
 *
 * Structurally identical to the `Address` model, and named separately only so
 * callers keep depending on this module's contract rather than on Prisma's
 * generated type.
 */
export interface AddressRow {
  id: string;
  userId: string;
  label: AddressLabel;
  labelText: string | null;
  addressText: string;
  landmark: string | null;
  cityId: number;
  lat: number;
  lng: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Every address query selects exactly this — no relations, no stray columns —
 * so `AddressRow` and what comes back cannot drift apart.
 */
const ADDRESS_SELECT = {
  id: true,
  userId: true,
  label: true,
  labelText: true,
  addressText: true,
  landmark: true,
  cityId: true,
  lat: true,
  lng: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function listAddresses(prisma: PrismaClient, userId: string): Promise<AddressRow[]> {
  return prisma.address.findMany({
    where: { userId },
    select: ADDRESS_SELECT,
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
}

/**
 * Always scoped by `userId` as well as `id`: ownership is enforced in the
 * filter, so another user's address is simply not found rather than found and
 * then rejected.
 */
export function findAddressForUser(
  prisma: PrismaClient,
  userId: string,
  addressId: string,
): Promise<AddressRow | null> {
  return prisma.address.findFirst({
    where: { id: addressId, userId },
    select: ADDRESS_SELECT,
  });
}

export function countAddresses(prisma: PrismaClient, userId: string): Promise<number> {
  return prisma.address.count({ where: { userId } });
}

export interface InsertAddressInput {
  id: string;
  userId: string;
  label: AddressLabel;
  labelText: string | null;
  addressText: string;
  landmark: string | null;
  cityId: number;
  location: GeoPoint;
  isDefault: boolean;
}

export function insertAddress(
  prisma: PrismaClient,
  input: InsertAddressInput,
): Promise<AddressRow> {
  const { location, ...rest } = input;

  return prisma.address.create({
    data: { ...rest, lat: location.lat, lng: location.lng },
    select: ADDRESS_SELECT,
  });
}

export interface UpdateAddressFields {
  label?: AddressLabel;
  labelText?: string | null;
  addressText?: string;
  landmark?: string | null;
  cityId?: number;
  location?: GeoPoint;
}

/**
 * A partial update. Only the keys actually present are touched, so a PATCH that
 * changes a landmark cannot silently blank out the label.
 *
 * `updateMany` rather than `update`: the row must match on `userId` too, and
 * only `updateMany` takes a non-unique filter. It returns a count rather than
 * the row, so the updated address is read back afterwards.
 */
export async function updateAddress(
  prisma: PrismaClient,
  userId: string,
  addressId: string,
  fields: UpdateAddressFields,
): Promise<AddressRow | null> {
  const { location, ...scalar } = fields;

  const result = await prisma.address.updateMany({
    where: { id: addressId, userId },
    data: {
      ...scalar,
      ...(location !== undefined ? { lat: location.lat, lng: location.lng } : {}),
    },
  });

  if (result.count === 0) return null;

  return findAddressForUser(prisma, userId, addressId);
}

export async function deleteAddress(
  prisma: PrismaClient,
  userId: string,
  addressId: string,
): Promise<boolean> {
  const result = await prisma.address.deleteMany({ where: { id: addressId, userId } });
  return result.count > 0;
}

/**
 * Promotes one address to default. A partial unique index enforces one default
 * per user, so clearing and setting must happen in a single transaction or the
 * intermediate state would violate it.
 */
export async function setDefaultAddress(
  prisma: PrismaClient,
  userId: string,
  addressId: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const owned = await tx.address.count({ where: { id: addressId, userId } });
    if (owned === 0) return false;

    await tx.address.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
    await tx.address.update({ where: { id: addressId }, data: { isDefault: true } });

    return true;
  });
}

/** Keeps a user from ending up with addresses but no default after a delete. */
export async function promoteOldestToDefault(prisma: PrismaClient, userId: string): Promise<void> {
  const hasDefault = await prisma.address.count({ where: { userId, isDefault: true } });
  if (hasDefault > 0) return;

  const oldest = await prisma.address.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (oldest) {
    await prisma.address.update({ where: { id: oldest.id }, data: { isDefault: true } });
  }
}
