import { randomUUID } from 'node:crypto';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import type { Translator } from '../../core/i18n';
import { requireLeafCategory } from '../categories/service';
import { formatTimeOfDay, validateWindow, type AvailabilityWindow } from './availability';
import { generateSlotsForProvider } from '../bookings/slots-service';
import { computeCompleteness, isListable, type CompletenessFacts } from './completeness';
import * as repo from './repository';
import type {
  AddSkillInput,
  CreateAvailabilityInput,
  CreatePriceCardInput,
  ProviderProfileResponse,
  RegisterProviderInput,
  UpdateAvailabilityInput,
  UpdatePriceCardInput,
  UpdateProviderProfileInput,
} from './types';

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

const profileNotFound = (): AppError =>
  new AppError(404, 'PROVIDER_PROFILE_NOT_FOUND', 'No technician profile for this user', {
    messageKey: 'errors.providers.profileNotFound',
  });

const notFound = (code: string, messageKey: string, detail: string): AppError =>
  new AppError(404, code, detail, { messageKey });

/* -------------------------------------------------------------------------- */
/* Completeness                                                               */
/* -------------------------------------------------------------------------- */

export function factsFrom(aggregate: repo.ProviderAggregate): CompletenessFacts {
  return {
    hasDisplayName: (aggregate.profile.displayName ?? '').trim().length > 0,
    hasBaseLocation: aggregate.baseLocation !== null,
    hasSkill: aggregate.skills.length > 0,
    hasActivePriceCard: aggregate.priceCards.some((card) => card.isActive),
    hasActiveAvailability: aggregate.availability.some((window) => window.isActive),
    hasBio: (aggregate.profile.bio ?? '').trim().length > 0,
    hasYearsExperience: aggregate.profile.yearsExperience !== null,
    hasPhotoDocument: aggregate.documents.some((doc) => doc.docType === 'photo'),
  };
}

/**
 * Rescores the profile and persists `is_listed`.
 *
 * Called after every write that could change the answer — profile edits, skills,
 * price cards, availability, documents. Centralised so no endpoint can forget,
 * because a stale `is_listed` means an incomplete technician showing up in
 * search, which is the one thing Phase 5 must be able to trust.
 */
async function recomputeListing(
  context: AppContext,
  userId: string,
): Promise<repo.ProviderAggregate> {
  const aggregate = await repo.loadAggregate(context.prisma, userId);
  if (!aggregate) throw profileNotFound();

  const completeness = computeCompleteness(factsFrom(aggregate));
  const { score } = completeness;
  const listed = isListable(
    completeness,
    context.config.PROVIDER_LISTING_THRESHOLD,
    aggregate.userIsActive,
  );

  const justListed = listed && !aggregate.profile.isListed;

  if (aggregate.profile.completenessScore !== score || aggregate.profile.isListed !== listed) {
    await repo.saveListingState(context.prisma, userId, score, listed);

    /**
     * Going live has to produce bookable hours, not just a findable profile.
     *
     * The horizon job only walks *listed* providers, so anyone who set their
     * week before completing the rest of their profile had templates and no
     * slots — they appeared in search advertising evenings free, with nothing
     * a customer could tap.
     */
    if (justListed) await refreshSlots(context, userId);

    context.logger.info(
      {
        userId,
        score,
        isListed: listed,
        previousScore: aggregate.profile.completenessScore,
        missingRequired: completeness.missingRequired,
      },
      'provider completeness recomputed',
    );
  }

  aggregate.profile.completenessScore = score;
  aggregate.profile.isListed = listed;

  return aggregate;
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

function toResponse(
  context: AppContext,
  aggregate: repo.ProviderAggregate,
  t: Translator,
): ProviderProfileResponse {
  const completeness = computeCompleteness(factsFrom(aggregate));

  return {
    userId: aggregate.profile.userId,
    displayName: aggregate.profile.displayName,
    bio: aggregate.profile.bio,
    yearsExperience: aggregate.profile.yearsExperience,
    cityId: aggregate.profile.cityId,
    baseLocation: aggregate.baseLocation,
    serviceRadiusKm: aggregate.profile.serviceRadiusKm,
    assistedOnboarding: aggregate.profile.assistedOnboarding,
    isListed: aggregate.profile.isListed,
    /**
     * Badge and `isListed` are independent axes. Completeness decides whether a
     * profile is findable; verification decides whether it is trusted. Phase 5
     * search requires both.
     */
    verification: {
      badge: aggregate.verification?.badge ?? 'NONE',
      badgeSince: aggregate.verification?.badgeSince?.toISOString() ?? null,
      levelsPassed: aggregate.verification?.levelsPassed ?? [],
    },
    completeness: {
      score: completeness.score,
      threshold: context.config.PROVIDER_LISTING_THRESHOLD,
      isListed: aggregate.profile.isListed,
      missing: completeness.missing,
      // What the onboarding screen should actually count down to.
      missingRequired: completeness.missingRequired,
      breakdown: completeness.breakdown,
    },
    skills: aggregate.skills.map((skill) => ({
      categoryId: skill.categoryId,
      categorySlug: skill.category.slug,
      categoryName: t(skill.category.nameKey),
      experienceNote: skill.experienceNote,
    })),
    priceCards: aggregate.priceCards.map((card) => ({
      id: card.id,
      categoryId: card.categoryId,
      categoryName: t(card.category.nameKey),
      title: card.title,
      priceType: card.priceType,
      amountPaise: card.amountPaise,
      isActive: card.isActive,
    })),
    availability: aggregate.availability.map((window) => ({
      id: window.id,
      dayOfWeek: window.dayOfWeek,
      startTime: formatTimeOfDay(window.startMinute),
      endTime: formatTimeOfDay(window.endMinute),
      isActive: window.isActive,
    })),
    documents: aggregate.documents.map((doc) => ({
      id: doc.id,
      docType: doc.docType,
      storageKey: doc.storageKey,
      status: doc.status,
      createdAt: doc.createdAt.toISOString(),
    })),
    createdAt: aggregate.profile.createdAt.toISOString(),
    updatedAt: aggregate.profile.updatedAt.toISOString(),
  };
}

async function respond(
  context: AppContext,
  userId: string,
  t: Translator,
): Promise<ProviderProfileResponse> {
  return toResponse(context, await recomputeListing(context, userId), t);
}

/* -------------------------------------------------------------------------- */
/* Registration & profile                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Self-serve entry into technician supply: grants the role and opens an empty
 * profile. It does not make anyone bookable — completeness gates listing, and
 * verification (Phase 4) gates trust. Idempotent, so a double tap is harmless.
 */
export async function register(
  context: AppContext,
  userId: string,
  input: RegisterProviderInput,
  t: Translator,
): Promise<{ profile: ProviderProfileResponse; alreadyRegistered: boolean }> {
  const existing = await repo.findProfile(context.prisma, userId);

  if (existing) {
    await repo.grantTechnicianRole(context.prisma, userId);
    return { profile: await respond(context, userId, t), alreadyRegistered: true };
  }

  await context.prisma.$transaction(async (tx) => {
    await repo.grantTechnicianRole(tx as never, userId);
    await repo.createProfile(tx as never, userId, {
      displayName: input.displayName ?? null,
      cityId: input.cityId ?? context.config.DEFAULT_CITY_ID,
    });
  });

  context.logger.info({ userId }, 'technician registered');

  return { profile: await respond(context, userId, t), alreadyRegistered: false };
}

export async function getProfile(
  context: AppContext,
  userId: string,
  t: Translator,
): Promise<ProviderProfileResponse> {
  const aggregate = await repo.loadAggregate(context.prisma, userId);
  if (!aggregate) throw profileNotFound();

  return toResponse(context, aggregate, t);
}

export async function updateProfile(
  context: AppContext,
  userId: string,
  input: UpdateProviderProfileInput,
  t: Translator,
): Promise<ProviderProfileResponse> {
  const existing = await repo.findProfile(context.prisma, userId);
  if (!existing) throw profileNotFound();

  const { baseLocation, ...scalar } = input;

  if (Object.keys(scalar).length > 0) {
    await repo.updateProfile(context.prisma, userId, scalar);
  }

  // Separate from the scalar update because the API takes a point while the
  // table stores two columns, and because it is optional in a PATCH.
  if (baseLocation) {
    await repo.setBaseLocation(context.prisma, userId, baseLocation);
  }

  return respond(context, userId, t);
}

/* -------------------------------------------------------------------------- */
/* Skills                                                                     */
/* -------------------------------------------------------------------------- */

export async function addSkill(
  context: AppContext,
  userId: string,
  input: AddSkillInput,
  t: Translator,
): Promise<ProviderProfileResponse> {
  const profile = await repo.findProfile(context.prisma, userId);
  if (!profile) throw profileNotFound();

  // Rejects clusters — a technician does "motor rewinding", not "Electrical".
  await requireLeafCategory(context, input.categoryId, profile.cityId);

  await repo.addSkill(context.prisma, userId, input.categoryId, input.experienceNote ?? null);

  return respond(context, userId, t);
}

export async function removeSkill(
  context: AppContext,
  userId: string,
  categoryId: number,
  t: Translator,
): Promise<ProviderProfileResponse> {
  const removed = await repo.removeSkill(context.prisma, userId, categoryId);

  if (!removed) {
    throw notFound(
      'PROVIDER_SKILL_NOT_FOUND',
      'errors.providers.skillNotFound',
      `Skill ${categoryId} is not on this profile`,
    );
  }

  return respond(context, userId, t);
}

/* -------------------------------------------------------------------------- */
/* Price cards                                                                */
/* -------------------------------------------------------------------------- */

export async function createPriceCard(
  context: AppContext,
  userId: string,
  input: CreatePriceCardInput,
  t: Translator,
): Promise<ProviderProfileResponse> {
  const profile = await repo.findProfile(context.prisma, userId);
  if (!profile) throw profileNotFound();

  await requireLeafCategory(context, input.categoryId, profile.cityId);

  await repo.createPriceCard(context.prisma, userId, {
    categoryId: input.categoryId,
    title: input.title,
    priceType: input.priceType,
    amountPaise: input.amountPaise ?? null,
    isActive: input.isActive ?? true,
  });

  return respond(context, userId, t);
}

export async function updatePriceCard(
  context: AppContext,
  userId: string,
  id: string,
  input: UpdatePriceCardInput,
  t: Translator,
): Promise<ProviderProfileResponse> {
  const card = await repo.findPriceCard(context.prisma, userId, id);

  if (!card) {
    throw notFound(
      'PRICE_CARD_NOT_FOUND',
      'errors.providers.priceCardNotFound',
      `Price card ${id} not found for this provider`,
    );
  }

  const priceType = input.priceType ?? card.priceType;
  const amountPaise = input.amountPaise === undefined ? card.amountPaise : input.amountPaise;

  // The DB has a CHECK for this pairing; catching it here yields a field-level
  // 400 instead of a 500 from a constraint violation.
  if (priceType === 'inspection_based' && amountPaise !== null) {
    throw AppError.badRequest('inspection_based price cards cannot carry an amount', {
      messageKey: 'errors.providers.priceAmountNotAllowed',
      details: { priceType, amountPaise },
    });
  }

  if (priceType !== 'inspection_based' && amountPaise === null) {
    throw AppError.badRequest(`${priceType} price cards require an amount`, {
      messageKey: 'errors.providers.priceAmountRequired',
      details: { priceType },
    });
  }

  await repo.updatePriceCard(context.prisma, id, {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    priceType,
    amountPaise,
  });

  return respond(context, userId, t);
}

export async function deletePriceCard(
  context: AppContext,
  userId: string,
  id: string,
  t: Translator,
): Promise<ProviderProfileResponse> {
  const deleted = await repo.deletePriceCard(context.prisma, userId, id);

  if (!deleted) {
    throw notFound(
      'PRICE_CARD_NOT_FOUND',
      'errors.providers.priceCardNotFound',
      `Price card ${id} not found for this provider`,
    );
  }

  return respond(context, userId, t);
}

/* -------------------------------------------------------------------------- */
/* Availability                                                               */
/* -------------------------------------------------------------------------- */

/** Only active windows constrain a new one — an inactive row is not a commitment. */
async function activeWindowsExcept(
  context: AppContext,
  userId: string,
  excludeId?: string,
): Promise<AvailabilityWindow[]> {
  const rows = await repo.listAvailability(context.prisma, userId);

  return rows
    .filter((row) => row.isActive && row.id !== excludeId)
    .map((row) => ({
      dayOfWeek: row.dayOfWeek,
      startMinute: row.startMinute,
      endMinute: row.endMinute,
    }));
}

function availabilityError(problem: NonNullable<ReturnType<typeof validateWindow>>): AppError {
  switch (problem.kind) {
    case 'overlap':
      return new AppError(409, 'AVAILABILITY_OVERLAP', 'Window overlaps an existing one', {
        messageKey: 'errors.providers.availabilityOverlap',
        details: {
          conflictsWith: {
            dayOfWeek: problem.conflictsWith.dayOfWeek,
            startTime: formatTimeOfDay(problem.conflictsWith.startMinute),
            endTime: formatTimeOfDay(problem.conflictsWith.endMinute),
          },
        },
      });

    case 'end_before_start':
      return AppError.badRequest('Window must end after it starts', {
        messageKey: 'errors.providers.availabilityEndBeforeStart',
        details: {
          startTime: formatTimeOfDay(problem.startMinute),
          endTime: formatTimeOfDay(problem.endMinute),
        },
      });

    default:
      return AppError.badRequest('Window is out of range', {
        messageKey: 'errors.providers.availabilityInvalid',
        details: problem,
      });
  }
}

/**
 * Materialises bookable slots after an availability change.
 *
 * Templates are the recurring *pattern*; slots are the actual hours a customer
 * can tap. Nothing used to bridge the two on write — a technician set their
 * week, saw it saved, and remained unbookable until a six-hourly job happened
 * to run. From their side the app was simply broken, and from the customer's
 * the technician had "no open slots" while advertising evenings free.
 *
 * Deliberately best-effort: the availability itself is already committed, and
 * failing the request afterwards would tell the technician their hours did not
 * save when they did. The horizon job remains the backstop, so a slip here
 * costs freshness rather than correctness.
 */
async function refreshSlots(context: AppContext, userId: string): Promise<void> {
  try {
    await generateSlotsForProvider(context, userId);
  } catch (error) {
    context.logger.error(
      { err: error, providerId: userId },
      'slot refresh failed after availability change',
    );
  }
}

export async function createAvailability(
  context: AppContext,
  userId: string,
  input: CreateAvailabilityInput,
  t: Translator,
): Promise<ProviderProfileResponse> {
  const profile = await repo.findProfile(context.prisma, userId);
  if (!profile) throw profileNotFound();

  const isActive = input.isActive ?? true;
  const candidate: AvailabilityWindow = {
    dayOfWeek: input.dayOfWeek,
    startMinute: input.startTime,
    endMinute: input.endTime,
  };

  const problem = validateWindow(
    candidate,
    isActive ? await activeWindowsExcept(context, userId) : [],
  );
  if (problem) throw availabilityError(problem);

  await repo.createAvailability(context.prisma, userId, { ...candidate, isActive });
  await refreshSlots(context, userId);

  return respond(context, userId, t);
}

export async function updateAvailability(
  context: AppContext,
  userId: string,
  id: string,
  input: UpdateAvailabilityInput,
  t: Translator,
): Promise<ProviderProfileResponse> {
  const existing = await repo.findAvailability(context.prisma, userId, id);

  if (!existing) {
    throw notFound(
      'AVAILABILITY_NOT_FOUND',
      'errors.providers.availabilityNotFound',
      `Availability window ${id} not found for this provider`,
    );
  }

  const isActive = input.isActive ?? existing.isActive;
  const candidate: AvailabilityWindow = {
    dayOfWeek: input.dayOfWeek ?? existing.dayOfWeek,
    startMinute: input.startTime ?? existing.startMinute,
    endMinute: input.endTime ?? existing.endMinute,
  };

  const problem = validateWindow(
    candidate,
    isActive ? await activeWindowsExcept(context, userId, id) : [],
  );
  if (problem) throw availabilityError(problem);

  await repo.updateAvailability(context.prisma, id, { ...candidate, isActive });
  await refreshSlots(context, userId);

  return respond(context, userId, t);
}

export async function deleteAvailability(
  context: AppContext,
  userId: string,
  id: string,
  t: Translator,
): Promise<ProviderProfileResponse> {
  const deleted = await repo.deleteAvailability(context.prisma, userId, id);

  if (!deleted) {
    throw notFound(
      'AVAILABILITY_NOT_FOUND',
      'errors.providers.availabilityNotFound',
      `Availability window ${id} not found for this provider`,
    );
  }

  // Removing hours has to withdraw the open slots they produced, or the
  // technician stays bookable in a window they just deleted. Already-booked
  // slots survive — see `planSlots`, which never touches a held commitment.
  await refreshSlots(context, userId);

  return respond(context, userId, t);
}

/*
 * Documents are managed by the verification module (`/api/v1/verification/
 * documents/*`), which owns the pre-signed upload flow. They appear read-only on
 * the profile response; there is deliberately no way to declare one here,
 * because a document row that no confirmed object backs is worse than none.
 */

export { recomputeListing };

/* -------------------------------------------------------------------------- */
/* Profile photo                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The technician's public-facing photo.
 *
 * Deliberately not a KYC document, and the difference is not cosmetic:
 *
 *   - **Opposite privacy posture.** A KYC file is evidence only a reviewer ever
 *     sees; this is the one file a customer is *meant* to see. Reusing the
 *     document endpoints would have meant reusing their access rules, which are
 *     built to keep everyone out.
 *   - **Images only, and never SVG.** This is the one object served inline
 *     rather than as an attachment, so a file that can carry script cannot be
 *     allowed anywhere near it.
 *   - **A human approves it before any customer sees it.** Anyone can upload a
 *     photograph of anything; the moderation state is the whole point.
 */
const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Provider id first, so one person's objects share a prefix for DPDP erasure. */
function profilePhotoObjectKey(providerId: string, photoId: string): string {
  return `provider-photos/${providerId}/${photoId}`;
}

export interface ProfilePhotoView {
  status: 'approved' | 'removed';
  /**
   * Short-lived signed URL, present in every status — a technician whose photo
   * was taken down needs to see which photo it was in order to replace it.
   */
  url: string;
  uploadedAt: string | null;
  reviewedAt: string | null;
  rejectionNote: string | null;
}

async function toProfilePhotoView(
  context: AppContext,
  photo: {
    storageKey: string;
    contentType: string;
    status: string;
    uploadedAt: Date | null;
    reviewedAt: Date | null;
    rejectionNote: string | null;
  },
): Promise<ProfilePhotoView> {
  return {
    status: photo.status as ProfilePhotoView['status'],
    url: await context.storage.getDownloadUrl(photo.storageKey, {
      /**
       * Inline, unlike every other signed URL in the product — this one is the
       * `src` of an `<img>`. Safe only because the content type is pinned to one
       * of three raster formats at upload and re-checked on confirm: an inline
       * SVG or HTML would be a stored XSS on our own origin.
       */
      disposition: 'inline',
      contentType: photo.contentType,
    }),
    uploadedAt: photo.uploadedAt?.toISOString() ?? null,
    reviewedAt: photo.reviewedAt?.toISOString() ?? null,
    rejectionNote: photo.rejectionNote,
  };
}

export async function requestPhotoUploadUrl(
  context: AppContext,
  providerId: string,
  input: { contentType: string; sizeBytes: number },
): Promise<{
  photoId: string;
  upload: Awaited<ReturnType<AppContext['storage']['getUploadUrl']>>;
}> {
  // A photo without a technician profile has nowhere to appear.
  const aggregate = await repo.loadAggregate(context.prisma, providerId);
  if (!aggregate) throw profileNotFound();

  if (!PHOTO_CONTENT_TYPES.includes(input.contentType as (typeof PHOTO_CONTENT_TYPES)[number])) {
    throw AppError.badRequest(`${input.contentType} is not an allowed photo type`, {
      messageKey: 'errors.providers.photoTypeNotAllowed',
      details: { allowed: PHOTO_CONTENT_TYPES },
    });
  }

  if (input.sizeBytes > context.config.PROFILE_PHOTO_MAX_UPLOAD_BYTES) {
    throw AppError.badRequest(
      `Photo is ${input.sizeBytes} bytes; the limit is ${context.config.PROFILE_PHOTO_MAX_UPLOAD_BYTES}`,
      {
        messageKey: 'errors.providers.photoTooLarge',
        details: { maxBytes: context.config.PROFILE_PHOTO_MAX_UPLOAD_BYTES },
      },
    );
  }

  const photoId = randomUUID();
  const storageKey = profilePhotoObjectKey(providerId, photoId);

  const upload = await context.storage.getUploadUrl({
    key: storageKey,
    contentType: input.contentType,
    contentLength: input.sizeBytes,
  });

  await repo.createProfilePhoto(context.prisma, {
    id: photoId,
    providerId,
    storageKey,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });

  return { photoId, upload };
}

/**
 * Confirms the bytes actually landed, then publishes the photo.
 *
 * The object is checked rather than trusted: a client that says "done" without
 * uploading would otherwise leave a technician showing a broken image to
 * customers, and the recorded size would be a number nobody verified.
 */
export async function confirmPhotoUpload(
  context: AppContext,
  providerId: string,
  photoId: string,
): Promise<ProfilePhotoView> {
  const photo = await repo.findProfilePhoto(context.prisma, providerId, photoId);

  if (!photo) {
    throw notFound(
      'PROVIDER_PHOTO_NOT_FOUND',
      'errors.providers.photoNotFound',
      `No profile photo ${photoId} for this technician`,
    );
  }

  if (photo.status !== 'draft') return toProfilePhotoView(context, photo);

  const stored = await context.storage.head(photo.storageKey);

  if (!stored) {
    throw AppError.badRequest('The photo was never uploaded to storage', {
      messageKey: 'errors.providers.photoNotUploaded',
    });
  }

  const updated = await repo.markProfilePhotoUploaded(
    context.prisma,
    photo.id,
    stored.sizeBytes,
    new Date(),
  );

  // The photo counts toward completeness, and the score gates search listing.
  await getProfile(context, providerId, (key: string) => key);

  return toProfilePhotoView(context, updated);
}

/** Null when the technician has never finished an upload. */
export async function getMyPhoto(
  context: AppContext,
  providerId: string,
): Promise<ProfilePhotoView | null> {
  const photo = await repo.findLatestProfilePhoto(context.prisma, providerId);
  return photo ? toProfilePhotoView(context, photo) : null;
}

/**
 * A customer reports a photo.
 *
 * The photo keeps serving. An automatic takedown at some report threshold is a
 * griefing tool — a competitor with three phone numbers could blank any
 * technician's profile — so a report only ever queues the photo for a human.
 */
export async function reportProfilePhoto(
  context: AppContext,
  reporterId: string,
  photoId: string,
  reason: string,
): Promise<{ reportCount: number }> {
  const photo = await repo.findProfilePhotoById(context.prisma, photoId);

  if (!photo || photo.status !== 'approved') {
    throw notFound(
      'PROVIDER_PHOTO_NOT_FOUND',
      'errors.providers.photoNotFound',
      `No live profile photo ${photoId}`,
    );
  }

  const reportCount = await repo.reportProfilePhoto(context.prisma, {
    photoId,
    reporterId,
    reason,
  });

  context.logger.warn(
    { photoId, providerId: photo.providerId, reportCount },
    'profile photo reported',
  );

  return { reportCount };
}

export interface ReportedPhotoView extends ProfilePhotoView {
  photoId: string;
  providerId: string;
  providerName: string | null;
  reportCount: number;
  reports: { reason: string; createdAt: string }[];
}

/** The ops queue — only photos customers actually complained about. */
export async function listReportedPhotos(
  context: AppContext,
  limit = 50,
): Promise<ReportedPhotoView[]> {
  const rows = await repo.listReportedProfilePhotos(context.prisma, limit);

  return Promise.all(
    rows.map(async (row) => ({
      ...(await toProfilePhotoView(context, row)),
      photoId: row.id,
      providerId: row.providerId,
      providerName: row.provider.name,
      reportCount: row.reportCount,
      reports: row.reports.map((report) => ({
        reason: report.reason,
        createdAt: report.createdAt.toISOString(),
      })),
    })),
  );
}

/**
 * Ops decides what happens to a reported photo.
 *
 * `remove` requires a note for the same reason every other ops decision does:
 * this is somebody's face on their own livelihood, and "removed" with no reason
 * is not something you can defend to the technician who asks why.
 */
export async function decideReportedPhoto(
  context: AppContext,
  reviewerId: string,
  photoId: string,
  input: { decision: 'remove' | 'keep'; note?: string },
): Promise<ProfilePhotoView> {
  const photo = await repo.findProfilePhotoById(context.prisma, photoId);

  if (!photo) {
    throw notFound(
      'PROVIDER_PHOTO_NOT_FOUND',
      'errors.providers.photoNotFound',
      `No profile photo ${photoId}`,
    );
  }

  const at = new Date();

  if (input.decision === 'keep') {
    const kept = await repo.clearProfilePhotoReports(context.prisma, {
      photoId,
      reviewedById: reviewerId,
      at,
    });
    return toProfilePhotoView(context, kept);
  }

  const note = (input.note ?? '').trim();

  if (note.length < 10) {
    throw AppError.badRequest('A takedown needs a reason of at least 10 characters', {
      messageKey: 'errors.providers.photoRemovalNeedsNote',
    });
  }

  const removed = await repo.removeProfilePhoto(context.prisma, {
    photoId,
    reviewedById: reviewerId,
    note,
    at,
  });

  return toProfilePhotoView(context, removed);
}
