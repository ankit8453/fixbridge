import { Router, type Request, type RequestHandler } from 'express';
import { getContext } from '../../core/context';
import * as service from './service';
import { resolveQuerySchema, searchProvidersQuerySchema } from './types';

export const router = Router();

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/**
 * Both routes are **public**: a customer chooses a technician before they sign
 * in, and forcing an account first is the fastest way to lose them. That makes
 * the per-IP rate limit the only thing standing between this and a scraper, so
 * it runs before any query.
 */
const rateLimit: RequestHandler = (req, _res, next) => {
  service.enforceSearchRateLimit(getContext(req), req.ip ?? 'unknown').then(() => next(), next);
};

/**
 * GET /api/v1/search/providers
 *
 * Only surfaces providers that are listed (complete), VERIFIED, and active.
 * There is no parameter that relaxes those gates.
 */
router.get(
  '/providers',
  rateLimit,
  handle(async (req, res) => {
    const query = searchProvidersQuerySchema.parse(req.query);
    res.status(200).json(await service.searchProviders(getContext(req), req.t, query));
  }),
);

/**
 * GET /api/v1/search/resolve?q=
 *
 * Free text — in either script — to category suggestions. The app calls this as
 * the customer types, then fires `/providers` with the chosen category.
 */
router.get(
  '/resolve',
  rateLimit,
  handle(async (req, res) => {
    const query = resolveQuerySchema.parse(req.query);
    res.status(200).json(await service.resolveQuery(getContext(req), req.t, query));
  }),
);
