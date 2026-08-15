import { PrismaClient, Role } from '@prisma/client';
import { maskPhone, normalizePhone } from '../src/modules/auth/phone';

/**
 * Idempotent seed — safe to run repeatedly against the same database.
 * Every entry upserts on a natural key, so reruns update rather than duplicate.
 */
const prisma = new PrismaClient();

const CITIES = [{ name: 'Jabalpur', state: 'Madhya Pradesh', isActive: true }] as const;

/** Falls back to a number inside the dev fixed-OTP prefix so you can actually sign in. */
const DEFAULT_ADMIN_PHONE = '+919999900001';
const ADMIN_ROLES: Role[] = [Role.admin, Role.ops];

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

/**
 * The bootstrap admin. Roles are upserted individually rather than replaced, so
 * re-running never strips a role an operator granted by hand.
 */
async function seedAdminUser(): Promise<void> {
  const raw = process.env.SEED_ADMIN_PHONE ?? DEFAULT_ADMIN_PHONE;
  const phone = normalizePhone(raw);

  if (phone === null) {
    throw new Error(`SEED_ADMIN_PHONE is not a valid Indian mobile number: ${raw}`);
  }

  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, name: 'Platform Admin' },
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
  await seedCities();
  await seedAdminUser();
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
