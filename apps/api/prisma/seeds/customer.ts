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

    // Plain columns now, so this is an ordinary upsert. It was raw SQL only
    // because `location` used to be a PostGIS geography Prisma could not write.
    // The id is deterministic, so re-running updates rather than duplicating.
    await prisma.address.upsert({
      where: { id },
      update: {
        addressText: address.addressText,
        landmark: address.landmark,
        lat: locality.lat,
        lng: locality.lng,
      },
      create: {
        id,
        userId: user.id,
        label: address.label,
        labelText: null,
        addressText: address.addressText,
        landmark: address.landmark,
        cityId,
        lat: locality.lat,
        lng: locality.lng,
        isDefault: address.isDefault,
      },
    });
  }

  console.log(
    `customer ready: ${maskPhone(SEED_CUSTOMER_PHONE)} with ${ADDRESSES.length} addresses`,
  );
}
