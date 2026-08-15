import type { PrismaClient } from '@prisma/client';
import { maskPhone } from '../../src/modules/auth/phone';
import { deterministicUuid } from './deterministic-id';
import { localityByName } from './localities';

/** Inside the dev fixed-OTP prefix, so you can actually sign in as this user. */
export const SEED_CUSTOMER_PHONE = '+919999900050';

const ADDRESSES = [
  {
    key: 'home',
    label: 'home' as const,
    addressText: '212, Shastri Nagar, near Wright Town Stadium',
    landmark: 'Behind Gupta Kirana Store',
    locality: 'Wright Town',
    isDefault: true,
  },
  {
    key: 'shop',
    label: 'shop' as const,
    addressText: 'Shop 4, Adhartal Main Road',
    landmark: 'Opposite the water tank',
    locality: 'Adhartal',
    isDefault: false,
  },
];

export async function seedCustomer(prisma: PrismaClient, cityId: number): Promise<void> {
  const user = await prisma.user.upsert({
    where: { phone: SEED_CUSTOMER_PHONE },
    update: {},
    create: { phone: SEED_CUSTOMER_PHONE, name: 'Test Customer', defaultCityId: cityId },
  });

  await prisma.userRole.upsert({
    where: { userId_role: { userId: user.id, role: 'customer' } },
    update: {},
    create: { userId: user.id, role: 'customer' },
  });

  await prisma.customerProfile.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, displayName: 'Test Customer', email: 'test.customer@example.com' },
  });

  for (const address of ADDRESSES) {
    const locality = localityByName(address.locality);
    const id = deterministicUuid(`address:${SEED_CUSTOMER_PHONE}:${address.key}`);

    // `location` is a geography column, so the whole row goes in by raw SQL.
    await prisma.$executeRaw`
      INSERT INTO addresses
        (id, user_id, label, label_text, address_text, landmark, city_id, location, is_default, created_at, updated_at)
      VALUES (
        ${id}::uuid,
        ${user.id}::uuid,
        ${address.label}::address_label,
        NULL,
        ${address.addressText},
        ${address.landmark},
        ${cityId},
        ST_SetSRID(ST_MakePoint(${locality.lng}::double precision, ${locality.lat}::double precision), 4326)::geography,
        ${address.isDefault},
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        address_text = EXCLUDED.address_text,
        landmark     = EXCLUDED.landmark,
        location     = EXCLUDED.location,
        updated_at   = NOW()
    `;
  }

  console.log(
    `customer ready: ${maskPhone(SEED_CUSTOMER_PHONE)} with ${ADDRESSES.length} addresses`,
  );
}
