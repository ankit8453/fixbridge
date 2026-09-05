import { randomUUID } from 'node:crypto';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { isValidLatLng, type GeoPoint } from '../../core/geo';
import * as repo from './repository';
import type {
  AddressResponse,
  CreateAddressInput,
  CustomerProfileResponse,
  UpdateAddressInput,
  UpdateCustomerProfileInput,
} from './types';

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

function toProfileResponse(
  userId: string,
  profile: {
    displayName: string | null;
    email: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null,
): CustomerProfileResponse | null {
  if (!profile) return null;

  return {
    userId,
    displayName: profile.displayName,
    email: profile.email,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

/**
 * Returns null rather than 404 when no profile exists yet: the account is real,
 * it just has not been filled in. The client uses null to open the setup screen.
 */
export async function getProfile(
  context: AppContext,
  userId: string,
): Promise<CustomerProfileResponse | null> {
  return toProfileResponse(userId, await repo.findProfile(context.prisma, userId));
}

export async function updateProfile(
  context: AppContext,
  userId: string,
  input: UpdateCustomerProfileInput,
): Promise<CustomerProfileResponse> {
  const profile = await repo.upsertProfile(context.prisma, userId, input);
  const response = toProfileResponse(userId, profile);

  if (!response) throw AppError.internal('customer profile upsert returned nothing');
  return response;
}

/* -------------------------------------------------------------------------- */
/* Addresses                                                                  */
/* -------------------------------------------------------------------------- */

function toAddressResponse(row: repo.AddressRow): AddressResponse {
  return {
    id: row.id,
    label: row.label,
    labelText: row.labelText,
    addressText: row.addressText,
    landmark: row.landmark,
    cityId: row.cityId,
    location: { lat: row.lat, lng: row.lng },
    /// False when the point was derived from the text rather than measured.
    /// Anything navigating to it must treat it as approximate.
    isPinned: row.isPinned,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Every address ends up with a point. If the client had GPS it sends one;
 * otherwise the address text and landmark go to the geocoder. There is no
 * "address without coordinates" state to handle later.
 */
/**
 * Where an address actually is — and whether we know that or guessed it.
 *
 * The two cases produce identical-looking coordinates and are not remotely
 * equivalent. A device fix is the customer's doorstep. A geocode, with the
 * stub currently wired in, is the address text **hashed** into a point inside
 * Jabalpur: plausible, precise-looking, and not where anybody lives. Handing
 * that to a technician as a map pin sends them confidently to a stranger's
 * street, which is what happened.
 *
 * So the origin travels with the point and every consumer has to face it.
 */
async function resolveLocation(
  context: AppContext,
  supplied: { lat?: number; lng?: number },
  text: { addressText: string; landmark: string | null; cityId: number },
): Promise<GeoPoint & { isPinned: boolean }> {
  if (supplied.lat !== undefined && supplied.lng !== undefined) {
    const point = { lat: supplied.lat, lng: supplied.lng };

    if (!isValidLatLng(point)) {
      throw AppError.badRequest('Supplied coordinates are not a valid point', {
        messageKey: 'errors.customers.invalidLocation',
        details: point,
      });
    }

    return { ...point, isPinned: true };
  }

  const geocoded = await context.geo.geocode({
    addressText: text.addressText,
    landmark: text.landmark,
    cityId: text.cityId,
  });

  return { ...geocoded, isPinned: false };
}

function addressNotFound(addressId: string): AppError {
  // 404 rather than 403: a stranger's address should not be confirmed to exist.
  return new AppError(404, 'ADDRESS_NOT_FOUND', `Address ${addressId} not found for this user`, {
    messageKey: 'errors.customers.addressNotFound',
  });
}

export async function listAddresses(
  context: AppContext,
  userId: string,
): Promise<AddressResponse[]> {
  const rows = await repo.listAddresses(context.prisma, userId);
  return rows.map(toAddressResponse);
}

export async function getAddress(
  context: AppContext,
  userId: string,
  addressId: string,
): Promise<AddressResponse> {
  const row = await repo.findAddressForUser(context.prisma, userId, addressId);
  if (!row) throw addressNotFound(addressId);

  return toAddressResponse(row);
}

export async function createAddress(
  context: AppContext,
  userId: string,
  input: CreateAddressInput,
): Promise<AddressResponse> {
  const existing = await repo.countAddresses(context.prisma, userId);

  if (existing >= context.config.MAX_ADDRESSES_PER_USER) {
    throw new AppError(
      409,
      'ADDRESS_LIMIT_REACHED',
      `User already has ${existing} addresses (max ${context.config.MAX_ADDRESSES_PER_USER})`,
      {
        messageKey: 'errors.customers.addressLimitReached',
        details: { limit: context.config.MAX_ADDRESSES_PER_USER },
      },
    );
  }

  const cityId = input.cityId ?? context.config.DEFAULT_CITY_ID;
  const landmark = input.landmark ?? null;
  const location = await resolveLocation(context, input, {
    addressText: input.addressText,
    landmark,
    cityId,
  });

  // The first address a user saves is their default whether they asked or not.
  const isDefault = input.isDefault ?? existing === 0;

  const row = await context.prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return repo.insertAddress(tx as never, {
      id: randomUUID(),
      userId,
      label: input.label,
      labelText: input.labelText ?? null,
      addressText: input.addressText,
      landmark,
      cityId,
      location,
      isPinned: location.isPinned,
      isDefault,
    });
  });

  return toAddressResponse(row);
}

export async function updateAddress(
  context: AppContext,
  userId: string,
  addressId: string,
  input: UpdateAddressInput,
): Promise<AddressResponse> {
  const existing = await repo.findAddressForUser(context.prisma, userId, addressId);
  if (!existing) throw addressNotFound(addressId);

  const addressText = input.addressText ?? existing.addressText;
  const landmark = input.landmark === undefined ? existing.landmark : input.landmark;
  const cityId = input.cityId ?? existing.cityId;

  const coordinatesSupplied = input.lat !== undefined && input.lng !== undefined;
  // Re-geocode when the text moved but the client gave us no new fix, otherwise
  // the pin would keep pointing at the old house.
  const textChanged = addressText !== existing.addressText || landmark !== existing.landmark;

  const location =
    coordinatesSupplied || textChanged
      ? await resolveLocation(context, input, { addressText, landmark, cityId })
      : undefined;

  const row = await repo.updateAddress(context.prisma, userId, addressId, {
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.labelText !== undefined ? { labelText: input.labelText } : {}),
    ...(input.addressText !== undefined ? { addressText } : {}),
    ...(input.landmark !== undefined ? { landmark } : {}),
    ...(input.cityId !== undefined ? { cityId } : {}),
    ...(location !== undefined ? { location, isPinned: location.isPinned } : {}),
  });

  if (!row) throw addressNotFound(addressId);
  return toAddressResponse(row);
}

export async function deleteAddress(
  context: AppContext,
  userId: string,
  addressId: string,
): Promise<void> {
  const deleted = await repo.deleteAddress(context.prisma, userId, addressId);
  if (!deleted) throw addressNotFound(addressId);

  // Deleting the default would otherwise leave the user with no default at all.
  await repo.promoteOldestToDefault(context.prisma, userId);
}

export async function setDefaultAddress(
  context: AppContext,
  userId: string,
  addressId: string,
): Promise<AddressResponse> {
  const ok = await repo.setDefaultAddress(context.prisma, userId, addressId);
  if (!ok) throw addressNotFound(addressId);

  return getAddress(context, userId, addressId);
}
