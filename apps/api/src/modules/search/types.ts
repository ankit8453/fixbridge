import { z } from 'zod';
import type { Badge } from '../verification/badge';
import { parseTimeOfDay } from '../providers/availability';
import { MAX_QUERY_LENGTH } from './normalize';

/* -------------------------------------------------------------------------- */
/* Provider search                                                            */
/* -------------------------------------------------------------------------- */

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

/** `YYYY-MM-DD`, read as an IST calendar day and matched against real slots. */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD form')
  .transform((value, ctx) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);

    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'is not a real date' });
      return z.NEVER;
    }

    return parsed;
  });

export const searchProvidersQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    city_id: z.coerce.number().int().min(1).optional(),
    category_id: z.coerce.number().int().min(1).optional(),
    date: isoDate.optional(),
    start_time: timeOfDay.optional(),
    end_time: timeOfDay.optional(),
    max_distance_km: z.coerce.number().min(0.1).max(25).optional(),
    sort: z.enum(['rank', 'distance', 'price_low']).default('rank'),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(25).default(10),
  })
  .strict()
  .superRefine((value, ctx) => {
    // The availability trio is all-or-nothing: a start time with no date cannot
    // pick a weekday, and a date with no times filters nothing useful.
    const supplied = [value.date, value.start_time, value.end_time].filter(
      (part) => part !== undefined,
    ).length;

    if (supplied !== 0 && supplied !== 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['date'],
        message: 'date, start_time and end_time must be supplied together',
      });
    }

    if (
      value.start_time !== undefined &&
      value.end_time !== undefined &&
      value.end_time <= value.start_time
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['end_time'],
        message: 'end_time must be after start_time',
      });
    }
  });

export type SearchProvidersQuery = z.infer<typeof searchProvidersQuerySchema>;

export interface SearchSkill {
  categoryId: number;
  slug: string;
  /** Localised via Accept-Language. */
  name: string;
}

export interface SearchAvailabilityWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/**
 * One result card, shaped for the Phase 13 Flutter list.
 *
 * Deliberately absent: the provider's exact coordinates (distance only —
 * publishing a technician's home location to anyone who can call a public
 * endpoint is not acceptable), their phone number, and any completeness
 * internals.
 */
export interface SearchResultCard {
  providerId: string;
  displayName: string | null;
  /** `VERIFIED`, or a `SILVER`/`GOLD` band earned on trust. Phase 9. */
  badge: Badge;
  /** Null until somebody has rated them — never a fabricated default. */
  rating: { average: number; count: number } | null;
  /** Jobs done and paid for. The number a customer actually weighs. */
  jobsCompleted: number;
  yearsExperience: number | null;
  /** Rounded to 0.1 km — precise enough to choose by, too coarse to triangulate. */
  distanceKm: number;
  skills: SearchSkill[];
  startingPrice: { amountPaise: number; display: string } | null;
  nextAvailability: SearchAvailabilityWindow | null;
  /** Human-readable area, not coordinates. */
  locality: string | null;
}

export interface SearchProvidersResponse {
  results: SearchResultCard[];
  page: number;
  pageSize: number;
  /** Total matches, which may exceed what was ranked — see `truncated`. */
  total: number;
  /** True when more matched than the ranking candidate cap. */
  truncated: boolean;
  sort: 'rank' | 'distance' | 'price_low';
  query: {
    cityId: number;
    categoryId: number | null;
    maxDistanceKm: number | null;
    availability: { dayOfWeek: number; startTime: string; endTime: string } | null;
  };
}

/* -------------------------------------------------------------------------- */
/* Text resolution                                                            */
/* -------------------------------------------------------------------------- */

export const resolveQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
    city_id: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(20).default(8),
  })
  .strict();

export type ResolveQuery = z.infer<typeof resolveQuerySchema>;

/** Why a suggestion matched — the app can show "did you mean" differently. */
export type MatchReason = 'synonym_exact' | 'synonym_prefix' | 'synonym_fuzzy' | 'category_name';

export interface CategorySuggestion {
  categoryId: number;
  slug: string;
  name: string;
  nameKey: string;
  /** Null for a cluster, the parent's id for a service. */
  parentId: number | null;
  matchReason: MatchReason;
  /** 0..1. Exact matches are 1. */
  confidence: number;
  /** The synonym that matched, when one did. */
  matchedTerm: string | null;
}

export interface ResolveResponse {
  query: string;
  normalizedQuery: string;
  suggestions: CategorySuggestion[];
}
