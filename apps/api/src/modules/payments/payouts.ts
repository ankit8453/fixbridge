import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { enqueueOutbox } from '../../core/outbox';
import { formatPaise } from '../search/service';
import * as ledger from './ledger';
import * as repo from './repository';
import { PAYMENT_TOPICS } from './state-machine';
import type { PayoutBatchView, PayoutView, WalletResponse } from './types';
import { writeDepsAudit, type AuditableDeps } from '../../core/audit';

/**
 * Paying technicians what they are owed.
 *
 * Pilot-grade and honest about it: a batch is a list of amounts, somebody makes
 * the transfers by hand, and they type the UTR back in. A RazorpayX integration
 * is a day's work whenever the volume justifies it; building it now would mean
 * maintaining an untested code path against a real money API for months before
 * anybody uses it.
 *
 * What *is* built properly is the accounting. A payout only touches the ledger
 * when it is marked paid, the batch header cannot disagree with its lines, and a
 * technician who owes us more than we owe them is skipped with their dues left
 * exactly where they are.
 */

export interface PayoutDeps extends AuditableDeps {
  context: AppContext;
  now?: () => Date;
}

const nowOf = (deps: PayoutDeps): Date => (deps.now ? deps.now() : new Date());

/* -------------------------------------------------------------------------- */
/* Building a batch                                                           */
/* -------------------------------------------------------------------------- */

export interface BatchResult {
  batchId: string | null;
  payoutCount: number;
  totalPaise: number;
  /** Technicians left out, and why. Ops need to see this, not guess at it. */
  skipped: { providerId: string; reason: 'below_minimum' | 'net_negative'; netPaise: number }[];
}

/**
 * Snapshots every positive balance into a draft batch.
 *
 * Two exclusions, both deliberate:
 *
 *   - **Below the minimum.** A ₹12 bank transfer costs more in effort than it
 *     moves. The balance stays put and rolls into the next run.
 *   - **Net negative.** A technician who has collected more cash commission than
 *     we owe them is not paid, and their dues are untouched — we do not net a
 *     debt out of a payout without them agreeing to it, because the first time a
 *     technician sees a payout smaller than they expected is the last time they
 *     trust the wallet screen.
 *
 * Idempotent in the way that matters: the batch is a *snapshot*, so running it
 * twice in a day produces a second batch of whatever is left, not a double
 * payment — because the first batch's ledger entries have already moved the
 * balance by the time it is marked paid.
 */
export async function buildPayoutBatch(
  deps: PayoutDeps,
  createdById: string | null,
): Promise<BatchResult> {
  const { context } = deps;
  const windowEnd = nowOf(deps);
  const minimum = context.config.PAYOUT_MINIMUM_PAISE;

  const balances = await ledger.allProviderBalances(context.prisma);
  const skipped: BatchResult['skipped'] = [];
  const payable: { providerId: string; amountPaise: number }[] = [];

  for (const balance of balances) {
    if (balance.netPaise <= 0) {
      if (balance.netPaise < 0 || balance.duesPaise > 0) {
        skipped.push({
          providerId: balance.providerId,
          reason: 'net_negative',
          netPaise: balance.netPaise,
        });
      }
      continue;
    }

    if (balance.netPaise < minimum) {
      skipped.push({
        providerId: balance.providerId,
        reason: 'below_minimum',
        netPaise: balance.netPaise,
      });
      continue;
    }

    payable.push({ providerId: balance.providerId, amountPaise: balance.netPaise });
  }

  if (payable.length === 0) {
    context.logger.info({ skipped: skipped.length }, 'payout run: nobody to pay');
    return { batchId: null, payoutCount: 0, totalPaise: 0, skipped };
  }

  const totalPaise = payable.reduce((sum, row) => sum + row.amountPaise, 0);

  const batch = await context.prisma.$transaction(async (tx) => {
    // The ops audit row, in the same transaction as the decision it records.
    await writeDepsAudit(tx, deps);

    // Header first, lines second — the totals trigger is deferred precisely so
    // this order works and the two are checked against each other at commit.
    const created = await tx.payoutBatch.create({
      data: {
        status: 'draft',
        createdById,
        windowEnd,
        totalPaise,
        payoutCount: payable.length,
      },
    });

    for (const row of payable) {
      await tx.payout.create({
        data: { batchId: created.id, providerId: row.providerId, amountPaise: row.amountPaise },
      });
    }

    return created;
  });

  context.logger.info(
    { batchId: batch.id, payoutCount: payable.length, totalPaise, skipped: skipped.length },
    'payout batch drafted',
  );

  return { batchId: batch.id, payoutCount: payable.length, totalPaise, skipped };
}

/* -------------------------------------------------------------------------- */
/* Marking one paid                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Ops made the transfer and typed in the reference.
 *
 * ```
 *   debit  provider_payable  amount   (we no longer owe it)
 *   credit gateway_cash      amount   (it left our account)
 * ```
 *
 * The UTR is required by a CHECK constraint, not just by this function: a payout
 * marked paid with no bank reference is unauditable, and the one time anybody
 * needs it is the one time a technician says they were not paid.
 */
export async function markPayoutPaid(
  deps: PayoutDeps,
  payoutId: string,
  utrRef: string,
): Promise<PayoutView> {
  const { context } = deps;
  const payout = await context.prisma.payout.findUnique({ where: { id: payoutId } });

  if (!payout) {
    throw new AppError(404, 'PAYOUT_NOT_FOUND', `Payout ${payoutId} not found`, {
      messageKey: 'errors.payments.payoutNotFound',
    });
  }

  if (payout.status !== 'pending') {
    throw new AppError(409, 'PAYOUT_NOT_PENDING', `That payout is already ${payout.status}`, {
      messageKey: 'errors.payments.payoutNotPending',
      details: { status: payout.status },
    });
  }

  const at = nowOf(deps);

  const updated = await context.prisma.$transaction(async (tx) => {
    // The ops audit row, in the same transaction as the decision it records.
    await writeDepsAudit(tx, deps);

    // Guarded on `pending`, so two ops tabs cannot pay the same technician twice.
    const moved = await tx.payout.updateMany({
      where: { id: payoutId, status: 'pending' },
      data: { status: 'paid', utrRef, paidAt: at },
    });

    if (moved.count === 0) {
      throw new AppError(409, 'PAYOUT_NOT_PENDING', 'That payout was already settled', {
        messageKey: 'errors.payments.payoutNotPending',
      });
    }

    await ledger.post(tx, {
      journalType: 'payout',
      memo: `payout ${payout.amountPaise}p, UTR ${utrRef}`,
      entries: [
        {
          accountType: 'provider_payable',
          ownerType: 'provider',
          ownerId: payout.providerId,
          direction: 'debit',
          amountPaise: payout.amountPaise,
        },
        {
          accountType: 'gateway_cash',
          ownerType: 'platform',
          direction: 'credit',
          amountPaise: payout.amountPaise,
        },
      ],
    });

    await enqueueOutbox(tx, {
      topic: PAYMENT_TOPICS.payoutPaid,
      aggregateType: 'provider',
      aggregateId: payout.providerId,
      payload: { payoutId, amountPaise: payout.amountPaise },
    });

    const reloaded = await tx.payout.findUnique({ where: { id: payoutId } });
    if (!reloaded) throw new Error(`payout ${payoutId} vanished mid-transaction`);
    return reloaded;
  });

  return toPayoutView(updated);
}

export async function markPayoutFailed(
  deps: PayoutDeps,
  payoutId: string,
  note: string,
): Promise<PayoutView> {
  const { context } = deps;

  const payout = await context.prisma.$transaction(async (tx) => {
    // The ops audit row, in the same transaction as the decision it records.
    await writeDepsAudit(tx, deps);

    const moved = await tx.payout.updateMany({
      where: { id: payoutId, status: 'pending' },
      data: { status: 'failed', failureNote: note },
    });

    if (moved.count === 0) {
      throw new AppError(409, 'PAYOUT_NOT_PENDING', 'That payout is not pending', {
        messageKey: 'errors.payments.payoutNotPending',
      });
    }

    // Nothing is posted: a failed transfer means the money never left, so the
    // technician's balance is already correct and will roll into the next batch.
    return tx.payout.findUnique({ where: { id: payoutId } });
  });

  return toPayoutView(payout as NonNullable<typeof payout>);
}

/** Closes a batch once every line has been dealt with. */
export async function completeBatch(deps: PayoutDeps, batchId: string): Promise<PayoutBatchView> {
  const { context } = deps;

  const batch = await context.prisma.$transaction(async (tx) => {
    // The ops audit row, in the same transaction as the decision it records.
    await writeDepsAudit(tx, deps);

    const pending = await tx.payout.count({ where: { batchId, status: 'pending' } });

    if (pending > 0) {
      throw new AppError(409, 'PAYOUT_BATCH_INCOMPLETE', `${pending} payouts are still pending`, {
        messageKey: 'errors.payments.batchIncomplete',
        details: { pending },
      });
    }

    return tx.payoutBatch.update({
      where: { id: batchId },
      data: { status: 'completed', completedAt: nowOf(deps) },
      include: { payouts: true },
    });
  });

  return toBatchView(batch);
}

/* -------------------------------------------------------------------------- */
/* Views                                                                      */
/* -------------------------------------------------------------------------- */

export function toPayoutView(payout: {
  id: string;
  batchId: string;
  providerId: string;
  amountPaise: number;
  status: string;
  utrRef: string | null;
  paidAt: Date | null;
  createdAt: Date;
}): PayoutView {
  return {
    id: payout.id,
    batchId: payout.batchId,
    providerId: payout.providerId,
    amountPaise: payout.amountPaise,
    amountDisplay: formatPaise(payout.amountPaise),
    status: payout.status as PayoutView['status'],
    utrRef: payout.utrRef,
    paidAt: payout.paidAt?.toISOString() ?? null,
    createdAt: payout.createdAt.toISOString(),
  };
}

export function toBatchView(batch: {
  id: string;
  status: string;
  windowEnd: Date;
  totalPaise: number;
  payoutCount: number;
  createdAt: Date;
  payouts?: Parameters<typeof toPayoutView>[0][];
}): PayoutBatchView {
  return {
    id: batch.id,
    status: batch.status as PayoutBatchView['status'],
    windowEnd: batch.windowEnd.toISOString(),
    totalPaise: batch.totalPaise,
    totalDisplay: formatPaise(batch.totalPaise),
    payoutCount: batch.payoutCount,
    createdAt: batch.createdAt.toISOString(),
    payouts: batch.payouts?.map(toPayoutView) ?? [],
  };
}

/* -------------------------------------------------------------------------- */
/* Wallet                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What a technician sees when they ask "where is my money".
 *
 * Payable and dues are shown separately rather than netted, because "we owe you
 * ₹4,000, you owe us ₹600" is checkable against their own week and "₹3,400" is
 * not. The ledger lines are their own accounts only, and memos are not included
 * — those are written for ops and can name other people.
 */
export async function getWallet(deps: PayoutDeps, providerId: string): Promise<WalletResponse> {
  const { context } = deps;

  const [balance, lines, payouts] = await Promise.all([
    ledger.providerBalance(context.prisma, providerId),
    ledger.providerLedgerLines(context.prisma, providerId, context.config.WALLET_LEDGER_PAGE_SIZE),
    repo.listPayoutsForProvider(context.prisma, providerId, 10),
  ]);

  const pendingPayoutPaise = payouts
    .filter((payout) => payout.status === 'pending')
    .reduce((sum, payout) => sum + payout.amountPaise, 0);

  return {
    providerId,
    payablePaise: balance.payablePaise,
    payableDisplay: formatPaise(balance.payablePaise),
    duesPaise: balance.duesPaise,
    duesDisplay: formatPaise(balance.duesPaise),
    netPaise: balance.netPaise,
    netDisplay: formatPaise(Math.abs(balance.netPaise)),
    pendingPayoutPaise,
    payoutMinimumPaise: context.config.PAYOUT_MINIMUM_PAISE,
    recentPayouts: payouts.map(toPayoutView),
    ledger: lines.map((line) => ({
      journalId: line.journalId,
      journalType: line.journalType,
      accountType: line.accountType,
      direction: line.direction,
      amountPaise: line.amountPaise,
      amountDisplay: formatPaise(line.amountPaise),
      bookingId: line.bookingId,
      createdAt: line.createdAt.toISOString(),
    })),
  };
}
