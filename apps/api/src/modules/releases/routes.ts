import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../core/errors';
import { getContext } from '../../core/context';
import { isAppId, resolveRelease } from './service';

export const router = Router();

const querySchema = z.object({
  /** The caller's own version, `major.minor.patch`. */
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
});

/**
 * `GET /releases/:app?version=0.1.0`
 *
 * **Deliberately unauthenticated.** A client that must be forced to update is
 * quite possibly one that can no longer sign in — if this sat behind a token,
 * the very build most in need of the message would be the one unable to
 * receive it. Nothing here is secret: it is the same version number printed on
 * the public download page.
 */
router.get('/:app', (req, res, next) => {
  try {
    const app = req.params.app;
    if (!isAppId(app)) {
      throw AppError.badRequest(`Unknown app '${app}'`, {
        messageKey: 'errors.releases.unknownApp',
      });
    }

    const { version } = querySchema.parse(req.query);
    res.status(200).json(resolveRelease(getContext(req).config, app, version));
  } catch (error) {
    next(error);
  }
});
