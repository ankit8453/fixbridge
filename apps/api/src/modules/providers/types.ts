import { z } from 'zod';
import type { PriceType, ProviderDocumentType } from '@prisma/client';
import type { GeoPoint } from '../../core/geo';
import type { CompletenessBreakdownEntry, CompletenessItem } from './completeness';
import { parseTimeOfDay } from './availability';

/* -------------------------------------------------------------------------- */
/* Shared fields                                                              */
/* -------------------------------------------------------------------------- */

/** `"18:00"` in, minutes-from-midnight out — the wire stays human-readable. */
const timeOfDay = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const minutes = parseTimeOfDay(value);

    if (minutes === null) {
      ctx.addIssue({ code: 'custom', message: 'must be a time of day in HH:MM (24-hour) form' });
      return z.NEVER;
    }

    return minutes;
  });

const location = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/* -------------------------------------------------------------------------- */
/* Registration & profile                                                     */
/* -------------------------------------------------------------------------- */

export const registerProviderSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    cityId: z.coerce.number().int().min(1).optional(),
  })
  .strict();

export type RegisterProviderInput = z.infer<typeof registerProviderSchema>;

export const updateProviderProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    bio: z.union([z.string().trim().min(1).max(1000), z.null()]).optional(),
    yearsExperience: z.union([z.coerce.number().int().min(0).max(70), z.null()]).optional(),
    cityId: z.coerce.number().int().min(1).optional(),
    serviceRadiusKm: z.coerce.number().int().min(1).max(25).optional(),
    baseLocation: location.optional(),
  })
  .strict();

export type UpdateProviderProfileInput = z.infer<typeof updateProviderProfileSchema>;

/* -------------------------------------------------------------------------- */
/* Skills                                                                     */
/* -------------------------------------------------------------------------- */

export const addSkillSchema = z
  .object({
    categoryId: z.coerce.number().int().min(1),
    experienceNote: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

export type AddSkillInput = z.infer<typeof addSkillSchema>;

export const categoryIdParamSchema = z.object({
  categoryId: z.coerce.number().int().min(1),
});

/* -------------------------------------------------------------------------- */
/* Price cards                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `inspection_based` means "I need to see it first", so an amount would be a
 * lie; every other type must carry one. Cross-field, hence `superRefine`.
 */
const priceCardShape = {
  categoryId: z.coerce.number().int().min(1),
  title: z.string().trim().min(1).max(120),
  priceType: z.enum(['fixed', 'starting_from', 'inspection_based']),
  /** Integer paise. Never rupees, never a float. */
  amountPaise: z.coerce.number().int().min(0).max(100_000_000).optional(),
  isActive: z.boolean().optional(),
};

const enforceAmountPairing = (
  value: { priceType: string; amountPaise?: number },
  ctx: z.RefinementCtx,
): void => {
  if (value.priceType === 'inspection_based' && value.amountPaise !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['amountPaise'],
      message: 'must be omitted when priceType is inspection_based',
    });
  }

  if (value.priceType !== 'inspection_based' && value.amountPaise === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['amountPaise'],
      message: `is required when priceType is ${value.priceType}`,
    });
  }
};

export const createPriceCardSchema = z
  .object(priceCardShape)
  .strict()
  .superRefine(enforceAmountPairing);

export type CreatePriceCardInput = z.infer<typeof createPriceCardSchema>;

export const updatePriceCardSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    priceType: z.enum(['fixed', 'starting_from', 'inspection_based']).optional(),
    amountPaise: z.union([z.coerce.number().int().min(0).max(100_000_000), z.null()]).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type UpdatePriceCardInput = z.infer<typeof updatePriceCardSchema>;

/* -------------------------------------------------------------------------- */
/* Availability                                                               */
/* -------------------------------------------------------------------------- */

export const createAvailabilitySchema = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    startTime: timeOfDay,
    endTime: timeOfDay,
    isActive: z.boolean().optional(),
  })
  .strict();

export type CreateAvailabilityInput = z.infer<typeof createAvailabilitySchema>;

export const updateAvailabilitySchema = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
    startTime: timeOfDay.optional(),
    endTime: timeOfDay.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

export const createDocumentSchema = z
  .object({
    docType: z.enum(['id_proof', 'certificate', 'photo', 'other']),
    /** Where the file will live. Phase 4 does the actual upload. */
    storageKey: z.string().trim().min(1).max(300),
  })
  .strict();

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const uuidParamSchema = z.object({ id: z.string().uuid() });

/**
 * The public profile's path parameter.
 *
 * A uuid, strictly — which is what stops `GET /providers/:providerId` from
 * swallowing `/providers/me/...`. Express matches in declaration order, so the
 * public route is mounted first and simply fails to parse anything that is not
 * an id, leaving `/me` to the routes below it.
 */
export const providerIdParamSchema = z.object({ providerId: z.string().uuid() });

/* -------------------------------------------------------------------------- */
/* Responses                                                                  */
/* -------------------------------------------------------------------------- */

export interface ProviderSkillResponse {
  categoryId: number;
  categorySlug: string;
  categoryName: string;
  experienceNote: string | null;
}

export interface ProviderPriceCardResponse {
  id: string;
  categoryId: number;
  categoryName: string;
  title: string;
  priceType: PriceType;
  amountPaise: number | null;
  isActive: boolean;
}

export interface ProviderAvailabilityResponse {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export interface ProviderDocumentResponse {
  id: string;
  docType: ProviderDocumentType;
  storageKey: string;
  status: string;
  createdAt: string;
}

export interface ProviderCompletenessResponse {
  /** 0–100 progress indicator. Not on its own permission to be listed. */
  score: number;
  threshold: number;
  isListed: boolean;
  /** Everything still to do, heaviest first. */
  missing: CompletenessItem[];
  /** The subset of `missing` that is blocking listing. Empty means good to go. */
  missingRequired: CompletenessItem[];
  breakdown: CompletenessBreakdownEntry[];
}

export interface ProviderProfileResponse {
  userId: string;
  displayName: string | null;
  bio: string | null;
  yearsExperience: number | null;
  cityId: number;
  baseLocation: GeoPoint | null;
  serviceRadiusKm: number;
  assistedOnboarding: boolean;
  isListed: boolean;
  /** Trust, as opposed to completeness. Phase 5 search requires both. */
  verification: {
    badge: string;
    badgeSince: string | null;
    levelsPassed: number[];
  };
  completeness: ProviderCompletenessResponse;
  skills: ProviderSkillResponse[];
  priceCards: ProviderPriceCardResponse[];
  availability: ProviderAvailabilityResponse[];
  documents: ProviderDocumentResponse[];
  createdAt: string;
  updatedAt: string;
}
