import { config as loadDotenv } from 'dotenv';
import path from 'node:path';

/**
 * Load apps/api/.env explicitly — same reason as the development seed: this
 * file is run by tsx, and nothing loads the file for it.
 */
loadDotenv({ path: path.resolve(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { seedCategories } from './seeds/categories';
import { seedCommissionConfig } from './seeds/commission';
import { seedFeeConfig } from './seeds/fees';
import { seedSynonyms } from './seeds/synonyms';

/**
 * Reference data for a real deployment. **No people.**
 *
 * The development seed (`prisma/seed.ts`) creates fictional technicians,
 * customers, bookings, payments and verification cases. That is exactly what a
 * developer needs and exactly what must never reach production: a real
 * customer who searches for a plumber and finds "Santosh Yadav, 4.8 stars" has
 * been lied to, and the fake bookings would sit in the ledger distorting every
 * figure ops looks at.
 *
 * So this is a deliberately separate entry point rather than a flag on the
 * other one. A flag can be forgotten or inverted; a different file cannot be
 * run by accident.
 *
 * What it does write is the data the app cannot function without and which no
 * user creates: the city, the service catalogue, the search synonyms, and the
 * fee and commission configuration that booking snapshots read.
 *
 * Idempotent, like the development seed — every row upserts on a natural key,
 * so running it again after adding a category updates rather than duplicates.
 *
 * The admin account is **not** created here. `prisma/bootstrap-admin.ts` owns
 * that, because it needs a real password from the environment and should be a
 * separate, deliberate act.
 */
const prisma = new PrismaClient();

const CITIES = [{ name: 'Jabalpur', state: 'Madhya Pradesh', isActive: true }] as const;

async function seedCities(): Promise<number> {
  let launchCityId = 0;

  for (const city of CITIES) {
    const row = await prisma.city.upsert({
      where: { name_state: { name: city.name, state: city.state } },
      update: { isActive: city.isActive },
      create: city,
    });

    if (launchCityId === 0) launchCityId = row.id;
  }

  return launchCityId;
}

async function main(): Promise<void> {
  const cityId = await seedCities();
  console.log(`city ready (id ${cityId})`);

  // Each of these logs its own summary, so nothing is repeated here.
  const categoryIdBySlug = await seedCategories(prisma, cityId);
  await seedSynonyms(prisma, categoryIdBySlug);

  // Order matters: a booking snapshots its visit fee through this table, so
  // the config has to exist before the first booking, not after it.
  await seedFeeConfig(prisma, cityId, categoryIdBySlug);
  await seedCommissionConfig(prisma, cityId, categoryIdBySlug);

  console.log('\nReference data seeded. No users, providers or bookings were created.');
  console.log('Next: npm run bootstrap:admin -- to create the one admin account.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
