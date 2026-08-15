import { PrismaClient } from '@prisma/client';

/**
 * Idempotent seed — safe to run repeatedly against the same database.
 * Every entry upserts on a natural key, so reruns update rather than duplicate.
 */
const prisma = new PrismaClient();

const CITIES = [{ name: 'Jabalpur', state: 'Madhya Pradesh', isActive: true }] as const;

async function seedCities(): Promise<void> {
  for (const city of CITIES) {
    const record = await prisma.city.upsert({
      where: { name_state: { name: city.name, state: city.state } },
      update: { isActive: city.isActive },
      create: { name: city.name, state: city.state, isActive: city.isActive },
    });

    console.log(`city ready: #${record.id} ${record.name}, ${record.state}`);
  }
}

async function main(): Promise<void> {
  await seedCities();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('seed complete');
  })
  .catch(async (error: unknown) => {
    console.error('seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
