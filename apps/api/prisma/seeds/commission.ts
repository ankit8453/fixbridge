import type { PrismaClient } from '@prisma/client';
import { deterministicUuid } from './deterministic-id';

/**
 * What the platform takes, by trade.
 *
 * 12% is the pilot default. Motors and gensets get 10%, and the reason is
 * supply: those are the hardest technicians to recruit, their jobs are larger
 * and less frequent, and a percentage point of a ₹12,000 rewinding job is worth
 * more to them than to us. A marketplace with no electricians has no customers
 * either.
 */
const RATES: { key: string; categorySlug: string | null; rateBps: number; why: string }[] = [
  { key: 'city-default', categorySlug: null, rateBps: 1_200, why: 'Jabalpur baseline, 12%' },
  {
    key: 'motors-generators',
    // A cluster, so it covers every service beneath it.
    categorySlug: 'motors-generators',
    rateBps: 1_000,
    why: 'scarce, higher-ticket trades — 10% to keep supply',
  },
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

  console.log(`commission config ready: ${RATES.length} rows (city default 12%)`);

  return RATES.length;
}
