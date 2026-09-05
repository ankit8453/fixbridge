import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { getContext } from '../../core/context';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { consumeRateLimit } from '../../core/rate-limit';
import { AppError } from '../../core/errors';
import { isInsideJabalpur, isValidLatLng } from '../../core/geo';

/**
 * The two lookups the address picker needs.
 *
 * They exist here rather than being called from the apps directly for one
 * reason: Nominatim allows the **whole application** one request per second,
 * and only a server can hold a queue that means anything. A phone cannot know
 * what other phones are doing. Being the only caller also lets us cache, which
 * turns the second lookup of a common address into no request at all.
 *
 * Authenticated, because only somebody adding an address needs them, and an
 * open geocoding proxy is a thing people find and use.
 */

export const router = Router();

router.use(authenticate);

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const searchSchema = z.object({
  // Two characters cannot identify a place and would spend a request finding
  // that out. The client is told the same, so this is a backstop.
  q: z.string().trim().min(3).max(120),
});

const reverseSchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
});

/**
 * Per user, not per IP.
 *
 * A search box fires as somebody types, so the budget has to survive ordinary
 * use — a person entering one address might legitimately make a dozen calls.
 * What it must stop is a script walking the map through one account. Per-IP
 * would punish a shared connection, which in Jabalpur is common.
 */
async function enforceGeoRateLimit(req: Request, userId: string): Promise<void> {
  const context = getContext(req);
  const result = await consumeRateLimit(context.redis, `geo:rate:${userId}`, 30, 60);

  if (!result.allowed) {
    throw AppError.tooManyRequests(
      'Too many location lookups. Wait a moment and try again.',
      result.retryAfterSeconds,
      { messageKey: 'errors.geo.rateLimited' },
    );
  }
}

/**
 * `GET /api/v1/geo/search?q=Vijay+Nagar`
 *
 * Always 200, even with nothing to show. An empty list means "type more, or
 * drag the pin", which is a usable answer; an error would stop somebody in the
 * middle of entering their address over a provider hiccup they cannot fix.
 */
router.get(
  '/search',
  handle(async (req, res) => {
    const { q } = searchSchema.parse(req.query);
    const context = getContext(req);
    await enforceGeoRateLimit(req, getAuthUser(req).id);

    const results = await context.geo.search(q, context.config.DEFAULT_CITY_ID);
    res.status(200).json({ results });
  }),
);

/**
 * `GET /api/v1/geo/reverse?lat=&lng=`
 *
 * Names a point the customer has already chosen — so the home screen can say
 * "Surtalai" rather than "Current location".
 *
 * Refuses a point outside Jabalpur before spending a lookup on it. The product
 * serves one city, and naming a place we cannot send anybody to only makes the
 * empty technician list that follows more confusing.
 */
router.get(
  '/reverse',
  handle(async (req, res) => {
    const { lat, lng } = reverseSchema.parse(req.query);
    const point = { lat, lng };

    if (!isValidLatLng(point)) {
      throw AppError.badRequest('Not a valid point', { messageKey: 'errors.geo.invalidPoint' });
    }

    const context = getContext(req);
    await enforceGeoRateLimit(req, getAuthUser(req).id);

    if (!isInsideJabalpur(point)) {
      res.status(200).json({ label: null, servedHere: false });
      return;
    }

    const label = await context.geo.reverse(point);
    res.status(200).json({ label, servedHere: true });
  }),
);
