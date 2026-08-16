import type { RequestHandler } from 'express';
import type { AppConfig } from '../config';

/**
 * CORS for the ops console, hand-rolled rather than pulled from a package.
 *
 * The whole requirement is one origin, three headers and a preflight — a
 * dependency for that is a dependency to keep patched forever, and the `cors`
 * package's permissive defaults are a common way an API ends up answering
 * everybody.
 *
 * **This is not a security control.** CORS is enforced by browsers; anything
 * else ignores it. The actual guard on `/api/v1/admin` is the `ops`/`admin` role
 * check applied once at the top of each router. This exists so the console can
 * talk to the API in development without a proxy, and so production can be
 * pinned to the real console URL instead of `*`.
 */
export function createAdminCors(config: AppConfig): RequestHandler {
  const allowed = config.ADMIN_ORIGIN;

  return (req, res, next) => {
    const origin = req.headers.origin;

    if (origin && origin === allowed) {
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
