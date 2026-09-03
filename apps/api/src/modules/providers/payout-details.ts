import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../core/errors';

/**
 * Either the client or a transaction on it. Writing payout details is audited,
 * and `audited` hands its work a transaction — the row and the log entry have
 * to land together or not at all.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Where a technician's money goes.
 *
 * Collected **before the first payout, not at signup** — a technician can
 * register, get verified and finish jobs without ever seeing this form. What
 * they cannot do is be paid: `buildPayoutBatch` skips anyone without a row here
 * and says so, rather than drafting a transfer nobody can make.
 *
 * Two methods, either one. Bank works with everything, including the automated
 * payouts we will eventually want; UPI is what a great many technicians in
 * Jabalpur actually have, and asking them for an IFSC they have never looked up
 * is how you lose them at the last step. Neither is a lesser answer.
 */

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Indian bank account numbers run 9–18 digits and are printed with spaces in
 * passbooks, so the spaces are stripped rather than rejected — a technician
 * copying what is in front of them should not be told they are wrong.
 */
const accountNumberField = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\d{9,18}$/, 'must be 9 to 18 digits'));

/**
 * Four letters, a zero, then six alphanumerics. Uppercased first: banks print
 * it in caps, phones offer it in lower, and the fifth character is always `0`
 * which catches the commonest typo — an `O` for a zero.
 */
const ifscField = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'is not a valid IFSC code'));

/**
 * A UPI handle: `name@bank`. Deliberately loose on the left of the `@` — the
 * handle space is large and growing, and rejecting a valid one is worse than
 * accepting a typo the first failed transfer will catch anyway.
 */
const upiField = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9.\-_]{2,60}@[a-z][a-z0-9.\-]{1,30}$/, 'is not a valid UPI ID'));

/**
 * Five letters, four digits, one letter. The fourth letter says what kind of
 * holder it is — `P` for an individual — but that is not enforced, because a
 * technician trading as a firm has a perfectly valid PAN starting differently.
 */
const panField = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'is not a valid PAN'));

/**
 * A discriminated union, not one flat object with everything optional.
 *
 * A half-filled bank record is worse than no record: it looks answered on the
 * screen and cannot be paid. The shape makes the incomplete case unexpressible
 * rather than merely discouraged, and the database carries the same rule as a
 * check constraint so it is true of every row that has ever existed.
 */
export const payoutDetailSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('bank'),
    accountNumber: accountNumberField,
    /**
     * Typed twice on every screen that collects it, and compared here rather
     * than only in the client. A wrong-but-valid account number sends somebody
     * else's money to a stranger and there is no undo.
     */
    confirmAccountNumber: accountNumberField,
    ifsc: ifscField,
    accountHolder: z.string().trim().min(2).max(120),
    pan: panField.optional(),
  }),
  z.object({
    method: z.literal('upi'),
    upiId: upiField,
    pan: panField.optional(),
  }),
]);

export type PayoutDetailInput = z.infer<typeof payoutDetailSchema>;

/* -------------------------------------------------------------------------- */
/* Views                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What a technician is shown about their own details.
 *
 * The account number comes back masked even to its owner. There is nothing
 * they can do with the full number that they cannot do with the last four —
 * they know their own account — and a screen that renders it in full is a
 * screen that gets photographed over a shoulder, cached, and screenshotted into
 * a support chat.
 */
export interface PayoutDetailView {
  method: 'bank' | 'upi';
  /** `••••••3421`, or null for UPI. */
  accountNumberMasked: string | null;
  ifsc: string | null;
  accountHolder: string | null;
  upiId: string | null;
  /** `ABCDE••••F`, or null when no PAN has been given. */
  panMasked: string | null;
  updatedAt: string;
}

/** Keeps the last four. Anything shorter is masked entirely rather than hinted. */
function maskAccount(value: string): string {
  return value.length <= 4 ? '•'.repeat(value.length) : `${'•'.repeat(6)}${value.slice(-4)}`;
}

/** First five and last one — enough to recognise, not enough to reuse. */
function maskPan(value: string): string {
  return `${value.slice(0, 5)}••••${value.slice(-1)}`;
}

type PayoutDetailRow = {
  method: 'bank' | 'upi';
  accountNumber: string | null;
  ifsc: string | null;
  accountHolder: string | null;
  upiId: string | null;
  pan: string | null;
  updatedAt: Date;
};

export function toPayoutDetailView(row: PayoutDetailRow): PayoutDetailView {
  return {
    method: row.method,
    accountNumberMasked: row.accountNumber ? maskAccount(row.accountNumber) : null,
    ifsc: row.ifsc,
    accountHolder: row.accountHolder,
    upiId: row.upiId,
    panMasked: row.pan ? maskPan(row.pan) : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

export async function getPayoutDetail(
  prisma: Db,
  providerId: string,
): Promise<PayoutDetailView | null> {
  const row = await prisma.providerPayoutDetail.findUnique({ where: { userId: providerId } });
  return row ? toPayoutDetailView(row) : null;
}

/**
 * Writes, or replaces, a technician's payout details.
 *
 * A full replace rather than a patch, on purpose: switching from bank to UPI
 * must not leave the old account number behind in columns nobody is looking at
 * any more. Whatever the previous method was, only the new one survives.
 */
export async function setPayoutDetail(
  prisma: Db,
  providerId: string,
  input: PayoutDetailInput,
): Promise<PayoutDetailView> {
  if (input.method === 'bank' && input.accountNumber !== input.confirmAccountNumber) {
    throw new AppError(422, 'ACCOUNT_NUMBER_MISMATCH', 'The account numbers do not match', {
      messageKey: 'errors.payoutDetails.accountMismatch',
      details: { field: 'confirmAccountNumber' },
    });
  }

  const data: Prisma.ProviderPayoutDetailUncheckedCreateInput =
    input.method === 'bank'
      ? {
          userId: providerId,
          method: 'bank',
          accountNumber: input.accountNumber,
          ifsc: input.ifsc,
          accountHolder: input.accountHolder,
          upiId: null,
          pan: input.pan ?? null,
        }
      : {
          userId: providerId,
          method: 'upi',
          accountNumber: null,
          ifsc: null,
          accountHolder: null,
          upiId: input.upiId,
          pan: input.pan ?? null,
        };

  const row = await prisma.providerPayoutDetail.upsert({
    where: { userId: providerId },
    create: data,
    update: data,
  });

  return toPayoutDetailView(row);
}

/**
 * Every technician who can currently be paid.
 *
 * Returned as a set rather than checked one row at a time, because the payout
 * run asks this about every provider with a positive balance at once and a
 * query per technician is a query per technician.
 */
export async function providersWithPayoutDetails(
  prisma: Db,
  providerIds: string[],
): Promise<Set<string>> {
  if (providerIds.length === 0) return new Set();

  const rows = await prisma.providerPayoutDetail.findMany({
    where: { userId: { in: providerIds } },
    select: { userId: true },
  });

  return new Set(rows.map((row) => row.userId));
}
