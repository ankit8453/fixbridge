// All Prisma and raw SQL for the providers domain. `base_location` is a
// geography column, so it is read and written by raw statements here and
// nowhere else — see docs/geo-notes.md.
import type { Prisma } from '@prisma/client';
import type {
  Category,
  PrismaClient,
  ProviderAvailabilityTemplate,
  ProviderDocument,
  ProviderPriceCard,
  ProviderProfile,
  ProviderSkill,
  ProviderVerificationSummary,
  PriceType,
} from '@prisma/client';
import type { GeoPoint } from '../../core/geo';

export type ProviderSkillWithCategory = ProviderSkill & { category: Category };
export type ProviderPriceCardWithCategory = ProviderPriceCard & { category: Category };

/** Everything needed to render a profile and score its completeness, in one read. */
export interface ProviderAggregate {
  profile: ProviderProfile;
  /** Projected out of the geography column; null until the technician sets it. */
  baseLocation: GeoPoint | null;
  skills: ProviderSkillWithCategory[];
  priceCards: ProviderPriceCardWithCategory[];
  availability: ProviderAvailabilityTemplate[];
  documents: ProviderDocument[];
  userIsActive: boolean;
  /** Null until the technician starts verification. Badge is an independent axis. */
  verification: ProviderVerificationSummary | null;
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

export function findProfile(prisma: PrismaClient, userId: string): Promise<ProviderProfile | null> {
  return prisma.providerProfile.findUnique({ where: { userId } });
}

/** Prisma cannot select `base_location`, so the point comes back on its own. */
export async function findBaseLocation(
  prisma: PrismaClient,
  userId: string,
): Promise<GeoPoint | null> {
  const rows = await prisma.$queryRaw<{ lat: number | null; lng: number | null }[]>`
    SELECT
      ST_Y(base_location::geometry) AS lat,
      ST_X(base_location::geometry) AS lng
    FROM provider_profiles
    WHERE user_id = ${userId}::uuid
  `;

  const row = rows[0];
  if (!row || row.lat === null || row.lng === null) return null;

  return { lat: row.lat, lng: row.lng };
}

export async function setBaseLocation(
  prisma: PrismaClient,
  userId: string,
  location: GeoPoint,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE provider_profiles
    SET base_location = ST_SetSRID(
          ST_MakePoint(${location.lng}::double precision, ${location.lat}::double precision),
          4326
        )::geography,
        updated_at = NOW()
    WHERE user_id = ${userId}::uuid
  `;
}

export function createProfile(
  prisma: PrismaClient,
  userId: string,
  data: { displayName: string | null; cityId: number; assistedOnboarding?: boolean },
): Promise<ProviderProfile> {
  return prisma.providerProfile.create({
    data: {
      userId,
      displayName: data.displayName,
      cityId: data.cityId,
      assistedOnboarding: data.assistedOnboarding ?? false,
    },
  });
}

export function updateProfile(
  prisma: PrismaClient,
  userId: string,
  data: Prisma.ProviderProfileUpdateInput,
): Promise<ProviderProfile> {
  return prisma.providerProfile.update({ where: { userId }, data });
}

/** One round trip for the whole aggregate — profile reads happen on every write. */
export async function loadAggregate(
  prisma: PrismaClient,
  userId: string,
): Promise<ProviderAggregate | null> {
  const profile = await prisma.providerProfile.findUnique({
    where: { userId },
    include: {
      skills: { include: { category: true }, orderBy: { categoryId: 'asc' } },
      priceCards: { include: { category: true }, orderBy: { createdAt: 'asc' } },
      availability: { orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] },
      documents: { orderBy: { createdAt: 'asc' } },
      user: { select: { status: true } },
      verification: true,
    },
  });

  if (!profile) return null;

  const { skills, priceCards, availability, documents, user, verification, ...rest } = profile;

  return {
    profile: rest as ProviderProfile,
    baseLocation: await findBaseLocation(prisma, userId),
    skills,
    priceCards,
    availability,
    documents,
    userIsActive: user.status === 'active',
    verification,
  };
}

export async function saveListingState(
  prisma: PrismaClient,
  userId: string,
  score: number,
  isListed: boolean,
): Promise<void> {
  await prisma.providerProfile.update({
    where: { userId },
    data: { completenessScore: score, isListed },
  });
}

/* -------------------------------------------------------------------------- */
/* Skills                                                                     */
/* -------------------------------------------------------------------------- */

export function addSkill(
  prisma: PrismaClient,
  providerId: string,
  categoryId: number,
  experienceNote: string | null,
): Promise<ProviderSkill> {
  return prisma.providerSkill.upsert({
    where: { providerId_categoryId: { providerId, categoryId } },
    update: { experienceNote },
    create: { providerId, categoryId, experienceNote },
  });
}

export async function removeSkill(
  prisma: PrismaClient,
  providerId: string,
  categoryId: number,
): Promise<boolean> {
  const result = await prisma.providerSkill.deleteMany({ where: { providerId, categoryId } });
  return result.count > 0;
}

/* -------------------------------------------------------------------------- */
/* Price cards                                                                */
/* -------------------------------------------------------------------------- */

export function createPriceCard(
  prisma: PrismaClient,
  providerId: string,
  data: {
    categoryId: number;
    title: string;
    priceType: PriceType;
    amountPaise: number | null;
    isActive: boolean;
  },
): Promise<ProviderPriceCard> {
  return prisma.providerPriceCard.create({ data: { providerId, ...data } });
}

export function findPriceCard(
  prisma: PrismaClient,
  providerId: string,
  id: string,
): Promise<ProviderPriceCard | null> {
  return prisma.providerPriceCard.findFirst({ where: { id, providerId } });
}

export function updatePriceCard(
  prisma: PrismaClient,
  id: string,
  data: Prisma.ProviderPriceCardUpdateInput,
): Promise<ProviderPriceCard> {
  return prisma.providerPriceCard.update({ where: { id }, data });
}

export async function deletePriceCard(
  prisma: PrismaClient,
  providerId: string,
  id: string,
): Promise<boolean> {
  const result = await prisma.providerPriceCard.deleteMany({ where: { id, providerId } });
  return result.count > 0;
}

/* -------------------------------------------------------------------------- */
/* Availability                                                               */
/* -------------------------------------------------------------------------- */

export function listAvailability(
  prisma: PrismaClient,
  providerId: string,
): Promise<ProviderAvailabilityTemplate[]> {
  return prisma.providerAvailabilityTemplate.findMany({
    where: { providerId },
    orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
  });
}

export function createAvailability(
  prisma: PrismaClient,
  providerId: string,
  data: { dayOfWeek: number; startMinute: number; endMinute: number; isActive: boolean },
): Promise<ProviderAvailabilityTemplate> {
  return prisma.providerAvailabilityTemplate.create({ data: { providerId, ...data } });
}

export function findAvailability(
  prisma: PrismaClient,
  providerId: string,
  id: string,
): Promise<ProviderAvailabilityTemplate | null> {
  return prisma.providerAvailabilityTemplate.findFirst({ where: { id, providerId } });
}

export function updateAvailability(
  prisma: PrismaClient,
  id: string,
  data: Prisma.ProviderAvailabilityTemplateUpdateInput,
): Promise<ProviderAvailabilityTemplate> {
  return prisma.providerAvailabilityTemplate.update({ where: { id }, data });
}

export async function deleteAvailability(
  prisma: PrismaClient,
  providerId: string,
  id: string,
): Promise<boolean> {
  const result = await prisma.providerAvailabilityTemplate.deleteMany({
    where: { id, providerId },
  });
  return result.count > 0;
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Read-only here. Documents are created and confirmed by the verification
 * module, which owns the upload flow — a row can only be trusted once the
 * object behind it is known to exist, and only that flow can establish it.
 */
export function listDocuments(
  prisma: PrismaClient,
  providerId: string,
): Promise<ProviderDocument[]> {
  return prisma.providerDocument.findMany({
    where: { providerId },
    orderBy: { createdAt: 'asc' },
  });
}

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

export async function grantTechnicianRole(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.userRole.upsert({
    where: { userId_role: { userId, role: 'technician' } },
    update: {},
    create: { userId, role: 'technician' },
  });
}
