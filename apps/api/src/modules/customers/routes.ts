import { Router, type Request, type RequestHandler } from 'express';
import { getContext } from '../../core/context';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { requireRoles } from '../../core/middleware/require-roles';
import * as service from './service';
import {
  addressIdParamSchema,
  createAddressSchema,
  updateAddressSchema,
  updateCustomerProfileSchema,
} from './types';

export const router = Router();

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/**
 * Everything here is `/me`-scoped and every query is filtered by the caller's
 * own id, so there is no object-level authorisation to forget: another user's
 * address simply does not exist as far as these routes are concerned.
 */
router.use(authenticate, requireRoles('customer'));

/* ---- profile ---- */

router.get(
  '/me',
  handle(async (req, res) => {
    const profile = await service.getProfile(getContext(req), getAuthUser(req).id);
    res.status(200).json({ profile });
  }),
);

router.patch(
  '/me',
  handle(async (req, res) => {
    const input = updateCustomerProfileSchema.parse(req.body);
    const profile = await service.updateProfile(getContext(req), getAuthUser(req).id, input);

    res.status(200).json({ profile, message: req.t('customers.profileUpdated') });
  }),
);

/* ---- addresses ---- */

router.get(
  '/me/addresses',
  handle(async (req, res) => {
    const addresses = await service.listAddresses(getContext(req), getAuthUser(req).id);
    res.status(200).json({ addresses });
  }),
);

router.post(
  '/me/addresses',
  handle(async (req, res) => {
    const input = createAddressSchema.parse(req.body);
    const address = await service.createAddress(getContext(req), getAuthUser(req).id, input);

    res.status(201).json({ address, message: req.t('customers.addressCreated') });
  }),
);

router.get(
  '/me/addresses/:addressId',
  handle(async (req, res) => {
    const { addressId } = addressIdParamSchema.parse(req.params);
    const address = await service.getAddress(getContext(req), getAuthUser(req).id, addressId);

    res.status(200).json({ address });
  }),
);

router.patch(
  '/me/addresses/:addressId',
  handle(async (req, res) => {
    const { addressId } = addressIdParamSchema.parse(req.params);
    const input = updateAddressSchema.parse(req.body);
    const address = await service.updateAddress(
      getContext(req),
      getAuthUser(req).id,
      addressId,
      input,
    );

    res.status(200).json({ address, message: req.t('customers.addressUpdated') });
  }),
);

router.delete(
  '/me/addresses/:addressId',
  handle(async (req, res) => {
    const { addressId } = addressIdParamSchema.parse(req.params);
    await service.deleteAddress(getContext(req), getAuthUser(req).id, addressId);

    res.status(200).json({ message: req.t('customers.addressDeleted') });
  }),
);

router.post(
  '/me/addresses/:addressId/default',
  handle(async (req, res) => {
    const { addressId } = addressIdParamSchema.parse(req.params);
    const address = await service.setDefaultAddress(
      getContext(req),
      getAuthUser(req).id,
      addressId,
    );

    res.status(200).json({ address, message: req.t('customers.defaultAddressSet') });
  }),
);
