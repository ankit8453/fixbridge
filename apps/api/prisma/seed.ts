import { PrismaClient, Role } from '@prisma/client';
import { maskPhone, normalizePhone } from '../src/modules/auth/phone';
import { seedCategories } from './seeds/categories';
import { seedCustomer } from './seeds/customer';
import { seedProviders } from './seeds/providers';

/**
 * Idempotent seed — safe to run repeatedly against the same database.
 * Every row upserts on a natural or deterministic key, so reruns update rather
 * than duplicate. `npm run seed && npm run seed` must leave identical counts.
 */
const prisma = new PrismaClient();

const CITIES = [{ name: 'Jabalpur', state: 'Madhya Pradesh', isActive: true }] as const;

/** Falls back to a number inside the dev fixed-OTP prefix so you can sign in. */
const DEFAULT_ADMIN_PHONE = '+919999900001';
const ADMIN_ROLES: Role[] = [Role.admin, Role.ops];

async function seedCities(): Promise<number> {
  let launchCityId = 0;

  for (const city of CITIES) {
    const record = await prisma.city.upsert({
      where: { name_state: { name: city.name, state: city.state } },
      update: { isActive: city.isActive },
      create: { name: city.name, state: city.state, isActive: city.isActive },
    });

    if (launchCityId === 0) launchCityId = record.id;
    console.log(`city ready: #${record.id} ${record.name}, ${record.state}`);
  }

  return launchCityId;
}

/**
 * The bootstrap admin. Roles are upserted individually rather than replaced, so
 * re-running never strips a role an operator granted by hand.
 */
async function seedAdminUser(cityId: number): Promise<void> {
  const raw = process.env.SEED_ADMIN_PHONE ?? DEFAULT_ADMIN_PHONE;
  const phone = normalizePhone(raw);

  if (phone === null) {
    throw new Error(`SEED_ADMIN_PHONE is not a valid Indian mobile number: ${raw}`);
  }

  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, name: 'Platform Admin', defaultCityId: cityId },
  });

  for (const role of ADMIN_ROLES) {
    await prisma.userRole.upsert({
      where: { userId_role: { userId: user.id, role } },
      update: {},
      create: { userId: user.id, role },
    });
  }

  console.log(`admin ready: ${maskPhone(phone)} roles=[${ADMIN_ROLES.join(', ')}]`);
}

async function main(): Promise<void> {
  const cityId = await seedCities();
  const listingThreshold = Number(process.env.PROVIDER_LISTING_THRESHOLD ?? 80);

  await seedAdminUser(cityId);

  const categoryIdBySlug = await seedCategories(prisma, cityId);
  await seedProviders(prisma, cityId, categoryIdBySlug, listingThreshold);
  await seedCustomer(prisma, cityId);
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
