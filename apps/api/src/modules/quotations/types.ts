import { z } from 'zod';
import { MAX_ITEMS, MAX_QTY, MAX_UNIT_PAISE } from './money';
import type { PayableBreakdown } from './payable';

/**
 * Validation mirrors `money.ts` rather than trusting it: Zod rejects a bad
 * shape with a field-level 400 the app can point at, and the pure functions
 * reject bad arithmetic. Both then get re-checked by the database.
 */

const quotationItemSchema = z
  .object({
    kind: z.enum(['part', 'labour_extra']),
    description: z.string().trim().min(1).max(120),
    qty: z.coerce.number().int().min(1).max(MAX_QTY),
    unitPaise: z.coerce.number().int().min(1).max(MAX_UNIT_PAISE),
  })
  .strict();

export const createQuotationSchema = z
  .object({
    /** Zero is fine when everything is parts; the total still has to exceed zero. */
    labourPaise: z.coerce
      .number()
      .int()
      .min(0)
      .max(MAX_UNIT_PAISE * 4),
    /**
     * The split. Optional so an older client still works: when absent, the
     * service derives the extra as whatever exceeds the agreed amount.
     */
    agreedLabourPaise: z.coerce.number().int().min(0).optional(),
    extraLabourPaise: z.coerce.number().int().min(0).optional(),
    extraLabourReason: z.string().trim().min(1).max(300).optional(),
    items: z.array(quotationItemSchema).max(MAX_ITEMS).default([]),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;

export const rejectQuotationSchema = z
  .object({ reason: z.string().trim().min(1).max(200).optional() })
  .strict();

export type RejectQuotationInput = z.infer<typeof rejectQuotationSchema>;

export const declineWorkSchema = z
  .object({ note: z.string().trim().min(1).max(500).optional() })
  .strict();

export type DeclineWorkInput = z.infer<typeof declineWorkSchema>;

export const quotationIdParamSchema = z.object({ quotationId: z.string().uuid() });

/* -------------------------------------------------------------------------- */
/* Responses                                                                  */
/* -------------------------------------------------------------------------- */

export interface QuotationItemView {
  id: string;
  kind: 'part' | 'labour_extra';
  description: string;
  qty: number;
  unitPaise: number;
  lineTotalPaise: number;
}

/**
 * Both sides see the whole history, every version, fully itemised.
 *
 * Transparency is the product here. Hiding a superseded version would let a
 * technician quietly revise a number the customer already saw, which is the
 * behaviour the feature exists to make impossible.
 */
export interface QuotationView {
  id: string;
  bookingId: string;
  version: number;
  status: 'sent' | 'approved' | 'rejected' | 'superseded' | 'withdrawn';
  labourPaise: number;
  partsTotalPaise: number;
  totalPaise: number;
  /** Formatted for display, e.g. `₹1,250`. */
  totalDisplay: string;
  note: string | null;
  decisionNote: string | null;
  items: QuotationItemView[];
  decidedAt: string | null;
  createdAt: string;
}

export interface QuotationHistoryResponse {
  bookingId: string;
  quotations: QuotationView[];
  /** The one awaiting a decision, if any. */
  pending: QuotationView | null;
  /** The one that settled the price, if any. */
  approved: QuotationView | null;
}

export interface PayableView extends PayableBreakdown {
  /** Formatted for display alongside the paise integer. */
  payableDisplay: string;
}
