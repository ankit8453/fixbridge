// All database access for the providers domain. Nothing above this file
// contains a query.
import type { Prisma } from '@prisma/client';
import type {
  Category,
  PrismaClient,
  ProviderAvailabilityTemplate,
  ProviderDocument,
  ProviderPriceCard,
  ProviderProfile,
  ProviderProfilePhoto,
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
  /**
   * Null until the technician sets it. `baseLat`/`baseLng` are on the profile
   * row as well; this is the pair-checked form callers actually want, so they
   * never have to reason about one column being set without the other.
   */
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

/**
 * The two columns as one point, or null.
 *
 * A half-set base location is meaningless, so anything short of both columns
 * being present is reported as "no location" rather than a point with a hole
 * in it.
 */
export function toBaseLocation(profile: {
  baseLat: number | null;
  baseLng: number | null;
}): GeoPoint | null {
  if (profile.baseLat === null || profile.baseLng === null) return null;
  return { lat: profile.baseLat, lng: profile.baseLng };
}

export async function findBaseLocation(
  prisma: PrismaClient,
  userId: string,
): Promise<GeoPoint | null> {
  const profile = await prisma.providerProfile.findUnique({
    where: { userId },
    select: { baseLat: true, baseLng: true },
  });

  return profile ? toBaseLocation(profile) : null;
}

export async function setBaseLocation(
  prisma: PrismaClient,
  userId: string,
  location: GeoPoint,
): Promise<void> {
  await prisma.providerProfile.update({
    where: { userId },
    data: { baseLat: location.lat, baseLng: location.lng },
  });
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
    baseLocation: toBaseLocation(rest),
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

/* -------------------------------------------------------------------------- */
/* Profile photo                                                              */
/* -------------------------------------------------------------------------- */

export function createProfilePhoto(
  prisma: PrismaClient,
  input: {
    id: string;
    providerId: string;
    storageKey: string;
    contentType: string;
    sizeBytes: number;
  },
): Promise<ProviderProfilePhoto> {
  return prisma.providerProfilePhoto.create({ data: input });
}

export function findProfilePhoto(
  prisma: PrismaClient,
  providerId: string,
  photoId: string,
): Promise<ProviderProfilePhoto | null> {
  return prisma.providerProfilePhoto.findFirst({ where: { id: photoId, providerId } });
}

/**
 * The row the technician is shown: the newest one that is not still a draft.
 *
 * Drafts are upload URLs nobody finished using, and showing one would tell a
 * technician they have a photo when storage holds nothing.
 */
export function findLatestProfilePhoto(
  prisma: PrismaClient,
  providerId: string,
): Promise<ProviderProfilePhoto | null> {
  return prisma.providerProfilePhoto.findFirst({
    where: { providerId, status: { not: 'draft' } },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * The row a *customer* may see: the newest approved one.
 *
 * Deliberately separate from `findLatestProfilePhoto` — a replacement sitting in
 * review must not blank out the picture customers already trust, so the
 * previously approved photo keeps serving until the new one passes.
 */
export function findApprovedProfilePhoto(
  prisma: PrismaClient,
  providerId: string,
): Promise<ProviderProfilePhoto | null> {
  return prisma.providerProfilePhoto.findFirst({
    where: { providerId, status: 'approved' },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Marks the bytes as landed and publishes the photo.
 *
 * Published on confirm, not after a review: a technician's own face is their
 * property, and a queue that holds it for days is a cost paid by the honest
 * majority to catch a rare abuser. Abuse is handled the other way round —
 * customers report, a human decides, `removeProfilePhoto` takes it down.
 */
export function markProfilePhotoUploaded(
  prisma: PrismaClient,
  photoId: string,
  sizeBytes: number,
  at: Date,
): Promise<ProviderProfilePhoto> {
  return prisma.providerProfilePhoto.update({
    where: { id: photoId },
    data: { status: 'approved', sizeBytes, uploadedAt: at },
  });
}

/**
 * Records a report and returns the photo's new count.
 *
 * The unique `(photoId, reporterId)` pair means a repeat report from the same
 * person is a no-op rather than an error — the customer gets the same "thanks,
 * we will look" either way, and the count stays honest.
 */
export async function reportProfilePhoto(
  prisma: PrismaClient,
  input: { photoId: string; reporterId: string; reason: string },
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.providerProfilePhotoReport.findUnique({
      where: { photoId_reporterId: { photoId: input.photoId, reporterId: input.reporterId } },
    });

    if (existing) {
      const photo = await tx.providerProfilePhoto.findUniqueOrThrow({
        where: { id: input.photoId },
        select: { reportCount: true },
      });
      return photo.reportCount;
    }

    await tx.providerProfilePhotoReport.create({ data: input });

    const photo = await tx.providerProfilePhoto.update({
      where: { id: input.photoId },
      data: { reportCount: { increment: 1 } },
      select: { reportCount: true },
    });

    return photo.reportCount;
  });
}

export function findProfilePhotoById(
  prisma: PrismaClient,
  photoId: string,
): Promise<ProviderProfilePhoto | null> {
  return prisma.providerProfilePhoto.findUnique({ where: { id: photoId } });
}

/** The ops queue: photos customers reported that are still serving. */
export async function listReportedProfilePhotos(
  prisma: PrismaClient,
  limit: number,
): Promise<
  (ProviderProfilePhoto & {
    provider: { id: string; name: string | null };
    reports: { reason: string; createdAt: Date }[];
  })[]
> {
  return prisma.providerProfilePhoto.findMany({
    where: { status: 'approved', reportCount: { gt: 0 } },
    orderBy: [{ reportCount: 'desc' }, { uploadedAt: 'asc' }],
    take: limit,
    include: {
      provider: { select: { id: true, name: true } },
      reports: { orderBy: { createdAt: 'desc' }, select: { reason: true, createdAt: true } },
    },
  });
}

/** Takes a photo down. Only ever called by a human with a reason. */
export function removeProfilePhoto(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: { photoId: string; reviewedById: string; note: string; at: Date },
): Promise<ProviderProfilePhoto> {
  return prisma.providerProfilePhoto.update({
    where: { id: input.photoId },
    data: {
      status: 'removed',
      reviewedById: input.reviewedById,
      rejectionNote: input.note,
      reviewedAt: input.at,
    },
  });
}

/** Dismisses the reports on a photo, leaving it published. */
export function clearProfilePhotoReports(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: { photoId: string; reviewedById: string; at: Date },
): Promise<ProviderProfilePhoto> {
  return prisma.providerProfilePhoto.update({
    where: { id: input.photoId },
    data: { reportCount: 0, reviewedById: input.reviewedById, reviewedAt: input.at },
  });
}
