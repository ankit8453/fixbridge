import type { RequestHandler } from 'express';
import type { AppConfig } from '../config';

/**
 * CORS for the browser front-ends, hand-rolled rather than pulled from a package.
 *
 * The whole requirement is a short allow-list, three headers and a preflight — a
 * dependency for that is a dependency to keep patched forever, and the `cors`
 * package's permissive defaults are a common way an API ends up answering
 * everybody.
 *
 * **This is not a security control.** CORS is enforced by browsers; anything
 * else ignores it. The actual guards are the role checks on each router. This
 * exists so the web app and the console can talk to the API in development
 * without a proxy, and so production can be pinned to real origins instead of
 * `*`.
 *
 * ## Why an allow-list rather than one origin
 *
 * Phase 12 added a second browser client, and it calls far more than the console
 * did: search, bookings, payments, reviews. So the middleware is mounted for the
 * whole API rather than only under `/api/v1/admin`, and it has to answer for two
 * origins — the customer/partner web app and, until it is retired, the standalone
 * console.
 *
 * Origins are compared **exactly**. No prefix matching, no wildcards, no
 * "endsWith our domain" — every one of those has been somebody's breach, because
 * `ourdomain.com.attacker.net` ends with the right string.
 */
export function createCors(config: AppConfig): RequestHandler {
  /**
   * De-duplicated because the two default to different ports in development but
   * may well be the same origin in production, where one deployment serves the
   * whole domain.
   */
  const allowed = new Set([config.WEB_ORIGIN, config.ADMIN_ORIGIN]);

  return (req, res, next) => {
    const origin = req.headers.origin;

    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      // Echoing the origin means the response varies by it, and a shared cache
      // that missed this would hand one origin's response to another.
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization,Content-Type,Accept-Language,X-Request-Id',
      );
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id,Content-Language,Retry-After');
      res.setHeader('Access-Control-Max-Age', '600');
    }

    // A preflight is answered here and goes no further: it carries no
    // credentials, so running it through authentication would 401 every
    // browser call before the real request was ever made.
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}
