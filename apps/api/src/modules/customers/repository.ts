// All Prisma and raw SQL for the customers domain. Nothing above this file
// contains a query — see docs/geo-notes.md for why the geography column forces
// raw statements here.
import { Prisma, type CustomerProfile, type PrismaClient } from '@prisma/client';
import type { AddressLabel } from '@prisma/client';
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
 * `location` is a `geography(Point, 4326)`, which Prisma Client cannot read, so
 * these all go through `$queryRaw` and project the point into plain lat/lng.
 * PostGIS stores points as (x, y) = (longitude, latitude) — the reverse of how
 * everyone says it aloud, which is exactly why it is unpacked in one place.
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

const ADDRESS_COLUMNS = Prisma.sql`
  id,
  user_id        AS "userId",
  label,
  label_text     AS "labelText",
  address_text   AS "addressText",
  landmark,
  city_id        AS "cityId",
  ST_Y(location::geometry) AS lat,
  ST_X(location::geometry) AS lng,
  is_default     AS "isDefault",
  created_at     AS "createdAt",
  updated_at     AS "updatedAt"
`;

/** `lng` first: ST_MakePoint takes (x, y). */
const point = (location: GeoPoint): Prisma.Sql =>
  Prisma.sql`ST_SetSRID(ST_MakePoint(${location.lng}::double precision, ${location.lat}::double precision), 4326)::geography`;

export function listAddresses(prisma: PrismaClient, userId: string): Promise<AddressRow[]> {
  return prisma.$queryRaw<AddressRow[]>`
    SELECT ${ADDRESS_COLUMNS}
    FROM addresses
    WHERE user_id = ${userId}::uuid
    ORDER BY is_default DESC, created_at ASC
  `;
}

/**
 * Always scoped by `user_id` as well as `id`: ownership is enforced in the WHERE
 * clause, so another user's address is simply not found rather than found and
 * then rejected.
 */
export async function findAddressForUser(
  prisma: PrismaClient,
  userId: string,
  addressId: string,
): Promise<AddressRow | null> {
  const rows = await prisma.$queryRaw<AddressRow[]>`
    SELECT ${ADDRESS_COLUMNS}
    FROM addresses
    WHERE id = ${addressId}::uuid AND user_id = ${userId}::uuid
  `;

  return rows[0] ?? null;
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

export async function insertAddress(
  prisma: PrismaClient,
  input: InsertAddressInput,
): Promise<AddressRow> {
  const rows = await prisma.$queryRaw<AddressRow[]>`
    INSERT INTO addresses
      (id, user_id, label, label_text, address_text, landmark, city_id, location, is_default, created_at, updated_at)
    VALUES (
      ${input.id}::uuid,
      ${input.userId}::uuid,
      ${input.label}::address_label,
      ${input.labelText},
      ${input.addressText},
      ${input.landmark},
      ${input.cityId},
      ${point(input.location)},
      ${input.isDefault},
      NOW(),
      NOW()
    )
    RETURNING ${ADDRESS_COLUMNS}
  `;

  const row = rows[0];
  if (!row) throw new Error('address insert returned no row');
  return row;
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
 * Builds a partial UPDATE. Only the keys actually present are touched, so a
 * PATCH that changes a landmark cannot silently blank out the label.
 */
export async function updateAddress(
  prisma: PrismaClient,
  userId: string,
  addressId: string,
  fields: UpdateAddressFields,
): Promise<AddressRow | null> {
  const assignments: Prisma.Sql[] = [];

  if (fields.label !== undefined) {
    assignments.push(Prisma.sql`label = ${fields.label}::address_label`);
  }
  if (fields.labelText !== undefined) {
    assignments.push(Prisma.sql`label_text = ${fields.labelText}`);
  }
  if (fields.addressText !== undefined) {
    assignments.push(Prisma.sql`address_text = ${fields.addressText}`);
  }
  if (fields.landmark !== undefined) {
    assignments.push(Prisma.sql`landmark = ${fields.landmark}`);
  }
  if (fields.cityId !== undefined) {
    assignments.push(Prisma.sql`city_id = ${fields.cityId}`);
  }
  if (fields.location !== undefined) {
    assignments.push(Prisma.sql`location = ${point(fields.location)}`);
  }

  assignments.push(Prisma.sql`updated_at = NOW()`);

  const rows = await prisma.$queryRaw<AddressRow[]>`
    UPDATE addresses
    SET ${Prisma.join(assignments, ', ')}
    WHERE id = ${addressId}::uuid AND user_id = ${userId}::uuid
    RETURNING ${ADDRESS_COLUMNS}
  `;

  return rows[0] ?? null;
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
