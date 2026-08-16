import type { PrismaClient } from '@prisma/client';
import { resolveCommissionRate, splitCommission } from '../../src/modules/payments/commission';
import { deterministicUuid } from './deterministic-id';

/**
 * Money against the seeded bookings.
 *
 * Written through raw inserts rather than the service, for one reason: the
 * service is driven by webhooks and a seed has no gateway to hear from. What the
 * seed does keep is the **arithmetic** — every split comes from
 * `splitCommission`, so a seeded ledger and a live one cannot disagree about
 * what 12% of ₹1,450 is.
 *
 * Every journal here balances, and a test asserts that over the whole table
 * rather than trusting this file.
 */

const DEFAULT_COMMISSION_BPS = 1_200;

interface PaymentSeed {
  /** The booking seed key from `bookings.ts`. */
  bookingKey: string;
  method: 'online' | 'cash';
  /** `refund` also captures first; the refund follows. */
  outcome: 'captured' | 'cash' | 'refunded' | 'unpaid';
  /** Partial refund amount, when the outcome is `refunded`. */
  refundPaise?: number;
}

/**
 * Five shapes, chosen to make every view non-trivial:
 *
 *   - two online captures, so `provider_payable` and `platform_revenue` both
 *     have real numbers and a payout batch has something to pay;
 *   - one cash job, so `provider_dues` is non-zero and the asymmetry between the
 *     rails is visible in the data rather than only in the docs;
 *   - one partial refund, so the proportional reversal is exercised;
 *   - one completed-but-unpaid, because that is the most common state in real
 *     life and every screen has to handle it.
 */
const PAYMENT_SEEDS: PaymentSeed[] = [
  { bookingKey: 'completed', method: 'online', outcome: 'captured' },
  { bookingKey: 'completed-via-quote', method: 'online', outcome: 'captured' },
  { bookingKey: 'completed-after-otp-retry', method: 'cash', outcome: 'cash' },
  // ₹500 back on a ₹1,450 job: the provider gives up ₹440, the platform ₹60.
  {
    bookingKey: 'completed-after-revision',
    method: 'online',
    outcome: 'refunded',
    refundPaise: 50_000,
  },
  { bookingKey: 'declined-after-quote', method: 'online', outcome: 'unpaid' },
];

export interface PaymentSeedSummary {
  payments: number;
  journals: number;
  batches: number;
}

export async function seedPayments(
  prisma: PrismaClient,
  cityId: number,
): Promise<PaymentSeedSummary> {
  let payments = 0;
  let journals = 0;

  for (const seed of PAYMENT_SEEDS) {
    const bookingId = deterministicUuid(`booking:${seed.bookingKey}`);

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, providerId: true, categoryId: true, payablePaise: true, status: true },
    });

    if (!booking || booking.payablePaise === null) continue;

    const paymentId = deterministicUuid(`payment:${seed.bookingKey}`);
    if (await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true } })) {
      continue;
    }

    const rateBps = await resolveSeedCommission(prisma, cityId, booking.categoryId);
    const split = splitCommission(booking.payablePaise, rateBps);

    if (seed.outcome === 'unpaid') {
      await prisma.payment.create({
        data: {
          id: paymentId,
          bookingId,
          purpose: 'final_bill',
          method: 'online',
          amountPaise: booking.payablePaise,
          commissionBpsSnapshot: rateBps,
          gateway: 'fake',
          gatewayOrderId: `order_seed_${seed.bookingKey}`.slice(0, 40),
          status: 'created',
        },
      });

      payments += 1;
      continue;
    }

    if (seed.method === 'cash') {
      await prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            id: paymentId,
            bookingId,
            purpose: 'final_bill',
            method: 'cash',
            amountPaise: booking.payablePaise as number,
            commissionBpsSnapshot: rateBps,
            status: 'captured',
            capturedAt: new Date('2026-08-14T10:00:00.000Z'),
          },
        });

        // Only the commission moves: the rest never touched the platform.
        await postJournal(tx, {
          key: `cash:${seed.bookingKey}`,
          journalType: 'cash_collected',
          bookingId,
          paymentId,
          memo: `cash ${split.grossPaise}p collected; commission ${split.commissionPaise}p owed`,
          lines: [
            {
              accountType: 'provider_dues',
              ownerType: 'provider',
              ownerId: booking.providerId,
              direction: 'debit',
              amountPaise: split.commissionPaise,
            },
            {
              accountType: 'platform_revenue',
              ownerType: 'platform',
              ownerId: null,
              direction: 'credit',
              amountPaise: split.commissionPaise,
            },
          ],
        });
      });

      payments += 1;
      journals += 1;
      continue;
    }

    // Online: captured, and possibly partly given back.
    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          id: paymentId,
          bookingId,
          purpose: 'final_bill',
          method: 'online',
          amountPaise: booking.payablePaise as number,
          commissionBpsSnapshot: rateBps,
          gateway: 'fake',
          gatewayOrderId: `order_seed_${seed.bookingKey}`.slice(0, 40),
          gatewayPaymentId: `pay_seed_${seed.bookingKey}`.slice(0, 40),
          status: seed.outcome === 'refunded' ? 'partially_refunded' : 'captured',
          capturedAt: new Date('2026-08-13T10:00:00.000Z'),
        },
      });

      await postJournal(tx, {
        key: `capture:${seed.bookingKey}`,
        journalType: 'payment_captured',
        bookingId,
        paymentId,
        memo: `online capture ${split.grossPaise}p, commission ${split.commissionPaise}p`,
        lines: [
          {
            accountType: 'gateway_cash',
            ownerType: 'platform',
            ownerId: null,
            direction: 'debit',
            amountPaise: split.grossPaise,
          },
          {
            accountType: 'provider_payable',
            ownerType: 'provider',
            ownerId: booking.providerId,
            direction: 'credit',
            amountPaise: split.providerPaise,
          },
          {
            accountType: 'platform_revenue',
            ownerType: 'platform',
            ownerId: null,
            direction: 'credit',
            amountPaise: split.commissionPaise,
          },
        ],
      });
    });

    payments += 1;
    journals += 1;

    if (seed.outcome === 'refunded' && seed.refundPaise) {
      const back = splitCommission(seed.refundPaise, rateBps);

      await prisma.$transaction(async (tx) => {
        await tx.refund.create({
          data: {
            id: deterministicUuid(`refund:${seed.bookingKey}`),
            paymentId,
            amountPaise: seed.refundPaise as number,
            gatewayRefundId: `rfnd_seed_${seed.bookingKey}`.slice(0, 40),
            status: 'processed',
            reason: 'Part of the work had to be redone by somebody else',
          },
        });

        // Both pockets give back their share, in the original proportion.
        await postJournal(tx, {
          key: `refund:${seed.bookingKey}`,
          journalType: 'refund',
          bookingId,
          paymentId,
          memo: `refund ${back.grossPaise}p (provider ${back.providerPaise}p, platform ${back.commissionPaise}p)`,
          lines: [
            {
              accountType: 'provider_payable',
              ownerType: 'provider',
              ownerId: booking.providerId,
              direction: 'debit',
              amountPaise: back.providerPaise,
            },
            {
              accountType: 'platform_revenue',
              ownerType: 'platform',
              ownerId: null,
              direction: 'debit',
              amountPaise: back.commissionPaise,
            },
            {
              accountType: 'gateway_cash',
              ownerType: 'platform',
              ownerId: null,
              direction: 'credit',
              amountPaise: back.grossPaise,
            },
          ],
        });
      });

      journals += 1;
    }
  }

  const batches = await seedDraftPayoutBatch(prisma);

  console.log(
    `payments ready: ${payments} payments, ${journals} journals, ${batches} payout batch`,
  );

  return { payments, journals, batches };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

interface SeedLine {
  accountType:
    'gateway_cash' | 'provider_payable' | 'provider_dues' | 'platform_revenue' | 'refunds_payable';
  ownerType: 'platform' | 'provider' | 'customer';
  ownerId: string | null;
  direction: 'debit' | 'credit';
  amountPaise: number;
}

interface SeedJournal {
  key: string;
  journalType:
    'payment_captured' | 'cash_collected' | 'refund' | 'payout' | 'dues_settled' | 'adjustment';
  bookingId: string | null;
  paymentId: string | null;
  memo: string;
  lines: SeedLine[];
}

/** Mirrors `ledger.post`, with deterministic ids so a rerun is a no-op. */
async function postJournal(
  tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
  journal: SeedJournal,
): Promise<void> {
  const lines = journal.lines.filter((line) => line.amountPaise > 0);
  if (lines.length < 2) return;

  const journalId = deterministicUuid(`journal:${journal.key}`);

  await tx.ledgerJournal.create({
    data: {
      id: journalId,
      journalType: journal.journalType,
      bookingId: journal.bookingId,
      paymentId: journal.paymentId,
      memo: journal.memo,
    },
  });

  for (const [index, line] of lines.entries()) {
    const accountId = await ensureSeedAccount(tx, line);

    await tx.ledgerEntry.create({
      data: {
        id: deterministicUuid(`entry:${journal.key}:${index}`),
        journalId,
        accountId,
        direction: line.direction,
        amountPaise: line.amountPaise,
      },
    });
  }
}

async function ensureSeedAccount(
  tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
  line: SeedLine,
): Promise<string> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO accounts (id, account_type, owner_type, owner_id, created_at)
    VALUES (gen_random_uuid(), ${line.accountType}::account_type,
            ${line.ownerType}::account_owner_type, ${line.ownerId}::uuid, NOW())
    ON CONFLICT (account_type, owner_type, owner_id) DO UPDATE
      SET account_type = EXCLUDED.account_type
    RETURNING id
  `;

  const row = rows[0];
  if (!row) throw new Error(`could not resolve seed account ${line.accountType}`);
  return row.id;
}

async function resolveSeedCommission(
  prisma: PrismaClient,
  cityId: number,
  categoryId: number,
): Promise<number> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { parentId: true },
  });

  const parentCategoryId = category?.parentId ?? null;

  const rows = await prisma.commissionConfig.findMany({
    where: {
      cityId,
      isActive: true,
      OR: [
        { categoryId: null },
        { categoryId: { in: [categoryId, ...(parentCategoryId ? [parentCategoryId] : [])] } },
      ],
    },
    select: { categoryId: true, rateBps: true, isActive: true, effectiveFrom: true },
  });

  return resolveCommissionRate(rows, { categoryId, parentCategoryId }, DEFAULT_COMMISSION_BPS)
    .rateBps;
}

/**
 * One draft batch over whatever the seeded captures left payable.
 *
 * Draft, never paid: marking it paid would move the ledger and leave a fresh
 * clone with a wallet showing zero, which is a much less useful thing to look at
 * than a technician with money waiting.
 */
async function seedDraftPayoutBatch(prisma: PrismaClient): Promise<number> {
  const batchId = deterministicUuid('payout-batch:seed');

  if (await prisma.payoutBatch.findUnique({ where: { id: batchId }, select: { id: true } })) {
    return 0;
  }

  const balances = await prisma.$queryRaw<
    { provider_id: string; net_paise: bigint }[]
  >`SELECT provider_id, net_paise FROM provider_balances WHERE net_paise >= 10000 ORDER BY provider_id`;

  if (balances.length === 0) return 0;

  const rows = balances.map((row) => ({
    providerId: row.provider_id,
    amountPaise: Number(row.net_paise),
  }));

  const totalPaise = rows.reduce((sum, row) => sum + row.amountPaise, 0);

  await prisma.$transaction(async (tx) => {
    await tx.payoutBatch.create({
      data: {
        id: batchId,
        status: 'draft',
        windowEnd: new Date('2026-08-15T18:30:00.000Z'),
        totalPaise,
        payoutCount: rows.length,
      },
    });

    for (const [index, row] of rows.entries()) {
      await tx.payout.create({
        data: {
          id: deterministicUuid(`payout:seed:${index}`),
          batchId,
          providerId: row.providerId,
          amountPaise: row.amountPaise,
        },
      });
    }
  });

  return 1;
}
