import type { PrismaClient } from '@prisma/client';
import { deterministicUuid } from './deterministic-id';

/**
 * What it costs to get a technician to your door, by trade.
 *
 * The numbers say something real about the work. A motor rewinder or genset
 * technician arrives with tools, a clamp meter and half a morning gone; an AC
 * gas refill needs a cylinder in the vehicle. A tap washer does not. One flat
 * fee across all of them either underpays the first two or overcharges the
 * third — and the third is the customer a young marketplace can least afford to
 * annoy.
 */
const FEES: { key: string; categorySlug: string | null; visitFeePaise: number; why: string }[] = [
  { key: 'city-default', categorySlug: null, visitFeePaise: 4_900, why: 'Jabalpur baseline' },
  {
    key: 'motors-generators',
    // A cluster: this one row prices every service beneath it.
    categorySlug: 'motors-generators',
    visitFeePaise: 9_900,
    why: 'heavier tools, longer diagnosis',
  },
  {
    key: 'ac-service-gas-refill',
    categorySlug: 'ac-service-gas-refill',
    visitFeePaise: 7_900,
    why: 'gas cylinder and gauges travel with the technician',
  },
];

export async function seedFeeConfig(
  prisma: PrismaClient,
  cityId: number,
  categoryIdBySlug: Map<string, number>,
): Promise<number> {
  // A fixed instant, so a rerun never shifts what an existing booking resolved
  // against. `effective_from` is how a price change is scheduled, not a log of
  // when the seed happened to run.
  const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');

  for (const fee of FEES) {
    const categoryId = fee.categorySlug ? categoryIdBySlug.get(fee.categorySlug) : null;

    if (fee.categorySlug && categoryId === undefined) {
      throw new Error(`fee seed refers to unknown category: ${fee.categorySlug}`);
    }

    const id = deterministicUuid(`fee-config:${cityId}:${fee.key}`);

    await prisma.feeConfig.upsert({
      where: { id },
      update: { visitFeePaise: fee.visitFeePaise, isActive: true },
      create: {
        id,
        cityId,
        categoryId: categoryId ?? null,
        visitFeePaise: fee.visitFeePaise,
        isActive: true,
        effectiveFrom,
      },
    });
  }

  console.log(`fee config ready: ${FEES.length} rows (city default ₹49)`);

  return FEES.length;
}
