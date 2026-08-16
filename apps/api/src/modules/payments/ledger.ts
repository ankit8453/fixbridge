import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AccountType, AccountOwnerType, LedgerJournalType } from '@prisma/client';

/**
 * The only way money is ever written.
 *
 * ## Law #1
 *
 * > Money exists only as double-entry ledger rows. There is no balance column
 * > anywhere and there never will be.
 *
 * A balance you can `UPDATE` is a balance that can be wrong, and the moment one
 * exists every code path that touches money has to remember to keep it right.
 * Sum the entries instead: it cannot drift, it explains itself, and the answer
 * to "why is this number what it is" is a query rather than an investigation.
 *
 * ## Why this is the only writer
 *
 * Repositories elsewhere never insert into `ledger_entries`. Everything posts
 * through `post()` so that the journal-building rules — every journal balances,
 * every entry is positive, accounts are created lazily — live in one place. The
 * database enforces the same rules with a deferred constraint trigger, so a
 * future repository that forgets this file still cannot unbalance the books.
 * Belt and braces, on purpose: this is the part where being wrong costs money.
 */

export interface AccountRef {
  accountType: AccountType;
  ownerType: AccountOwnerType;
  /** Null for platform accounts. */
  ownerId?: string | null;
}

export interface JournalLine extends AccountRef {
  direction: 'debit' | 'credit';
  amountPaise: number;
}

export interface JournalInput {
  journalType: LedgerJournalType;
  entries: JournalLine[];
  bookingId?: string | null;
  paymentId?: string | null;
  memo?: string | null;
}

export class UnbalancedJournalError extends Error {
  constructor(
    readonly debits: number,
    readonly credits: number,
  ) {
    super(`journal does not balance: debits=${debits} credits=${credits}`);
    this.name = 'UnbalancedJournalError';
  }
}

/* -------------------------------------------------------------------------- */
/* Accounts                                                                   */
/* -------------------------------------------------------------------------- */

const platformOwner = (ref: AccountRef): string | null =>
  ref.ownerType === 'platform' ? null : (ref.ownerId ?? null);

/**
 * Finds or creates an account.
 *
 * Lazy on purpose: a technician who has never been paid should have no account
 * rather than a row of zeroes, so "who have we ever owed money to" is a question
 * the table answers by existing.
 *
 * The insert is `ON CONFLICT DO NOTHING` against the unique triple, so two
 * concurrent first-payments for the same technician cannot create two accounts
 * and split their balance across both.
 */
export async function ensureAccount(
  tx: Prisma.TransactionClient,
  ref: AccountRef,
): Promise<string> {
  const ownerId = platformOwner(ref);

  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO accounts (id, account_type, owner_type, owner_id, created_at)
    VALUES (${randomUUID()}::uuid, ${ref.accountType}::account_type,
            ${ref.ownerType}::account_owner_type, ${ownerId}::uuid, NOW())
    ON CONFLICT (account_type, owner_type, owner_id) DO UPDATE
      SET account_type = EXCLUDED.account_type
    RETURNING id
  `;

  const created = rows[0];
  if (!created) throw new Error(`could not resolve ledger account ${ref.accountType}`);

  return created.id;
}

/* -------------------------------------------------------------------------- */
/* Posting                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Writes one balanced journal.
 *
 * `tx` is required and is deliberately the transaction client: a journal that
 * could be written outside its caller's transaction would let money move for a
 * state change that then rolled back — the same reasoning as `enqueueOutbox`.
 *
 * The balance check here is for the error message, not for safety. The database
 * asserts it again at commit and that assertion is the one that counts; this one
 * just means a developer sees "journal does not balance: debits=500 credits=499"
 * instead of a constraint violation from a deferred trigger.
 */
export async function post(
  tx: Prisma.TransactionClient,
  input: JournalInput,
): Promise<{ journalId: string }> {
  if (input.entries.length < 2) {
    throw new Error(`a ${input.journalType} journal needs at least two entries to be double entry`);
  }

  let debits = 0;
  let credits = 0;

  for (const entry of input.entries) {
    if (!Number.isSafeInteger(entry.amountPaise) || entry.amountPaise <= 0) {
      throw new Error(
        `ledger entries must be a positive whole number of paise, got ${entry.amountPaise}`,
      );
    }

    if (entry.direction === 'debit') debits += entry.amountPaise;
    else credits += entry.amountPaise;
  }

  if (debits !== credits) throw new UnbalancedJournalError(debits, credits);

  const journal = await tx.ledgerJournal.create({
    data: {
      journalType: input.journalType,
      bookingId: input.bookingId ?? null,
      paymentId: input.paymentId ?? null,
      memo: input.memo ?? null,
    },
    select: { id: true },
  });

  for (const entry of input.entries) {
    const accountId = await ensureAccount(tx, entry);

    await tx.ledgerEntry.create({
      data: {
        journalId: journal.id,
        accountId,
        direction: entry.direction,
        amountPaise: entry.amountPaise,
      },
    });
  }

  return { journalId: journal.id };
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export interface ProviderBalance {
  /** What we owe them for online-paid work. */
  payablePaise: number;
  /** What they owe us: commission on cash they pocketed. */
  duesPaise: number;
  /** `payable − dues`. Can be negative, and is left negative on purpose. */
  netPaise: number;
}

const ZERO_BALANCE: ProviderBalance = { payablePaise: 0, duesPaise: 0, netPaise: 0 };

/**
 * A technician's position, straight from the view.
 *
 * Payable and dues are reported separately rather than netted into one figure,
 * because "we owe you ₹4,000 and you owe us ₹600" is a sentence a technician can
 * check against their own week. "₹3,400" is not.
 */
export async function providerBalance(
  prisma: PrismaClient,
  providerId: string,
): Promise<ProviderBalance> {
  const rows = await prisma.$queryRaw<
    { payable_paise: bigint; dues_paise: bigint; net_paise: bigint }[]
  >`
    SELECT payable_paise, dues_paise, net_paise
    FROM provider_balances WHERE provider_id = ${providerId}::uuid
  `;

  const row = rows[0];
  if (!row) return ZERO_BALANCE;

  return {
    payablePaise: Number(row.payable_paise),
    duesPaise: Number(row.dues_paise),
    netPaise: Number(row.net_paise),
  };
}

/** Every technician with a non-zero position. Drives the payout run. */
export async function allProviderBalances(
  prisma: PrismaClient,
): Promise<(ProviderBalance & { providerId: string })[]> {
  const rows = await prisma.$queryRaw<
    { provider_id: string; payable_paise: bigint; dues_paise: bigint; net_paise: bigint }[]
  >`
    SELECT provider_id, payable_paise, dues_paise, net_paise
    FROM provider_balances
    ORDER BY provider_id
  `;

  return rows.map((row) => ({
    providerId: row.provider_id,
    payablePaise: Number(row.payable_paise),
    duesPaise: Number(row.dues_paise),
    netPaise: Number(row.net_paise),
  }));
}

export interface PlatformPosition {
  revenuePaise: number;
  gatewayCashPaise: number;
  owedToProvidersPaise: number;
  owedByProvidersPaise: number;
  refundsPendingPaise: number;
}

export async function platformPosition(prisma: PrismaClient): Promise<PlatformPosition> {
  const rows = await prisma.$queryRaw<
    {
      revenue_paise: bigint;
      gateway_cash_paise: bigint;
      owed_to_providers_paise: bigint;
      owed_by_providers_paise: bigint;
      refunds_pending_paise: bigint;
    }[]
  >`SELECT * FROM platform_revenue_view`;

  const row = rows[0];

  return {
    revenuePaise: Number(row?.revenue_paise ?? 0),
    gatewayCashPaise: Number(row?.gateway_cash_paise ?? 0),
    owedToProvidersPaise: Number(row?.owed_to_providers_paise ?? 0),
    owedByProvidersPaise: Number(row?.owed_by_providers_paise ?? 0),
    refundsPendingPaise: Number(row?.refunds_pending_paise ?? 0),
  };
}

export interface LedgerLine {
  journalId: string;
  journalType: LedgerJournalType;
  accountType: AccountType;
  direction: 'debit' | 'credit';
  amountPaise: number;
  bookingId: string | null;
  createdAt: Date;
}

/**
 * A technician's own lines, newest first.
 *
 * Scoped to accounts they own, and the memo is deliberately **not** selected:
 * memos are written for ops and may name a customer, a dispute or another
 * technician. A wallet needs amounts and reasons, not internal notes.
 */
export async function providerLedgerLines(
  prisma: PrismaClient,
  providerId: string,
  limit: number,
): Promise<LedgerLine[]> {
  const rows = await prisma.$queryRaw<
    {
      journal_id: string;
      journal_type: LedgerJournalType;
      account_type: AccountType;
      direction: 'debit' | 'credit';
      amount_paise: number;
      booking_id: string | null;
      created_at: Date;
    }[]
  >`
    SELECT j.id AS journal_id, j.journal_type, a.account_type, e.direction,
           e.amount_paise, j.booking_id, e.created_at
    FROM ledger_entries e
    JOIN accounts a ON a.id = e.account_id
    JOIN ledger_journals j ON j.id = e.journal_id
    WHERE a.owner_type = 'provider' AND a.owner_id = ${providerId}::uuid
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    journalId: row.journal_id,
    journalType: row.journal_type,
    accountType: row.account_type,
    direction: row.direction,
    amountPaise: Number(row.amount_paise),
    bookingId: row.booking_id,
    createdAt: row.created_at,
  }));
}

/** Every journal, with its debit and credit totals. Used by the seed audit test. */
export async function auditJournals(
  prisma: PrismaClient,
): Promise<{ journalId: string; journalType: string; debits: number; credits: number }[]> {
  const rows = await prisma.$queryRaw<
    { journal_id: string; journal_type: string; debits: bigint; credits: bigint }[]
  >`
    SELECT j.id AS journal_id, j.journal_type::text AS journal_type,
           coalesce(sum(e.amount_paise) FILTER (WHERE e.direction = 'debit'), 0)  AS debits,
           coalesce(sum(e.amount_paise) FILTER (WHERE e.direction = 'credit'), 0) AS credits
    FROM ledger_journals j
    LEFT JOIN ledger_entries e ON e.journal_id = j.id
    GROUP BY j.id
    ORDER BY j.created_at
  `;

  return rows.map((row) => ({
    journalId: row.journal_id,
    journalType: row.journal_type,
    debits: Number(row.debits),
    credits: Number(row.credits),
  }));
}
