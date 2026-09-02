import type { PrismaClient } from '@prisma/client';
import { deterministicUuid } from './deterministic-id';

/**
 * What the platform takes, by trade.
 *
 * **Zero for the pilot.** The first month or two exists to prove technicians
 * get paid and customers get a plumber who turns up, and charging for that
 * before either is demonstrated buys a worse launch for no revenue worth
 * having. It is also the easiest possible pitch to a technician who has never
 * heard of us: keep everything.
 *
 * The rates to return to, when the pilot ends, are 12% as a city baseline and
 * 10% for motors and gensets — lower there because supply is the constraint:
 * those are the hardest technicians to recruit, their jobs are larger and less
 * frequent, and a percentage point of a ₹12,000 rewinding job is worth more to
 * them than to us. A marketplace with no electricians has no customers either.
 *
 * Raising it is a row in `commission_config`, not a deploy — and because each
 * booking snapshots the rate that applied when it was made, turning commission
 * on later cannot reach back and change what somebody has already earned.
 */
const RATES: { key: string; categorySlug: string | null; rateBps: number; why: string }[] = [
  { key: 'city-default', categorySlug: null, rateBps: 0, why: 'pilot: no commission' },
];

export async function seedCommissionConfig(
  prisma: PrismaClient,
  cityId: number,
  categoryIdBySlug: Map<string, number>,
): Promise<number> {
  // Fixed, like the fee config: a rerun must not shift what a past payment
  // resolved against.
  const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');

  for (const rate of RATES) {
    const categoryId = rate.categorySlug ? categoryIdBySlug.get(rate.categorySlug) : null;

    if (rate.categorySlug && categoryId === undefined) {
      throw new Error(`commission seed refers to unknown category: ${rate.categorySlug}`);
    }

    const id = deterministicUuid(`commission-config:${cityId}:${rate.key}`);

    await prisma.commissionConfig.upsert({
      where: { id },
      update: { rateBps: rate.rateBps, isActive: true },
      create: {
        id,
        cityId,
        categoryId: categoryId ?? null,
        rateBps: rate.rateBps,
        isActive: true,
        effectiveFrom,
      },
    });
  }

  /**
   * Retire any row this seed no longer declares.
   *
   * Without this the seed only ever adds: dropping the motors-and-gensets rate
   * from `RATES` left its 10% row active in the database, so every trade moved
   * to the pilot's 0% except the one the exception had been written for — the
   * exact opposite of what was intended, and silent.
   *
   * Deactivated rather than deleted, because a past booking may have resolved
   * its commission against this row and the history has to stay readable.
   */
  const keep = RATES.map((rate) => deterministicUuid(`commission-config:${cityId}:${rate.key}`));

  const retired = await prisma.commissionConfig.updateMany({
    where: { cityId, isActive: true, id: { notIn: keep } },
    data: { isActive: false },
  });

  const cityDefault = RATES.find((rate) => rate.categorySlug === null);
  const pct = cityDefault
    ? (cityDefault.rateBps / 100).toFixed(cityDefault.rateBps % 100 ? 2 : 0)
    : '—';

  console.log(
    `commission config ready: ${RATES.length} row(s), city default ${pct}%` +
      (retired.count > 0 ? `, ${retired.count} retired` : ''),
  );

  return RATES.length;
}
