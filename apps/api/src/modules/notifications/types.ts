import { SUPPORTED_LOCALES } from '@fixbridge/shared';
import { z } from 'zod';

export const listNotificationsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).optional(),
    /** For the badge-count view: only what has not been seen. */
    unread_only: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .strict();

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const notificationIdParamSchema = z.object({ notificationId: z.string().uuid() });

/**
 * The one preference this phase ships.
 *
 * No per-topic opt-outs in v1, deliberately: every message routed here is
 * transactional — a job, a payment, a suspension — and letting somebody switch
 * off "booking accepted" would break the product for them silently. Marketing
 * messages, which are what an opt-out is really for, do not exist and are a
 * different DLT category besides.
 */
export const updatePreferencesSchema = z
  .object({
    preferredLanguage: z.enum(SUPPORTED_LOCALES),
  })
  .strict();

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
