import { z } from 'zod';

/** Optional city filter; the service falls back to `DEFAULT_CITY_ID`. */
export const listCategoriesQuerySchema = z.object({
  cityId: z.coerce.number().int().min(1).optional(),
});

export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;

export const categoryIdParamSchema = z.object({
  id: z.coerce.number().int().min(1),
});

/** One node of the public tree. Leaves carry an empty `children` array. */
export interface CategoryNode {
  id: number;
  slug: string;
  /** Localised via Accept-Language. */
  name: string;
  /** The i18n key behind `name` — clients can re-localise offline. */
  nameKey: string;
  icon: string | null;
  sortOrder: number;
  /**
   * Searchable providers behind this category — listed, verified and active, the
   * same gates search applies. A cluster sums its services. Cached for 5 minutes,
   * so treat it as a browsing hint rather than a live number.
   */
  providerCount: number;
  children: CategoryNode[];
}

export interface CategoryTreeResponse {
  cityId: number;
  categories: CategoryNode[];
}
