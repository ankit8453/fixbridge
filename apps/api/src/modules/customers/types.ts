import { z } from 'zod';
import type { AddressLabel } from '@prisma/client';
import type { GeoPoint } from '../../core/geo';

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

export const updateCustomerProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    // `null` clears the email; omitting the key leaves it untouched.
    email: z.union([z.string().trim().toLowerCase().email().max(255), z.null()]).optional(),
  })
  .strict();

export type UpdateCustomerProfileInput = z.infer<typeof updateCustomerProfileSchema>;

export interface CustomerProfileResponse {
  userId: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Addresses                                                                  */
/* -------------------------------------------------------------------------- */

const latitude = z.coerce.number().min(-90).max(90);
const longitude = z.coerce.number().min(-180).max(180);

/**
 * Coordinates are optional: a client with GPS sends them, and everyone else gets
 * geocoded from the text. Both must arrive together — a lone lat is a bug, not
 * half an answer.
 */
const coordinates = z
  .object({ lat: latitude.optional(), lng: longitude.optional() })
  .refine((value) => (value.lat === undefined) === (value.lng === undefined), {
    message: 'lat and lng must be supplied together',
    path: ['lat'],
  });

export const createAddressSchema = z
  .object({
    label: z.enum(['home', 'shop', 'other']).default('other'),
    labelText: z.string().trim().min(1).max(60).optional(),
    addressText: z.string().trim().min(5).max(500),
    landmark: z.string().trim().min(1).max(200).optional(),
    cityId: z.coerce.number().int().min(1).optional(),
    isDefault: z.boolean().optional(),
  })
  .and(coordinates);

export type CreateAddressInput = z.infer<typeof createAddressSchema>;

export const updateAddressSchema = z
  .object({
    label: z.enum(['home', 'shop', 'other']).optional(),
    labelText: z.union([z.string().trim().min(1).max(60), z.null()]).optional(),
    addressText: z.string().trim().min(5).max(500).optional(),
    landmark: z.union([z.string().trim().min(1).max(200), z.null()]).optional(),
    cityId: z.coerce.number().int().min(1).optional(),
  })
  .and(coordinates);

export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

export const addressIdParamSchema = z.object({
  addressId: z.string().uuid(),
});

export interface AddressResponse {
  id: string;
  label: AddressLabel;
  labelText: string | null;
  addressText: string;
  landmark: string | null;
  cityId: number;
  location: GeoPoint;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
