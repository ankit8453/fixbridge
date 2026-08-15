import type { PrismaClient } from '@prisma/client';

/**
 * The launch taxonomy. Two levels: cluster → service.
 *
 * `nameKey` is an i18n key, never display text — the same row renders as
 * "Electrical" or "बिजली का काम" depending on Accept-Language. Nothing here
 * contains a word a user will ever read.
 */
interface ClusterSeed {
  slug: string;
  nameKey: string;
  icon: string;
  services: { slug: string; nameKey: string }[];
}

export const CATEGORY_TREE: ClusterSeed[] = [
  {
    slug: 'electrical',
    nameKey: 'categories.electrical',
    icon: 'bolt',
    services: [
      { slug: 'house-wiring', nameKey: 'categories.houseWiring' },
      { slug: 'inverter-ups', nameKey: 'categories.inverterUps' },
      { slug: 'fan-geyser-motor-installation', nameKey: 'categories.fanGeyserMotorInstallation' },
      { slug: 'switchboard-mcb', nameKey: 'categories.switchboardMcb' },
      { slug: 'earthing', nameKey: 'categories.earthing' },
    ],
  },
  {
    slug: 'motors-generators',
    nameKey: 'categories.motorsGenerators',
    icon: 'engine',
    services: [
      { slug: 'motor-rewinding', nameKey: 'categories.motorRewinding' },
      { slug: 'pump-borewell-repair', nameKey: 'categories.pumpBorewellRepair' },
      { slug: 'genset-servicing', nameKey: 'categories.gensetServicing' },
      { slug: 'stabilizers', nameKey: 'categories.stabilizers' },
    ],
  },
  {
    slug: 'plumbing',
    nameKey: 'categories.plumbing',
    icon: 'pipe',
    services: [
      { slug: 'leakage-repair', nameKey: 'categories.leakageRepair' },
      { slug: 'fittings-fixtures', nameKey: 'categories.fittingsFixtures' },
      { slug: 'tank-cleaning', nameKey: 'categories.tankCleaning' },
      { slug: 'ro-service', nameKey: 'categories.roService' },
    ],
  },
  {
    slug: 'cooling-appliances',
    nameKey: 'categories.coolingAppliances',
    icon: 'snowflake',
    services: [
      { slug: 'ac-service-gas-refill', nameKey: 'categories.acServiceGasRefill' },
      { slug: 'fridge-repair', nameKey: 'categories.fridgeRepair' },
      { slug: 'washing-machine-repair', nameKey: 'categories.washingMachineRepair' },
      { slug: 'microwave-repair', nameKey: 'categories.microwaveRepair' },
    ],
  },
  {
    slug: 'mechanics',
    nameKey: 'categories.mechanics',
    icon: 'wrench',
    services: [
      { slug: 'two-wheeler-doorstep', nameKey: 'categories.twoWheelerDoorstep' },
      { slug: 'car-battery-jumpstart', nameKey: 'categories.carBatteryJumpstart' },
      { slug: 'cycle-repair', nameKey: 'categories.cycleRepair' },
    ],
  },
];

/** Upserts on `(cityId, slug)`, so reruns update rather than duplicate. */
export async function seedCategories(
  prisma: PrismaClient,
  cityId: number,
): Promise<Map<string, number>> {
  const idsBySlug = new Map<string, number>();
  let clusterOrder = 0;

  for (const cluster of CATEGORY_TREE) {
    clusterOrder += 1;

    const clusterRow = await prisma.category.upsert({
      where: { cityId_slug: { cityId, slug: cluster.slug } },
      update: {
        nameKey: cluster.nameKey,
        icon: cluster.icon,
        sortOrder: clusterOrder,
        isActive: true,
      },
      create: {
        cityId,
        slug: cluster.slug,
        nameKey: cluster.nameKey,
        icon: cluster.icon,
        sortOrder: clusterOrder,
      },
    });

    idsBySlug.set(cluster.slug, clusterRow.id);

    let serviceOrder = 0;
    for (const service of cluster.services) {
      serviceOrder += 1;

      const serviceRow = await prisma.category.upsert({
        where: { cityId_slug: { cityId, slug: service.slug } },
        update: {
          nameKey: service.nameKey,
          parentId: clusterRow.id,
          sortOrder: serviceOrder,
          isActive: true,
        },
        create: {
          cityId,
          slug: service.slug,
          nameKey: service.nameKey,
          parentId: clusterRow.id,
          sortOrder: serviceOrder,
        },
      });

      idsBySlug.set(service.slug, serviceRow.id);
    }
  }

  const clusters = CATEGORY_TREE.length;
  const services = CATEGORY_TREE.reduce((total, cluster) => total + cluster.services.length, 0);
  console.log(`categories ready: ${clusters} clusters, ${services} services`);

  return idsBySlug;
}
