import { Router, type Request, type RequestHandler } from 'express';
import { getContext } from '../../core/context';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { requireRoles } from '../../core/middleware/require-roles';
import { AUDIT_ACTIONS, audited, auditActor } from '../../core/audit';
import { enforceSearchRateLimit } from '../search/service';
import { getPublicProfile } from './public-profile';
import * as service from './service';
import {
  addSkillSchema,
  categoryIdParamSchema,
  createAvailabilitySchema,
  createPriceCardSchema,
  decidePhotoReportSchema,
  photoIdParamSchema,
  providerIdParamSchema,
  reportPhotoSchema,
  requestPhotoUploadUrlSchema,
  registerProviderSchema,
  updateAvailabilitySchema,
  updatePriceCardSchema,
  updateProviderProfileSchema,
  uuidParamSchema,
} from './types';

export const router = Router();

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/**
 * POST /api/v1/providers/me/register
 *
 * Open to any authenticated user, not just technicians — this is how a customer
 * becomes one. Everything below it requires the role this grants.
 */
router.post(
  '/me/register',
  authenticate,
  handle(async (req, res) => {
    const input = registerProviderSchema.parse(req.body);
    const result = await service.register(getContext(req), getAuthUser(req).id, input, req.t);

    res.status(result.alreadyRegistered ? 200 : 201).json({
      profile: result.profile,
      alreadyRegistered: result.alreadyRegistered,
      message: req.t('providers.registered'),
    });
  }),
);

/**
 * `GET /api/v1/providers/:providerId` — the public profile.
 *
 * Unauthenticated and rate-limited on the same per-IP budget as search and
 * public reviews, because it is the same traffic: a scraper walking every
 * technician's page is exactly what that limit exists to stop.
 *
 * Added in Phase 12. Until then a customer could only ever see a technician by
 * searching for one, which broke the moment there was a URL to forward — and a
 * link forwarded on WhatsApp is the pilot's entire distribution story.
 *
 * Mounted **before** the `requireRoles('technician')` line below, because that
 * line applies to every route declared after it and this one is public.
 *
 * The param carries a **uuid pattern in the path itself**, not just in the Zod
 * schema. Express matches in declaration order, so a bare `/:providerId` here
 * would capture `/providers/me` and reject it as a malformed id — silently
 * breaking every technician's own profile. Validating after the match is too
 * late; the pattern has to stop the match happening.
 */
router.get(
  '/:providerId([0-9a-fA-F-]{36})',
  (req, _res, next) => {
    enforceSearchRateLimit(getContext(req), req.ip ?? 'unknown').then(() => next(), next);
  },
  handle(async (req, res) => {
    const { providerId } = providerIdParamSchema.parse(req.params);
    const profile = await getPublicProfile(getContext(req), providerId);

    res.status(200).json({ profile });
  }),
);

/** Everything past this point is a technician managing their own profile. */
router.use(authenticate, requireRoles('technician'));

/* ---- profile ---- */

router.get(
  '/me',
  handle(async (req, res) => {
    const profile = await service.getProfile(getContext(req), getAuthUser(req).id, req.t);
    res.status(200).json({ profile });
  }),
);

router.patch(
  '/me',
  handle(async (req, res) => {
    const input = updateProviderProfileSchema.parse(req.body);
    const profile = await service.updateProfile(getContext(req), getAuthUser(req).id, input, req.t);

    res.status(200).json({ profile, message: req.t('providers.profileUpdated') });
  }),
);

/* ---- skills ---- */

router.post(
  '/me/skills',
  handle(async (req, res) => {
    const input = addSkillSchema.parse(req.body);
    const profile = await service.addSkill(getContext(req), getAuthUser(req).id, input, req.t);

    res.status(201).json({ profile, message: req.t('providers.skillAdded') });
  }),
);

router.delete(
  '/me/skills/:categoryId',
  handle(async (req, res) => {
    const { categoryId } = categoryIdParamSchema.parse(req.params);
    const profile = await service.removeSkill(
      getContext(req),
      getAuthUser(req).id,
      categoryId,
      req.t,
    );

    res.status(200).json({ profile, message: req.t('providers.skillRemoved') });
  }),
);

/* ---- profile photo ---- */

/**
 * The public-facing photo lives here rather than under /verification/documents
 * on purpose: a KYC document is private evidence, this is the one file a
 * customer is meant to see. Same three-step signed-URL flow, opposite privacy
 * posture.
 *
 * It publishes on confirm. A technician's own face is their property, and
 * holding it in a queue taxes the honest majority to catch a rare abuser —
 * so moderation runs the other way round: customers report, ops decides, and
 * only a human takes a photo down (see `photoReportRouter` below).
 */
router.post(
  '/me/photo/upload-url',
  handle(async (req, res) => {
    const input = requestPhotoUploadUrlSchema.parse(req.body);
    const result = await service.requestPhotoUploadUrl(getContext(req), getAuthUser(req).id, input);

    res.status(201).json({
      photoId: result.photoId,
      upload: result.upload,
      message: req.t('providers.photoUploadUrlIssued'),
    });
  }),
);

router.post(
  '/me/photo/:photoId/confirm',
  handle(async (req, res) => {
    const { photoId } = photoIdParamSchema.parse(req.params);
    const photo = await service.confirmPhotoUpload(getContext(req), getAuthUser(req).id, photoId);

    res.status(200).json({ photo, message: req.t('providers.photoUploaded') });
  }),
);

router.get(
  '/me/photo',
  handle(async (req, res) => {
    const photo = await service.getMyPhoto(getContext(req), getAuthUser(req).id);
    res.status(200).json({ photo });
  }),
);

/* ---- price cards ---- */

router.post(
  '/me/price-cards',
  handle(async (req, res) => {
    const input = createPriceCardSchema.parse(req.body);
    const profile = await service.createPriceCard(
      getContext(req),
      getAuthUser(req).id,
      input,
      req.t,
    );

    res.status(201).json({ profile, message: req.t('providers.priceCardCreated') });
  }),
);

router.patch(
  '/me/price-cards/:id',
  handle(async (req, res) => {
    const { id } = uuidParamSchema.parse(req.params);
    const input = updatePriceCardSchema.parse(req.body);
    const profile = await service.updatePriceCard(
      getContext(req),
      getAuthUser(req).id,
      id,
      input,
      req.t,
    );

    res.status(200).json({ profile, message: req.t('providers.priceCardUpdated') });
  }),
);

router.delete(
  '/me/price-cards/:id',
  handle(async (req, res) => {
    const { id } = uuidParamSchema.parse(req.params);
    const profile = await service.deletePriceCard(getContext(req), getAuthUser(req).id, id, req.t);

    res.status(200).json({ profile, message: req.t('providers.priceCardDeleted') });
  }),
);

/* ---- availability ---- */

router.post(
  '/me/availability',
  handle(async (req, res) => {
    const input = createAvailabilitySchema.parse(req.body);
    const profile = await service.createAvailability(
      getContext(req),
      getAuthUser(req).id,
      input,
      req.t,
    );

    res.status(201).json({ profile, message: req.t('providers.availabilityCreated') });
  }),
);

router.patch(
  '/me/availability/:id',
  handle(async (req, res) => {
    const { id } = uuidParamSchema.parse(req.params);
    const input = updateAvailabilitySchema.parse(req.body);
    const profile = await service.updateAvailability(
      getContext(req),
      getAuthUser(req).id,
      id,
      input,
      req.t,
    );

    res.status(200).json({ profile, message: req.t('providers.availabilityUpdated') });
  }),
);

router.delete(
  '/me/availability/:id',
  handle(async (req, res) => {
    const { id } = uuidParamSchema.parse(req.params);
    const profile = await service.deleteAvailability(
      getContext(req),
      getAuthUser(req).id,
      id,
      req.t,
    );

    res.status(200).json({ profile, message: req.t('providers.availabilityDeleted') });
  }),
);

/*
 * Documents are uploaded and confirmed through the verification module at
 * `/api/v1/verification/documents/*`, which holds the pre-signed URL flow. They
 * are shown read-only on the profile response above.
 */

/* -------------------------------------------------------------------------- */
/* Photo reporting — customer-facing                                          */
/* -------------------------------------------------------------------------- */

/**
 * Photos publish the moment a technician confirms the upload, so moderation is
 * reactive: this is how a customer says "that photo is not this person" or
 * "that is obscene". The report queues it for a human; it never takes a photo
 * down on its own, because an automatic threshold is a griefing tool.
 */
export const photoReportRouter = Router();

photoReportRouter.use(authenticate);

photoReportRouter.post(
  '/:photoId/report',
  handle(async (req, res) => {
    const { photoId } = photoIdParamSchema.parse(req.params);
    const input = reportPhotoSchema.parse(req.body);

    await service.reportProfilePhoto(getContext(req), getAuthUser(req).id, photoId, input.reason);

    // The count is deliberately not returned — it is ops' business, and telling
    // a reporter how close they are to a takedown invites brigading.
    res.status(202).json({ message: req.t('providers.photoReported') });
  }),
);

/* -------------------------------------------------------------------------- */
/* Photo moderation — ops-facing                                              */
/* -------------------------------------------------------------------------- */

export const photoOpsRouter = Router();

photoOpsRouter.use(authenticate, requireRoles('ops', 'admin'));

photoOpsRouter.get(
  '/reported',
  handle(async (req, res) => {
    const photos = await service.listReportedPhotos(getContext(req));
    res.status(200).json({ photos });
  }),
);

photoOpsRouter.post(
  '/:photoId/decide',
  handle(async (req, res) => {
    const { photoId } = photoIdParamSchema.parse(req.params);
    const input = decidePhotoReportSchema.parse(req.body);

    const photo = await service.decideReportedPhoto(
      getContext(req),
      getAuthUser(req).id,
      photoId,
      input,
    );

    await audited(
      getContext(req).prisma,
      auditActor(req),
      {
        action: AUDIT_ACTIONS.providerPhotoDecide,
        targetType: 'provider_profile_photo',
        targetId: photoId,
        /** The decision and the reason — what somebody will read if the technician appeals. */
        payload: { decision: input.decision, note: input.note ?? null },
      },
      async () => photo,
    );

    res.status(200).json({ photo, message: req.t('providers.photoDecisionRecorded') });
  }),
);
