import { z } from 'zod';

export const COMPLAINT_CATEGORIES = [
  'overcharge',
  'no_show',
  'quality',
  'behavior',
  'cash_dispute',
  /** Handled synchronously — see the service. */
  'safety',
  'other',
] as const;

export const raiseComplaintSchema = z
  .object({
    category: z.enum(COMPLAINT_CATEGORIES),
    description: z.string().trim().min(10).max(1000),
  })
  .strict();

export type RaiseComplaintInput = z.infer<typeof raiseComplaintSchema>;

export const resolveComplaintSchema = z
  .object({
    /**
     * Mandatory, both of them.
     *
     * A resolution with no note is a decision nobody can review, and a severity
     * is what the trust engine acts on — leaving either to a default would make
     * an ops shortcut into a technician's suspension.
     */
    note: z.string().trim().min(5).max(1000),
    severity: z.enum(['minor', 'major', 'severe']),
  })
  .strict();

export type ResolveComplaintInput = z.infer<typeof resolveComplaintSchema>;

export const dismissComplaintSchema = z
  .object({ note: z.string().trim().min(5).max(1000) })
  .strict();

export type DismissComplaintInput = z.infer<typeof dismissComplaintSchema>;

export const complaintIdParamSchema = z.object({ complaintId: z.string().uuid() });

export const complaintQueueQuerySchema = z
  .object({
    status: z.enum(['open', 'in_review', 'resolved', 'dismissed']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type ComplaintQueueQuery = z.infer<typeof complaintQueueQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Responses                                                                  */
/* -------------------------------------------------------------------------- */

export interface ComplaintView {
  id: string;
  bookingId: string;
  category: (typeof COMPLAINT_CATEGORIES)[number];
  description: string;
  status: 'open' | 'in_review' | 'resolved' | 'dismissed';
  raisedByUserId: string;
  againstUserId: string;
  resolutionNote: string | null;
  severity: 'minor' | 'major' | 'severe' | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ComplaintQueueResponse {
  complaints: ComplaintView[];
  page: number;
  pageSize: number;
  total: number;
}
