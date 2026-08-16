import { z } from 'zod';

/**
 * Tags are a fixed list per direction.
 *
 * Free text cannot be aggregated, and "punctual" typed forty different ways is
 * forty facts nobody can count. A closed list gives a profile page something
 * real to show — *"12 people said punctual"* — and keeps the write path a single
 * tap on a phone.
 *
 * The two lists differ because the two sides are judging different things. A
 * customer cares whether the technician turned up and did clean work; a
 * technician cares whether the problem was described honestly and they got paid.
 */
export const CUSTOMER_TO_PROVIDER_TAGS = [
  'punctual',
  'polite',
  'fair_price',
  'clean_work',
  'expert',
] as const;

export const PROVIDER_TO_CUSTOMER_TAGS = [
  'respectful',
  'clear_problem',
  'paid_promptly',
  /** The one negative tag in either list, and deliberately internal-only. */
  'difficult',
] as const;

export type CustomerToProviderTag = (typeof CUSTOMER_TO_PROVIDER_TAGS)[number];
export type ProviderToCustomerTag = (typeof PROVIDER_TO_CUSTOMER_TAGS)[number];

export const ALL_REVIEW_TAGS = [
  ...CUSTOMER_TO_PROVIDER_TAGS,
  ...PROVIDER_TO_CUSTOMER_TAGS,
] as const;

export function tagsFor(direction: 'customer_to_provider' | 'provider_to_customer') {
  return direction === 'customer_to_provider'
    ? CUSTOMER_TO_PROVIDER_TAGS
    : PROVIDER_TO_CUSTOMER_TAGS;
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

export const createReviewSchema = z
  .object({
    stars: z.coerce.number().int().min(1).max(5),
    /** Validated against the caller's direction in the service. */
    tags: z.array(z.enum(ALL_REVIEW_TAGS)).max(5).default([]),
    text: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const reportReviewSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

export type ReportReviewInput = z.infer<typeof reportReviewSchema>;

export const reviewIdParamSchema = z.object({ reviewId: z.string().uuid() });
export const providerIdParamSchema = z.object({ providerId: z.string().uuid() });

export const listReviewsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();

export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Responses                                                                  */
/* -------------------------------------------------------------------------- */

export interface ReviewView {
  id: string;
  bookingId: string;
  direction: 'customer_to_provider' | 'provider_to_customer';
  stars: number;
  tags: string[];
  text: string | null;
  status: 'published' | 'hidden';
  createdAt: string;
}

/**
 * A review as a stranger sees it.
 *
 * The author is a first name and an initial — enough that the review reads as a
 * person rather than an anonymous score, not enough to find them. Full names on
 * a public page would be a real safety problem for customers who have had a
 * technician in their home.
 */
export interface PublicReviewView {
  id: string;
  stars: number;
  tags: string[];
  text: string | null;
  authorName: string;
  createdAt: string;
}

export interface ProviderReviewsResponse {
  providerId: string;
  averageStars: number | null;
  reviewCount: number;
  tagCounts: Record<string, number>;
  reviews: PublicReviewView[];
  page: number;
  pageSize: number;
  total: number;
}
