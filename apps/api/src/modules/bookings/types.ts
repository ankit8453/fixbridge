import type { SlotStatus } from '@prisma/client';
import { z } from 'zod';
import type { PayableView, QuotationView } from '../quotations/types';
import {
  CUSTOMER_CANCEL_REASONS,
  PROVIDER_CANCEL_REASONS,
  REJECTION_REASONS,
  type BookingActor,
  type BookingEventType,
  type BookingStatus,
} from './state-machine';

export const createBookingSchema = z
  .object({
    slotId: z.string().uuid(),
    categoryId: z.coerce.number().int().min(1),
    addressId: z.string().uuid(),
    priceCardId: z.string().uuid().optional(),
    problemNote: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const rejectBookingSchema = z
  .object({
    reason: z.enum(REJECTION_REASONS),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // "other" without a note tells Phase 9 nothing it can act on.
    if (value.reason === 'other' && !value.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'a note is required for "other"' });
    }
  });

export type RejectBookingInput = z.infer<typeof rejectBookingSchema>;

/**
 * One schema for both sides, validated against the caller's own reason list.
 *
 * The reason codes differ because they mean different things: a customer's
 * `found_other` is market feedback, a provider's `vehicle_issue` is a
 * reliability signal Phase 9 will weigh.
 */
export const cancelBookingSchema = z
  .object({
    reason: z.string().trim().min(1).max(40),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

export function isValidCancelReason(side: 'customer' | 'provider', reason: string): boolean {
  const allowed: readonly string[] =
    side === 'customer' ? CUSTOMER_CANCEL_REASONS : PROVIDER_CANCEL_REASONS;

  return allowed.includes(reason);
}

export const submitOtpSchema = z
  .object({
    otp: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, 'must be the digits shown to the customer'),
  })
  .strict();

export type SubmitOtpInput = z.infer<typeof submitOtpSchema>;

export const bookingIdParamSchema = z.object({ bookingId: z.string().uuid() });
export const slotIdParamSchema = z.object({ slotId: z.string().uuid() });
export const providerIdParamSchema = z.object({ providerId: z.string().uuid() });

export const providerSlotsQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.to <= value.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'must be after "from"' });
    }
  });

export type ProviderSlotsQuery = z.infer<typeof providerSlotsQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Responses                                                                  */
/* -------------------------------------------------------------------------- */

export interface BookingEventView {
  id: string;
  eventType: BookingEventType;
  actorType: BookingActor;
  payload: unknown;
  createdAt: string;
}

export interface BookingDetail {
  id: string;
  status: BookingStatus;
  categoryId: number;
  startsAt: string;
  endsAt: string;
  problemNote: string | null;
  /** Resolved from `fee_config` at creation. Whether it is charged is decided at the end. */
  visitFeePaise: number;
  /** Every version, both sides, fully itemised. */
  quotations: QuotationView[];
  /** Awaiting the customer's decision, if any. */
  pendingQuotation: QuotationView | null;
  /** The one that settled the price, if any. */
  approvedQuotation: QuotationView | null;
  /** Frozen at the terminal transition. Null until then. */
  payablePaise: number | null;
  payable: PayableView | null;
  /** The address as it was when booked. Null to a provider before acceptance. */
  address: unknown;
  counterpart: {
    name: string | null;
    /** Masked until ACCEPTED; both sides genuinely need to call after that. */
    phone: string | null;
    phoneRevealed: boolean;
  };
  /** Customer only, from ACCEPTED. The technician asks for it at the door. */
  startOtp: string | null;
  /** Customer only, and only once work is under way. */
  endOtp: string | null;
  events: BookingEventView[];
  createdAt: string;
}

export interface PublicSlot {
  id: string;
  startsAt: string;
  endsAt: string;
}

/**
 * A slot as its **owner** sees it.
 *
 * Carries the two things `PublicSlot` deliberately withholds from strangers —
 * the status, and the booking sitting in it. A technician looking at their own
 * week needs to tell "I blocked this" from "somebody booked this", and the
 * public shape cannot express either without leaking both to everyone.
 */
export interface OwnSlot extends PublicSlot {
  status: SlotStatus;
  /** Null unless the slot is booked. Lets the week view link straight to the job. */
  bookingId: string | null;
}
