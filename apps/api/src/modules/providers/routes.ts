import { Router, type Request, type RequestHandler } from 'express';
import { getContext } from '../../core/context';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { requireRoles } from '../../core/middleware/require-roles';
import * as service from './service';
import {
  addSkillSchema,
  categoryIdParamSchema,
  createAvailabilitySchema,
  createPriceCardSchema,
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
