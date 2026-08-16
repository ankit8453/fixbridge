import express, { type Express } from 'express';
import { CONTEXT_KEY, type AppContext } from './core/context';
import { createAdminCors } from './core/middleware/admin-cors';
import { createRequestIdMiddleware } from './core/middleware/request-id';
import { localeMiddleware } from './core/middleware/locale';
import { requestLogger } from './core/middleware/request-logger';
import { notFoundHandler } from './core/middleware/not-found';
import { createErrorHandler } from './core/middleware/error-handler';
import { router as healthRouter } from './modules/health/routes';
import { registerModuleRoutes, WEBHOOK_PREFIX } from './modules';

/**
 * Builds the HTTP app from an already-constructed context. Kept separate from
 * `index.ts` so tests can drive the real app without binding a port.
 */
export function createApp(context: AppContext): Express {
  const app = express();

  app.disable('x-powered-by');
  // Hop count, not `true`: trusting X-Forwarded-For unconditionally would let any
  // caller spoof their IP and walk past the per-IP OTP rate limit.
  app.set('trust proxy', context.config.TRUST_PROXY_HOPS);
  app.set(CONTEXT_KEY, context);

  /**
   * Webhooks are parsed as raw bytes, and they are mounted **before** the JSON
   * parser.
   *
   * A gateway signs the exact body it sent. `express.json()` consumes the
   * stream and hands back an object; re-serialising that object reorders keys
   * and normalises whitespace, so the HMAC over it does not match and every
   * webhook silently fails verification. This is the single most common way
   * payment integrations break, and the fix is ordering: the raw parser claims
   * the webhook path first, and nothing downstream ever sees a parsed body for
   * it. There is a test that posts a body with deliberately awkward key order to
   * keep it that way.
   */
  app.use(WEBHOOK_PREFIX, express.raw({ type: '*/*', limit: '1mb' }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.use(createRequestIdMiddleware(context.logger));
  app.use(localeMiddleware);
  app.use(requestLogger);

  /**
   * The ops console is a separate origin, so its requests need CORS headers —
   * including on `/api/v1/auth`, because signing in happens before anything
   * under `/admin` is reachable.
   */
  app.use(createAdminCors(context.config));

  app.use('/health', healthRouter);
  registerModuleRoutes(app);

  app.use(notFoundHandler);
  app.use(
    createErrorHandler({
      includeStack: context.config.NODE_ENV !== 'production',
      logger: context.logger,
    }),
  );

  return app;
}
