import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

export const startPaymentSchema = z
  .object({
    /**
     * `visit_fee_upfront` is only reachable with `COLLECT_FEE_AT_BOOKING` on.
     * Accepted in the schema so the flow is testable behind the flag.
     */
    purpose: z.enum(['final_bill', 'visit_fee_upfront']).default('final_bill'),
  })
  .strict();

export type StartPaymentInput = z.infer<typeof startPaymentSchema>;

/** What the checkout SDK hands back to the browser. Razorpay's field names. */
export const checkoutCallbackSchema = z
  .object({
    razorpay_order_id: z.string().trim().min(1).max(120),
    razorpay_payment_id: z.string().trim().min(1).max(120),
    razorpay_signature: z.string().trim().min(1).max(200),
  })
  .strict();

export type CheckoutCallbackInput = z.infer<typeof checkoutCallbackSchema>;

export const cashCollectedSchema = z
  .object({ note: z.string().trim().min(1).max(300).optional() })
  .strict();

export type CashCollectedInput = z.infer<typeof cashCollectedSchema>;

export const refundSchema = z
  .object({
    /** Omitted means "everything still refundable". */
    amountPaise: z.coerce.number().int().min(1).optional(),
    reason: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

export type RefundInput = z.infer<typeof refundSchema>;

export const settleDuesSchema = z
  .object({
    providerId: z.string().uuid(),
    amountPaise: z.coerce.number().int().min(1),
    memo: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

export type SettleDuesInput = z.infer<typeof settleDuesSchema>;

export const markPaidSchema = z
  .object({
    /** The bank's reference. Required — an unauditable payout is not a payout. */
    utrRef: z.string().trim().min(4).max(60),
  })
  .strict();

export type MarkPaidInput = z.infer<typeof markPaidSchema>;

export const failPayoutSchema = z.object({ note: z.string().trim().min(1).max(300) }).strict();

export const paymentIdParamSchema = z.object({ paymentId: z.string().uuid() });
export const payoutIdParamSchema = z.object({ payoutId: z.string().uuid() });
export const batchIdParamSchema = z.object({ batchId: z.string().uuid() });

/* -------------------------------------------------------------------------- */
/* Responses                                                                  */
/* -------------------------------------------------------------------------- */

export interface PaymentView {
  id: string;
  bookingId: string | null;
  purpose: 'final_bill' | 'visit_fee_upfront';
  method: 'online' | 'cash';
  amountPaise: number;
  amountDisplay: string;
  status: 'created' | 'captured' | 'failed' | 'refunded' | 'partially_refunded';
  commissionBps: number;
  gatewayOrderId: string | null;
  /** The app said checkout succeeded. Nothing has moved on the strength of it. */
  checkoutVerifiedAt: string | null;
  capturedAt: string | null;
  createdAt: string;
}

/** Everything the Flutter checkout needs, and nothing secret. */
export interface StartPaymentResponse {
  payment: PaymentView;
  orderId: string;
  amountPaise: number;
  currency: 'INR';
  /** The publishable key. The secret never leaves the server. */
  keyId: string;
  /** True when an existing order was returned rather than a new one created. */
  reused: boolean;
}

export interface RefundView {
  id: string;
  paymentId: string;
  amountPaise: number;
  amountDisplay: string;
  status: 'created' | 'processed' | 'failed';
  reason: string | null;
  createdAt: string;
}

export interface PayoutView {
  id: string;
  batchId: string;
  providerId: string;
  amountPaise: number;
  amountDisplay: string;
  status: 'pending' | 'paid' | 'failed';
  utrRef: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface PayoutBatchView {
  id: string;
  status: 'draft' | 'processing' | 'completed';
  windowEnd: string;
  totalPaise: number;
  totalDisplay: string;
  payoutCount: number;
  createdAt: string;
  payouts: PayoutView[];
}

export interface WalletLedgerLine {
  journalId: string;
  journalType: string;
  accountType: string;
  direction: 'debit' | 'credit';
  amountPaise: number;
  amountDisplay: string;
  bookingId: string | null;
  createdAt: string;
}

export interface WalletResponse {
  providerId: string;
  /** What we owe them. */
  payablePaise: number;
  payableDisplay: string;
  /** What they owe us, from commission on cash they collected. */
  duesPaise: number;
  duesDisplay: string;
  /** `payable − dues`. Negative means they owe us more than we owe them. */
  netPaise: number;
  netDisplay: string;
  pendingPayoutPaise: number;
  payoutMinimumPaise: number;
  recentPayouts: PayoutView[];
  /** Their own accounts only, and no memos — those are written for ops. */
  ledger: WalletLedgerLine[];
}
