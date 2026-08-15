import express, { type Express } from 'express';
import { CONTEXT_KEY, type AppContext } from './core/context';
import { createRequestIdMiddleware } from './core/middleware/request-id';
import { localeMiddleware } from './core/middleware/locale';
import { requestLogger } from './core/middleware/request-logger';
import { notFoundHandler } from './core/middleware/not-found';
import { createErrorHandler } from './core/middleware/error-handler';
import { router as healthRouter } from './modules/health/routes';
import { registerModuleRoutes } from './modules';

/**
 * Builds the HTTP app from an already-constructed context. Kept separate from
 * `index.ts` so tests can drive the real app without binding a port.
 */
export function createApp(context: AppContext): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.set(CONTEXT_KEY, context);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.use(createRequestIdMiddleware(context.logger));
  app.use(localeMiddleware);
  app.use(requestLogger);

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
