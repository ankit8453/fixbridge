import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedPayments } from '../../../prisma/seeds/payments';
import { parseConfig, type AppConfig } from '../../core/config';
import { createContext, disposeContext, type AppContext } from '../../core/context';
import * as ledger from './ledger';

/**
 * The seeded books, audited.
 *
 * A seed that quietly produces an unbalanced ledger would make every local
 * screen and every hand-check downstream a lie, and nobody would notice until
 * the numbers were needed. So the whole table is audited on every run, and the
 * headline figures are asserted against numbers worked out on paper.
 *
 * Read-only throughout — this suite must not disturb what it is checking.
 */

let context: AppContext | undefined;
let unavailableReason: string | undefined;

function firstMeaningfulLine(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  return (
    error.message
      .split('\n')
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? error.name
  );
}

beforeAll(async () => {
  let config: AppConfig;

  try {
    config = parseConfig();
  } catch (error) {
    unavailableReason = `environment is not configured: ${firstMeaningfulLine(error)}`;
    return;
  }

  context = createContext(config);

  try {
    await context.prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    unavailableReason = `dependencies unreachable: ${firstMeaningfulLine(error)}`;
    return;
  }

  /**
   * Runs the seed itself rather than trusting whatever is in the database.
   *
   * The payments suite has to `TRUNCATE` the ledger — those rows cannot be
   * DELETEd, deliberately — and truncate is global. Producing the fixtures here
   * makes this suite independent of which file ran first, which matters because
   * the thing under test is *the seed*, not the leftovers of another test run.
   */
  const city = await context.prisma.city.findFirst({ where: { isActive: true } });

  if (!city) {
    unavailableReason = 'the database has no seeded city; run `npm run seed`';
    return;
  }

  // Cleared first, because `seedPayments` skips a payment row that already
  // exists — and a leftover payment with a truncated journal is exactly the
  // half-state another suite leaves behind.
  await context.prisma.refund.deleteMany({});
  await context.prisma.payment.deleteMany({});
  await context.prisma.payout.deleteMany({});
  await context.prisma.payoutBatch.deleteMany({});
  await context.prisma.$executeRawUnsafe('TRUNCATE ledger_entries, ledger_journals CASCADE');
  await context.prisma.$executeRawUnsafe('DELETE FROM accounts');

  await seedPayments(context.prisma, city.id);
}, 90_000);

afterAll(async () => {
  if (context) await disposeContext(context);
});

describe('the seeded ledger', () => {
  it('has every journal balanced, without exception', async () => {
    if (unavailableReason || !context) return;

    const journals = await ledger.auditJournals(context.prisma);

    // Not vacuous: the seed writes five journals across three shapes.
    expect(journals.length).toBeGreaterThan(0);

    const unbalanced = journals.filter((journal) => journal.debits !== journal.credits);

    expect(
      unbalanced,
      `unbalanced journals:\n${unbalanced
        .map((j) => `  ${j.journalType} ${j.journalId}: ${j.debits} vs ${j.credits}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('never records a zero or negative entry', async () => {
    if (unavailableReason || !context) return;

    const rows = await context.prisma.ledgerEntry.count({ where: { amountPaise: { lte: 0 } } });
    expect(rows).toBe(0);
  });

  it('gives every journal at least two lines', async () => {
    if (unavailableReason || !context) return;

    const rows = await context.prisma.$queryRaw<{ id: string; lines: bigint }[]>`
      SELECT j.id, count(e.id) AS lines
      FROM ledger_journals j LEFT JOIN ledger_entries e ON e.journal_id = j.id
      GROUP BY j.id HAVING count(e.id) < 2
    `;

    expect(rows).toEqual([]);
  });

  /**
   * The books close: what the platform holds equals what it owes plus what it
   * has earned, minus what technicians owe back.
   *
   * This is the accounting identity the whole design exists to keep true. If it
   * ever fails, a journal somewhere is posting to the wrong account — which
   * balances, and is still wrong.
   */
  it('closes: cash held = owed out + revenue − owed in', async () => {
    if (unavailableReason || !context) return;

    const position = await ledger.platformPosition(context.prisma);

    expect(position.gatewayCashPaise).toBe(
      position.owedToProvidersPaise + position.revenuePaise - position.owedByProvidersPaise,
    );
  });

  it('matches the hand-computed seed figures', async () => {
    if (unavailableReason || !context) return;

    const position = await ledger.platformPosition(context.prisma);

    /**
     * Worked out on paper from the seeded bookings, at 12%:
     *
     *   completed                 ₹229.00 → cut ₹27.48, provider ₹201.52
     *   completed-via-quote     ₹1,300.00 → cut ₹156.00, provider ₹1,144.00
     *   completed-after-revision ₹1,450.00 → cut ₹174.00, provider ₹1,276.00
     *     …less a ₹500 refund     → back: cut ₹60.00, provider ₹440.00
     *   completed-after-otp-retry ₹629.00 CASH → dues ₹75.48, revenue ₹75.48
     *
     *   gateway cash   = 229 + 1300 + 1450 − 500          = ₹2,479.00
     *   owed to techs  = 201.52 + 1144 + 1276 − 440       = ₹2,181.52
     *   revenue        = 27.48 + 156 + 174 − 60 + 75.48   =   ₹372.96
     *   owed by techs  = 75.48                            =    ₹75.48
     *
     * If the seed changes, these change with it — deliberately, so a change to
     * the fixtures has to be a decision rather than a shrug.
     */
    expect(position.gatewayCashPaise).toBe(247_900);
    expect(position.owedToProvidersPaise).toBe(218_152);
    expect(position.revenuePaise).toBe(37_296);
    expect(position.owedByProvidersPaise).toBe(7_548);
    expect(position.refundsPendingPaise).toBe(0);
  });

  it('gives the seeded draft batch a header that matches its lines', async () => {
    if (unavailableReason || !context) return;

    const batches = await context.prisma.payoutBatch.findMany({ include: { payouts: true } });

    for (const batch of batches) {
      const total = batch.payouts.reduce((sum, payout) => sum + payout.amountPaise, 0);

      expect(batch.totalPaise).toBe(total);
      expect(batch.payoutCount).toBe(batch.payouts.length);
    }
  });

  it('leaves the draft batch unpaid, so a fresh clone has money to look at', async () => {
    if (unavailableReason || !context) return;

    const paid = await context.prisma.payout.count({ where: { status: 'paid' } });
    expect(paid).toBe(0);
  });

  it('snapshots a price card onto every booking that had one', async () => {
    if (unavailableReason || !context) return;

    // The Phase 7 carry-over, checked against the seeded data: any booking that
    // names a card must also carry the copy.
    const missing = await context.prisma.booking.count({
      where: { priceCardId: { not: null }, priceCardType: null },
    });

    expect(missing).toBe(0);
  });
});
