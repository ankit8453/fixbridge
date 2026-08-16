import { z } from 'zod';

/**
 * Request shapes for the ops console.
 *
 * Every list is paginated and every mutation takes a **mandatory note or
 * reason**. That is not ceremony: each of these actions is a person's judgment
 * about somebody else's livelihood, and the note is what makes the audit row
 * worth reading six months later when the technician asks why.
 */

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
};

/** Ops always has to say why. Long enough for a sentence, short enough to read. */
const reason = z.string().trim().min(3).max(500);

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

export const listUsersQuerySchema = z
  .object({
    ...pagination,
    /** Phone fragment or name. Ops search by whatever the caller read out. */
    q: z.string().trim().min(1).max(60).optional(),
    role: z.enum(['customer', 'technician', 'ops', 'admin']).optional(),
    status: z.enum(['active', 'blocked']).optional(),
  })
  .strict();

export const userIdParamSchema = z.object({ userId: z.string().uuid() });

export const blockUserSchema = z.object({ reason }).strict();

/* -------------------------------------------------------------------------- */
/* Providers                                                                  */
/* -------------------------------------------------------------------------- */

export const listProvidersQuerySchema = z
  .object({
    ...pagination,
    q: z.string().trim().min(1).max(60).optional(),
    city_id: z.coerce.number().int().min(1).optional(),
    badge: z.enum(['NONE', 'VERIFIED', 'SILVER', 'GOLD']).optional(),
    listed: z.enum(['true', 'false']).optional(),
    suspended: z.enum(['true', 'false']).optional(),
    /** The entry-approval queue, which is empty unless the city flag is on. */
    pending_approval: z.enum(['true', 'false']).optional(),
  })
  .strict();

export const providerIdParamSchema = z.object({ providerId: z.string().uuid() });

export const approveEntrySchema = z.object({ note: reason }).strict();

/* -------------------------------------------------------------------------- */
/* Bookings                                                                   */
/* -------------------------------------------------------------------------- */

export const listBookingsQuerySchema = z
  .object({
    ...pagination,
    /** A booking id, or a phone fragment for either party. */
    q: z.string().trim().min(1).max(60).optional(),
    status: z.string().trim().min(1).max(40).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();

export const bookingIdParamSchema = z.object({ bookingId: z.string().uuid() });

/**
 * Unlocking a handshake OTP.
 *
 * The note is mandatory and it is the whole control. A locked booking means five
 * wrong codes were entered at somebody's door; unlocking it is ops asserting they
 * checked who they were talking to. Without a note there is no difference between
 * that and a bored click.
 */
export const otpUnlockSchema = z
  .object({
    note: reason,
    /** Which code to reissue. Both, by default. */
    kind: z.enum(['start', 'end', 'both']).default('both'),
  })
  .strict();

export const opsCancelSchema = z.object({ reason }).strict();

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

export const listJournalsQuerySchema = z
  .object({
    ...pagination,
    journal_type: z
      .enum([
        'payment_captured',
        'cash_collected',
        'refund',
        'payout',
        'dues_settled',
        'adjustment',
      ])
      .optional(),
    booking_id: z.string().uuid().optional(),
    provider_id: z.string().uuid().optional(),
  })
  .strict();

export const journalIdParamSchema = z.object({ journalId: z.string().uuid() });

export const listBatchesQuerySchema = z.object({ ...pagination }).strict();

/* -------------------------------------------------------------------------- */
/* Queues                                                                     */
/* -------------------------------------------------------------------------- */

export const listParkedQuerySchema = z.object({ ...pagination }).strict();

export const outboxIdParamSchema = z.object({ outboxId: z.string().uuid() });
export const webhookIdParamSchema = z.object({ webhookId: z.string().uuid() });
export const deliveryIdParamSchema = z.object({ deliveryId: z.string().uuid() });

export const discardSchema = z.object({ reason }).strict();

/* -------------------------------------------------------------------------- */
/* Cities                                                                     */
/* -------------------------------------------------------------------------- */

export const cityIdParamSchema = z.object({ cityId: z.coerce.number().int().min(1) });

export const updateCitySchema = z
  .object({
    requireEntryApproval: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one setting must be provided',
  });

/* -------------------------------------------------------------------------- */
/* Audit log                                                                  */
/* -------------------------------------------------------------------------- */

export const listAuditQuerySchema = z
  .object({
    ...pagination,
    actor_user_id: z.string().uuid().optional(),
    action: z.string().trim().min(1).max(80).optional(),
    target_type: z.string().trim().min(1).max(40).optional(),
    target_id: z.string().trim().min(1).max(120).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type ListProvidersQuery = z.infer<typeof listProvidersQuerySchema>;
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
export type ListJournalsQuery = z.infer<typeof listJournalsQuerySchema>;
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
